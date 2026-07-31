/* physics.js — Matter.js ラッパ：建物の生成・爆破・崩壊判定 */
(function () {
  'use strict';

  const { Engine, Composite, Bodies, Body, Events, Sleeping } = Matter;
  const { B, GROUND_Y, BRUSHES, MATERIALS } = window.GameLevels;

  const DESTROY_R = B * 1.15;  /* 爆破でブロックが消える半径 */
  const PUSH_R = B * 4.0;      /* 吹き飛ばしの半径 */
  const CRUMBLE_SPEED = 6;     /* meta.crumble が無いときのフォールバックしきい値 */

  /* ---------- 物理負荷対策（大量ブロック向け） ----------
   * LEGACY_MAX 未満のブロック数（既存6ステージはすべてこの範囲）では、
   * 起爆時に従来どおり「全ブロックいっせいウェイク」を行い、挙動を完全に変えない。
   * それ以上（建築モードの大規模な建物）では、局所ウェイク＋再凍結＋
   * 同時アクティブバジェットで負荷を抑える。 */
  const LEGACY_MAX = 120;          /* この未満は従来どおりのフルウェイク経路 */
  const WAKE_R = PUSH_R * 1.6;     /* 局所ウェイクの半径 */
  const CORRIDOR_HALF_W = B * 0.8; /* 「支えを失った上方」を起こす垂直コリドーの半幅 */
  const RESLEEP_SCAN_DT = 0.25;    /* 再凍結／バジェットスキャンの間隔（秒） */
  const RESLEEP_TIME = 0.8;        /* isSleeping継続でこの秒数たったら再凍結 */
  const ACTIVE_MAX_DEFAULT = 280;  /* GamePerf.activeMax 未指定時の同時アクティブ上限 */
  const TOUCH_WAKE_SPEED = 1.0;    /* touch-to-wake の相対速度しきい値 */

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

    /* 総ブロック数はレベル開始時に固定（減ることはあっても増えない）。
     * これでレガシー経路／局所ウェイク経路の判定がプレイ中にぶれない。 */
    state.totalBlocks = state.buildings.reduce((n, b) => n + b.blocks.length, 0);
    state.scanAcc = 0;

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

        /* touch-to-wake：静的なブロックに動的なもの（がれき／てっきゅう／ショベルなど）
         * がある程度の速さでぶつかったら、そのブロックと支えを失う上方を起こす。
         * 既存6ステージでは起爆前に動的ボディが存在しないため実質ノーオペ。 */
        if (speed > TOUCH_WAKE_SPEED) {
          let staticBlk = null;
          if (a.label === 'block' && a.isStatic && !b.isStatic) staticBlk = a;
          else if (b.label === 'block' && b.isStatic && !a.isStatic) staticBlk = b;
          if (staticBlk) {
            wakeBlock(staticBlk);
            wakeCorridorAbove(state, staticBlk.plugin.meta.layer,
              [{ x: staticBlk.position.x, y: staticBlk.position.y }]);
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

  function activeBlocks(state) {
    const out = [];
    for (const bld of state.buildings) {
      for (const blk of bld.blocks) if (!blk.plugin.meta.removed) out.push(blk);
    }
    return out;
  }
  physics.activeBlocks = activeBlocks;

  function isLegacy(state) { return state.totalBlocks < LEGACY_MAX; }
  function speedOf(blk) { return Math.hypot(blk.velocity.x, blk.velocity.y); }

  /* 1個のブロックを起こす（static解除＋スリープ解除＋再凍結タイマーのリセット） */
  function wakeBlock(blk) {
    if (blk.isStatic) Body.setStatic(blk, false);
    Sleeping.set(blk, false);
    if (blk.plugin.meta) blk.plugin.meta.sleepT = 0;
  }

  /* 支えを失った上方の静的ブロックを連鎖して起こす（再帰なし・収束するまで反復）。
   * startPts: [{x,y}, ...]（起こした/破壊した各ブロックの現在位置）。同一レイヤーのみ対象。 */
  function wakeCorridorAbove(state, layer, startPts) {
    if (!startPts.length) return;
    const candidates = [];
    for (const bld of state.buildings) {
      for (const blk of bld.blocks) {
        if (blk.plugin.meta.removed) continue;
        if (blk.plugin.meta.layer !== layer) continue;
        candidates.push(blk);
      }
    }
    let frontier = startPts;
    let guard = 0;
    while (frontier.length && guard < 64) {
      guard++;
      const next = [];
      for (const p of frontier) {
        for (const blk of candidates) {
          if (!blk.isStatic) continue;
          if (Math.abs(blk.position.x - p.x) < CORRIDOR_HALF_W && blk.position.y < p.y - 1) {
            wakeBlock(blk);
            next.push({ x: blk.position.x, y: blk.position.y });
          }
        }
      }
      frontier = next;
    }
  }

  /* 外部（重機など）からの任意ウェイク：pos半径内の同レイヤー静的ブロックを起こし、
   * それぞれの上方コリドーも連鎖して起こす。layer が null/undefined なら全レイヤー対象。 */
  physics.wakeAt = function (state, pos, radius, layer) {
    const byLayer = new Map();
    for (const blk of activeBlocks(state)) {
      if (layer != null && blk.plugin.meta.layer !== layer) continue;
      if (!blk.isStatic) continue;
      const dx = blk.position.x - pos.x, dy = blk.position.y - pos.y;
      if (Math.hypot(dx, dy) < radius) {
        wakeBlock(blk);
        const ly = blk.plugin.meta.layer;
        if (!byLayer.has(ly)) byLayer.set(ly, []);
        byLayer.get(ly).push({ x: blk.position.x, y: blk.position.y });
      }
    }
    for (const [ly, pts] of byLayer) wakeCorridorAbove(state, ly, pts);
  };

  /* A2: 眠り続けた動的ブロックの再凍結（0.25秒ごと呼び出し）。
   * isLegacy(state) のときは呼ばれない（既存6ステージのsettled判定タイミングに影響させない）。 */
  function reSleepScan(state) {
    for (const bld of state.buildings) {
      for (const blk of bld.blocks) {
        if (blk.plugin.meta.removed || blk.isStatic) continue;
        const meta = blk.plugin.meta;
        if (blk.isSleeping) {
          meta.sleepT = (meta.sleepT || 0) + RESLEEP_SCAN_DT;
          if (meta.sleepT >= RESLEEP_TIME) {
            Body.setStatic(blk, true);
            meta.sleepT = 0;
          }
        } else {
          meta.sleepT = 0;
        }
      }
    }
  }

  /* A3: 同時アクティブバジェット。動的ブロック数が ACTIVE_MAX を超えたら、
   * 超過分を速度の遅い順に処理する（遅い→即凍結、速い→crumble化）。
   * 起爆や局所ウェイクで一気に大量のブロックが動的化した直後でも上限を超えたまま
   * 描画/次フレームへ進まないよう、毎 physics.update 呼び出しごとに実行する
   * （isLegacy(state) のときは呼ばれない）。
   * GamePerf は別エージェント実装中の可能性があるため毎回参照（未定義でも動く）。 */
  function enforceActiveBudget(state) {
    const ACTIVE_MAX = (window.GamePerf && window.GamePerf.activeMax) || ACTIVE_MAX_DEFAULT;
    const alive = [];
    for (const bld of state.buildings) {
      for (const blk of bld.blocks) {
        if (blk.plugin.meta.removed || blk.isStatic) continue;
        alive.push(blk);
      }
    }
    if (alive.length <= ACTIVE_MAX) return;
    const excess = alive.length - ACTIVE_MAX;
    alive.sort((a, b) => speedOf(a) - speedOf(b));
    for (let i = 0; i < excess; i++) {
      const blk = alive[i];
      if (blk.plugin.meta.removed) continue;
      if (speedOf(blk) < 0.5) {
        Body.setStatic(blk, true);
        blk.plugin.meta.sleepT = 0;
      } else {
        state.toCrumble.push(blk);
      }
    }
  }

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

    const legacy = isLegacy(state);

    if (!legacy) {
      /* A3は毎tick：起爆直後の一気ウェイクでも上限超過を1フレームで解消する */
      enforceActiveBudget(state);
      /* A2は0.25秒ごと：頻度は低くてよい（凍結タイミングの精度は重要でない） */
      state.scanAcc = (state.scanAcc || 0) + dt;
      if (state.scanAcc >= RESLEEP_SCAN_DT) {
        state.scanAcc -= RESLEEP_SCAN_DT;
        reSleepScan(state);
      }
    }

    /* 砕けるブロックの処理（衝突コールバック中の削除は避ける） */
    if (state.toCrumble.length) {
      for (const blk of state.toCrumble) {
        if (blk.plugin.meta && !blk.plugin.meta.removed) {
          const wasStatic = blk.isStatic;
          const layer = blk.plugin.meta.layer;
          const px = blk.position.x, py = blk.position.y;
          blk.plugin.meta.removed = true;
          blk.plugin.meta.removedBy = 'crumble';
          Composite.remove(state.engine.world, blk);
          if (!legacy && wasStatic) wakeCorridorAbove(state, layer, [{ x: px, y: py }]);
          if (state.onCrumble) state.onCrumble(px, py, blk);
        }
      }
      state.toCrumble.length = 0;
    }
  };

  /* 起爆：pos（ワールド座標）の近傍ブロックを破壊し、周辺を吹き飛ばす。
   * layer を渡すと、破壊・吹き飛ばしは同じレイヤーのブロックだけに限定される。
   * ブロック総数 < LEGACY_MAX（既存6ステージは常にこちら）では従来どおり全ブロックを
   * 一斉ウェイクする。それ以上では爆心まわりの局所ウェイク（＋上方コリドー）に留める。 */
  physics.detonate = function (state, pos, layer) {
    const legacy = isLegacy(state);
    if (!state.awake) {
      state.awake = true;
      if (legacy) {
        for (const blk of activeBlocks(state)) Body.setStatic(blk, false);
      }
    }
    if (!legacy) {
      physics.wakeAt(state, pos, WAKE_R, layer);
    }
    let destroyed = 0;
    const destroyedPts = [];
    for (const blk of activeBlocks(state)) {
      if (layer != null && blk.plugin.meta.layer !== layer) continue;
      Sleeping.set(blk, false);
      const dx = blk.position.x - pos.x;
      const dy = blk.position.y - pos.y;
      const d = Math.hypot(dx, dy);
      if (d < DESTROY_R) {
        blk.plugin.meta.removed = true;
        blk.plugin.meta.removedBy = 'blast';
        if (!legacy) destroyedPts.push({ x: blk.position.x, y: blk.position.y });
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
    if (!legacy && destroyedPts.length) wakeCorridorAbove(state, layer, destroyedPts);
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
