/* physics.js — Matter.js ラッパ：建物の生成・爆破・崩壊判定・ワールド描画 */
(function () {
  'use strict';

  const { Engine, Composite, Bodies, Body, Events, Sleeping } = Matter;
  const { B, GROUND_Y } = window.GameLevels;

  const DESTROY_R = B * 1.15;  /* 爆破でブロックが消える半径 */
  const PUSH_R = B * 4.0;      /* 吹き飛ばしの半径 */
  const CRUMBLE_SPEED = 6;     /* この速さ以上でぶつかったブロックは砕ける */

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
    });
    Composite.add(engine.world, ground);

    /* おとなりの建物（静的・顔つき） */
    level.neighbors.forEach((n, i) => {
      const body = Bodies.rectangle(n.x, GROUND_Y - n.h / 2, n.w, n.h, {
        isStatic: true, label: 'neighbor',
      });
      body.plugin.neighborIndex = i;
      Composite.add(engine.world, body);
      state.neighbors.push({ spec: n, body, hit: false });
    });

    /* 解体する建物：ブロックの積み上げ（起爆までは static で安定） */
    level.buildings.forEach((spec, bi) => {
      const blocks = [];
      const left = spec.x - (spec.cols * B) / 2;
      for (let row = 0; row < spec.rows; row++) {
        for (let col = 0; col < spec.cols; col++) {
          const x = left + col * B + B / 2;
          const y = GROUND_Y - B / 2 - row * B;
          /* 動的ボディとして作ってから凍結する（生成時 isStatic:true だと
           * setStatic(false) で質量が復元されず物理が壊れるため） */
          const body = Bodies.rectangle(x, y, B, B, {
            friction: 0.9, frictionStatic: 5, restitution: 0.02,
            label: 'block',
          });
          Body.setStatic(body, true);
          body.plugin.meta = {
            bi, col, row,
            window: (row + col) % 2 === 0 && row > 0,
            removed: false,
          };
          Composite.add(engine.world, body);
          blocks.push(body);
        }
      }
      state.buildings.push({ spec, blocks });
    });

    /* 爆破装置ソケットのワールド座標 */
    level.sockets.forEach((s, i) => {
      const spec = level.buildings[s.b];
      const left = spec.x - (spec.cols * B) / 2;
      state.sockets.push({
        index: i,
        x: left + s.col * B + B / 2,
        y: GROUND_Y - B / 2 - s.row * B,
        status: 'empty', /* empty → armed → lit → done */
        fuseT: 0,
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
          /* 強くぶつかったブロックは砕けてほこりになる */
          if (speed > CRUMBLE_SPEED) {
            const faster =
              (a.label === 'block' && (b.label !== 'block' ||
                Math.hypot(a.velocity.x, a.velocity.y) >= Math.hypot(b.velocity.x, b.velocity.y)))
                ? a : (b.label === 'block' ? b : null);
            if (faster) state.toCrumble.push(faster);
          }
        }
      }
    });

    /* カメラ用のシーン範囲 */
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
          Composite.remove(state.engine.world, blk);
          if (state.onCrumble) state.onCrumble(blk.position.x, blk.position.y);
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

  /* 起爆：近傍ブロックを破壊し、周辺を吹き飛ばす */
  physics.detonate = function (state, socket) {
    if (!state.awake) {
      state.awake = true;
      for (const blk of activeBlocks(state)) Body.setStatic(blk, false);
    }
    let destroyed = 0;
    for (const blk of activeBlocks(state)) {
      Sleeping.set(blk, false);
      const dx = blk.position.x - socket.x;
      const dy = blk.position.y - socket.y;
      const d = Math.hypot(dx, dy);
      if (d < DESTROY_R) {
        blk.plugin.meta.removed = true;
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
    socket.status = 'done';
    return destroyed;
  };

  /* 建物がじゅうぶん低くなったか（全棟） */
  physics.allCleared = function (state) {
    for (const bld of state.buildings) {
      const limit = Math.max(B * 2.6, bld.spec.rows * B * 0.42);
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

  /* ---------- ワールド描画（ctx はワールド座標に変換済み） ---------- */

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawNeighbor(ctx, nb) {
    const n = nb.spec;
    const x = n.x, w = n.w, h = n.h;
    const top = GROUND_Y - h;
    /* かべ */
    ctx.fillStyle = n.color;
    ctx.fillRect(x - w / 2, top, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x - w / 2, top, w, h);
    /* やね */
    ctx.fillStyle = n.roof;
    ctx.beginPath();
    ctx.moveTo(x - w / 2 - 14, top);
    ctx.lineTo(x + w / 2 + 14, top);
    ctx.lineTo(x, top - h * 0.5);
    ctx.closePath();
    ctx.fill();
    /* かお */
    const fy = top + h * 0.42;
    ctx.fillStyle = '#3d2c1e';
    if (!nb.hit) {
      ctx.beginPath();
      ctx.arc(x - w * 0.16, fy, 5, 0, Math.PI * 2);
      ctx.arc(x + w * 0.16, fy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3d2c1e';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, fy + 6, w * 0.14, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#3d2c1e';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x - w * 0.16, fy, 7, 0, Math.PI * 2);
      ctx.moveTo(x + w * 0.16 + 7, fy);
      ctx.arc(x + w * 0.16, fy, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, fy + 18, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawBlock(ctx, blk, palette) {
    const meta = blk.plugin.meta;
    ctx.save();
    ctx.translate(blk.position.x, blk.position.y);
    ctx.rotate(blk.angle);
    ctx.fillStyle = palette.wall;
    ctx.fillRect(-B / 2, -B / 2, B, B);
    ctx.strokeStyle = palette.shade;
    ctx.lineWidth = 3;
    ctx.strokeRect(-B / 2 + 1.5, -B / 2 + 1.5, B - 3, B - 3);
    if (meta.window) {
      ctx.fillStyle = palette.win;
      roundRect(ctx, -B * 0.28, -B * 0.28, B * 0.56, B * 0.56, 5);
      ctx.fill();
      ctx.strokeStyle = palette.shade;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBomb(ctx, s, time) {
    ctx.save();
    ctx.translate(s.x, s.y);
    /* TNTのたば */
    ctx.fillStyle = '#e63946';
    roundRect(ctx, -20, -14, 40, 28, 6);
    ctx.fill();
    ctx.strokeStyle = '#9d2230';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillRect(-20, -4, 40, 8);
    ctx.fillStyle = '#9d2230';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TNT', 0, 0.5);
    /* どうかせん */
    ctx.strokeStyle = '#6b4f2a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.quadraticCurveTo(8, -26, 16, -24);
    ctx.stroke();
    if (s.status === 'lit') {
      const r = 6 + Math.sin(time * 30) * 2.5;
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath();
      ctx.arc(16, -24, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath();
      ctx.arc(16, -24, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  physics.drawWorld = function (ctx, state, time, opts) {
    const level = state.level;
    const bounds = state.bounds;

    /* じめん */
    ctx.fillStyle = '#8bc34a';
    ctx.fillRect(bounds.minX - 600, GROUND_Y, bounds.maxX - bounds.minX + 1200, 18);
    ctx.fillStyle = '#a1887f';
    ctx.fillRect(bounds.minX - 600, GROUND_Y + 18, bounds.maxX - bounds.minX + 1200, 300);

    /* 安全ゾーンのコーン */
    for (const zx of [level.zone.l, level.zone.r]) {
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath();
      ctx.moveTo(zx - 14, GROUND_Y);
      ctx.lineTo(zx + 14, GROUND_Y);
      ctx.lineTo(zx, GROUND_Y - 34);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(zx - 8, GROUND_Y - 16, 16, 6);
    }

    /* おとなり */
    for (const nb of state.neighbors) drawNeighbor(ctx, nb);

    /* ブロック */
    for (const bld of state.buildings) {
      for (const blk of bld.blocks) {
        if (!blk.plugin.meta.removed) drawBlock(ctx, blk, bld.spec.palette);
      }
    }

    /* ソケットと爆破装置 */
    for (const s of state.sockets) {
      if (s.status === 'empty' && opts.showSockets) {
        const pulse = 1 + Math.sin(time * 5) * 0.15;
        ctx.strokeStyle = 'rgba(255,210,60,0.95)';
        ctx.lineWidth = 5;
        ctx.setLineDash([8, 7]);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 26 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 12 * pulse, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.status === 'armed' || s.status === 'lit') {
        drawBomb(ctx, s, time);
        if (s.status === 'armed' && opts.pulseBombs) {
          const pulse = 1 + Math.sin(time * 5) * 0.12;
          ctx.strokeStyle = 'rgba(255,90,54,0.8)';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 34 * pulse, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  };

  window.GamePhysics = physics;
})();
