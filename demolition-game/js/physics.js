/* physics.js — Matter.js ラッパ：建物の生成・爆破・崩壊判定 */
(function () {
  'use strict';

  const { Engine, Composite, Bodies, Body, Events, Sleeping } = Matter;
  const { B, GROUND_Y, BRUSHES, MATERIALS } = window.GameLevels;

  const DESTROY_R = B * 1.15;  /* 爆破でブロックが消える半径 */
  const PUSH_R = B * 4.0;      /* 吹き飛ばしの半径 */
  const CRUMBLE_SPEED = 6;     /* meta.crumble が無いときのフォールバックしきい値 */

  /* レイヤーごとの衝突カテゴリ（0=おく,1=なか,2=まえ）。
   * ブロックは同じレイヤーどうし＋地面/おとなり(0x1)とだけ衝突する。 */
  function layerCategory(layer) { return 0x0002 << (layer | 0); }
  const GROUND_FILTER = { category: 0x0001, mask: 0xFFFF, group: 0 };

  const physics = {};

  physics.buildLevel = function (level) {
    const engine = Engine.create({ enableSleeping: true });
    engine.gravity.y = 1;

    const state = {
      level, engine,
      buildings: [],
      neighbors: [],
      sockets: [],
      awake: false,
      acc: 0,
      toCrumble: [],
      onImpact: null,      /* (x, y, speed) */
      onCrumble: null,     /* (x, y) */
      onNeighborHit: null, /* (neighborIndex) */
    };

    /* 地面 */
    const ground = Bodies.rectangle(0, GROUND_Y + 80, 6000, 160, {
      isStatic: true, friction: 1, label: 'ground',
      collisionFilter: GROUND_FILTER,
    });
    Composite.add(engine.world, ground);

    /* おとなりの建物（静的・顔つき） */
    level.neighbors.forEach((n, i) => {
      const body = Bodies.rectangle(n.x, GROUND_Y - n.h / 2, n.w, n.h, {
        isStatic: true, label: 'neighbor',
        collisionFilter: GROUND_FILTER,
      });
      body.plugin.neighborIndex = i;
      Composite.add(engine.world, body);
      state.neighbors.push({ spec: n, body, hit: false });
    });

    /* 形状ごとにボディを生成する（tri=三角/cir=丸/それ以外=四角） */
    function makeBlockBody(x, y, shape, matDef) {
      const opts = {
        friction: matDef.friction, frictionStatic: 5,
        restitution: matDef.restitution, density: matDef.density,
        label: 'block',
      };
      if (shape === 'tri') {
        /* 底辺が下・頂点が上の二等辺三角形（セルいっぱい） */
        const verts = [{ x: 0, y: -B / 2 }, { x: -B / 2, y: B / 2 }, { x: B / 2, y: B / 2 }];
        try {
          return Bodies.fromVertices(x, y, [verts], opts);
        } catch (e) {
          /* フォールバック：正三角形ポリゴンを回転して底辺を水平にする */
          const poly = Bodies.polygon(x, y, 3, B * 0.58, opts);
          Body.setAngle(poly, Math.PI / 2);
          return poly;
        }
      }
      if (shape === 'cir') {
        return Bodies.circle(x, y, B * 0.48, opts);
      }
      return Bodies.rectangle(x, y, B, B, opts);
    }

    /* ブロック1個を生成して登録する。
     * 動的ボディとして作ってから凍結する（生成時 isStatic:true だと
     * setStatic(false) で質量が復元されず物理が壊れるため） */
    function makeBlock(spec, bi, col, row, layer, shape, palette, materialName) {
      const left = spec.x - (spec.cols * B) / 2;
      const x = left + col * B + B / 2;
      const y = GROUND_Y - B / 2 - row * B;
      const matDef = MATERIALS[materialName] || MATERIALS.normal;
      const body = makeBlockBody(x, y, shape, matDef);
      Body.setStatic(body, true);
      const cat = layerCategory(layer);
      body.collisionFilter = { category: cat, mask: cat | 0x0001, group: 0 };
      body.plugin.meta = {
        bi, col, row, layer, shape,
        material: materialName || 'normal',
        palette: palette || null,
        crumble: matDef.crumble,
        window: (materialName || 'normal') === 'normal' && (row + col) % 2 === 0 && row > 0,
        removed: false,
      };
      Composite.add(engine.world, body);
      return body;
    }

    /* 解体する建物：ブロックの積み上げ */
    if (level.customBlocks) {
      /* 建築モード：任意配置のブロックリストから生成
       * cb = { col, row, layer, brushP, shape } */
      const spec = level.buildings[0];
      const blocks = level.customBlocks.map((cb) => {
        const brush = (BRUSHES && BRUSHES[cb.brushP]) || (BRUSHES && BRUSHES[0]);
        const layer = cb.layer != null ? cb.layer : 1;
        const shape = cb.shape || 'sq';
        return makeBlock(spec, 0, cb.col, cb.row, layer, shape, brush, brush && brush.material);
      });
      state.buildings.push({ spec, blocks });
    } else {
      level.buildings.forEach((spec, bi) => {
        const blocks = [];
        for (let row = 0; row < spec.rows; row++) {
          for (let col = 0; col < spec.cols; col++) {
            blocks.push(makeBlock(spec, bi, col, row, 1, 'sq', null, 'normal'));
          }
        }
        state.buildings.push({ spec, blocks });
      });
    }

    /* おすすめポイント（ヒント）のワールド座標 */
    level.sockets.forEach((s) => {
      const spec = level.buildings[s.b];
      const left = spec.x - (spec.cols * B) / 2;
      state.sockets.push({
        x: left + s.col * B + B / 2,
        y: GROUND_Y - B / 2 - s.row * B,
      });
    });

    /* 衝突イベント：ほこり発生と、おとなりへの接触判定 */
    Events.on(engine, 'collisionStart', (ev) => {
      for (const pair of ev.pairs) {
        const a = pair.bodyA, b = pair.bodyB;
        const speed = Math.hypot(
          a.velocity.x - b.velocity.x,
          a.velocity.y - b.velocity.y
        );
        const labels = a.label + '|' + b.label;
        if (labels.includes('neighbor') && labels.includes('block')) {
          const nb = a.label === 'neighbor' ? a : b;
          if (speed > 4.5 && state.onNeighborHit) {
            state.onNeighborHit(nb.plugin.neighborIndex);
          }
        } else if (speed > 3.5 && state.onImpact) {
          const pos = pair.collision.supports[0] || a.position;
          state.onImpact(pos.x, pos.y, speed);
          /* 強くぶつかったブロックは砕けてほこりになる（しきい値はブロックごとの meta.crumble） */
          const faster =
            (a.label === 'block' && (b.label !== 'block' ||
              Math.hypot(a.velocity.x, a.velocity.y) >= Math.hypot(b.velocity.x, b.velocity.y)))
              ? a : (b.label === 'block' ? b : null);
          if (faster) {
            const th = (faster.plugin.meta && faster.plugin.meta.crumble != null)
              ? faster.plugin.meta.crumble : CRUMBLE_SPEED;
            if (speed > th) state.toCrumble.push(faster);
          }
        }
      }
    });

    /* カメラ用のシーン範囲（level.viewBounds があればそれを優先） */
    if (level.viewBounds) {
      state.bounds = {
        minX: level.viewBounds.minX - 110,
        maxX: level.viewBounds.maxX + 110,
        topY: level.viewBounds.topY,
        bottomY: GROUND_Y + 90,
      };
      return state;
    }
    let minX = Infinity, maxX = -Infinity, maxRows = 0;
    level.buildings.forEach((sp) => {
      minX = Math.min(minX, sp.x - (sp.cols * B) / 2);
      maxX = Math.max(maxX, sp.x + (sp.cols * B) / 2);
      maxRows = Math.max(maxRows, sp.rows);
    });
    level.neighbors.forEach((n) => {
      minX = Math.min(minX, n.x - n.w / 2);
      maxX = Math.max(maxX, n.x + n.w / 2);
    });
    minX = Math.min(minX, level.zone.l);
    maxX = Math.max(maxX, level.zone.r);
    state.bounds = {
      minX: minX - 110,
      maxX: maxX + 110,
      topY: GROUND_Y - maxRows * B - 230,
      bottomY: GROUND_Y + 90,
    };

    return state;
  };

  /* 固定タイムステップで物理を進める */
  physics.update = function (state, dt) {
    state.acc += dt;
    let steps = 0;
    while (state.acc >= 1 / 60 && steps < 4) {
      Engine.update(state.engine, 1000 / 60);
      state.acc -= 1 / 60;
      steps++;
    }
    if (steps === 4) state.acc = 0;

    /* 砕けるブロックの処理（衝突コールバック中の削除は避ける） */
    if (state.toCrumble.length) {
      for (const blk of state.toCrumble) {
        if (blk.plugin.meta && !blk.plugin.meta.removed) {
          blk.plugin.meta.removed = true;
          blk.plugin.meta.removedBy = 'crumble';
          Composite.remove(state.engine.world, blk);
          if (state.onCrumble) state.onCrumble(blk.position.x, blk.position.y, blk);
        }
      }
      state.toCrumble.length = 0;
    }
  };

  function activeBlocks(state) {
    const out = [];
    for (const bld of state.buildings) {
      for (const blk of bld.blocks) if (!blk.plugin.meta.removed) out.push(blk);
    }
    return out;
  }
  physics.activeBlocks = activeBlocks;

  /* 起爆：pos（ワールド座標）の近傍ブロックを破壊し、周辺を吹き飛ばす。
   * layer を渡すと、破壊・吹き飛ばしは同じレイヤーのブロックだけに限定される。 */
  physics.detonate = function (state, pos, layer) {
    if (!state.awake) {
      state.awake = true;
      for (const blk of activeBlocks(state)) Body.setStatic(blk, false);
    }
    let destroyed = 0;
    for (const blk of activeBlocks(state)) {
      if (layer != null && blk.plugin.meta.layer !== layer) continue;
      Sleeping.set(blk, false);
      const dx = blk.position.x - pos.x;
      const dy = blk.position.y - pos.y;
      const d = Math.hypot(dx, dy);
      if (d < DESTROY_R) {
        blk.plugin.meta.removed = true;
        blk.plugin.meta.removedBy = 'blast';
        Composite.remove(state.engine.world, blk);
        destroyed++;
      } else if (d < PUSH_R) {
        const k = (1 - d / PUSH_R) * 10.5;
        const nx = dx / (d || 1), ny = dy / (d || 1);
        Body.setVelocity(blk, {
          x: blk.velocity.x + nx * k + (Math.random() - 0.5) * 0.8,
          y: blk.velocity.y + ny * k - 2.5,
        });
        Body.setAngularVelocity(blk, (Math.random() - 0.5) * 0.25);
      }
    }
    return destroyed;
  };

  /* 建物がじゅうぶん低くなったか（全棟） */
  physics.allCleared = function (state) {
    const ratio = state.level.clearRatio || 0.42;
    for (const bld of state.buildings) {
      const limit = Math.max(B * 2.6, bld.spec.rows * B * ratio);
      let top = GROUND_Y;
      let any = false;
      for (const blk of bld.blocks) {
        if (blk.plugin.meta.removed) continue;
        any = true;
        top = Math.min(top, blk.position.y - B / 2);
      }
      if (any && GROUND_Y - top > limit) return false;
    }
    return true;
  };

  /* がれきが落ち着いたか */
  physics.settled = function (state) {
    for (const blk of activeBlocks(state)) {
      if (blk.isStatic || blk.isSleeping) continue;
      if (Math.hypot(blk.velocity.x, blk.velocity.y) > 0.45) return false;
    }
    return true;
  };

  /* 安全ゾーンの外に飛び出たがれきの数 */
  physics.spillCount = function (state) {
    const { l, r } = state.level.zone;
    let n = 0;
    for (const blk of activeBlocks(state)) {
      if (blk.position.x < l || blk.position.x > r) n++;
    }
    return n;
  };


  window.GamePhysics = physics;
})();
