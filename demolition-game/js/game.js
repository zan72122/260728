/* game.js — 1ステージのゲーム進行（設置 → 起爆 → 崩壊 → 評価） */
(function () {
  'use strict';

  const physics = window.GamePhysics;
  const fx = window.GameFx;
  const audio = window.GameAudio;
  const ui = window.GameUI;
  const { GROUND_Y } = window.GameLevels;

  const FUSE_TIME = 0.75;

  const game = {
    running: false,
    level: null,
    pstate: null,
    phase: 'place', /* place → boom → settle → done/fail */
    dust: 0,
    settleT: 0,
    failPending: 0,
    impactBudget: 0,
    events: { onCleared: null, onFail: null },
    cam: { scale: 1, offX: 0, offY: 0 },
  };

  game.start = function (level) {
    game.level = level;
    game.pstate = physics.buildLevel(level);
    game.phase = 'place';
    game.dust = 0;
    game.settleT = 0;
    game.failPending = 0;
    game.running = true;
    fx.clear();

    game.pstate.onImpact = (x, y, speed) => {
      if (game.impactBudget <= 0) return;
      game.impactBudget--;
      fx.dustAt(x, y, speed * 0.5);
      game.dust += Math.min(0.7, speed * 0.05);
      if (speed > 6) audio.play('thud');
    };
    game.pstate.onCrumble = (x, y) => {
      fx.dustAt(x, y, 4);
      game.dust += 0.5;
    };
    game.pstate.onNeighborHit = (i) => {
      if (game.phase === 'fail' || game.failPending > 0) return;
      const nb = game.pstate.neighbors[i];
      if (nb) nb.hit = true;
      audio.play('uhoh');
      game.failPending = 0.9; /* 少し見せてからオーバーレイ */
    };

    ui.setDust(0, level.dustGreen);
    ui.message(level.hintPlace, 2600);
  };

  game.stop = function () {
    game.running = false;
    ui.hideHand();
    ui.hideMessage();
  };

  /* ---------- カメラ ---------- */
  function updateCamera(cw, ch) {
    const b = game.pstate.bounds;
    const bw = b.maxX - b.minX;
    const bh = b.bottomY - b.topY;
    const scale = Math.min(cw / bw, ch / bh);
    game.cam.scale = scale;
    game.cam.offX = cw / 2 - ((b.minX + b.maxX) / 2) * scale;
    game.cam.offY = ch - 8 - b.bottomY * scale; /* 地面を画面下に寄せる */
  }
  function toScreen(wx, wy) {
    return {
      x: wx * game.cam.scale + game.cam.offX,
      y: wy * game.cam.scale + game.cam.offY,
    };
  }
  function toWorld(sx, sy) {
    return {
      x: (sx - game.cam.offX) / game.cam.scale,
      y: (sy - game.cam.offY) / game.cam.scale,
    };
  }

  /* ---------- 入力 ---------- */
  game.tap = function (sx, sy) {
    if (!game.running) return;
    const w = toWorld(sx, sy);
    const grabR = 90 / Math.min(1, game.cam.scale * 1.2); /* 子ども向けに大きめ */

    if (game.phase === 'place') {
      let best = null, bestD = grabR;
      for (const s of game.pstate.sockets) {
        if (s.status !== 'empty') continue;
        const d = Math.hypot(s.x - w.x, s.y - w.y);
        if (d < bestD) { best = s; bestD = d; }
      }
      if (best) {
        best.status = 'armed';
        audio.play('pop');
        const remain = game.pstate.sockets.filter((s) => s.status === 'empty').length;
        if (remain === 0) {
          game.phase = 'boom';
          ui.message(game.level.hintBoom, 3200);
        }
      }
    } else if (game.phase === 'boom' || game.phase === 'settle') {
      let best = null, bestD = grabR;
      for (const s of game.pstate.sockets) {
        if (s.status !== 'armed') continue;
        const d = Math.hypot(s.x - w.x, s.y - w.y);
        if (d < bestD) { best = s; bestD = d; }
      }
      if (best) {
        best.status = 'lit';
        best.fuseT = FUSE_TIME;
        audio.play('fuse');
      }
    }
  };

  /* ---------- 進行 ---------- */
  function detonate(socket) {
    /* 下の装置がまだ残っているのに上を爆破 → ささえごと壊す雑な爆破でほこり増 */
    const spec = game.level.sockets[socket.index];
    const messy = game.pstate.sockets.some((s) => {
      if (s.status !== 'armed' && s.status !== 'lit') return false;
      const sp = game.level.sockets[s.index];
      return sp.b === spec.b && sp.row < spec.row;
    });
    const destroyed = physics.detonate(game.pstate, socket);
    fx.explosion(socket.x, socket.y, messy ? 120 : 90);
    audio.play('boom');
    const mult = (1 + fx.airborneDust() * 2.2) * (messy ? 1.8 : 1);
    game.dust += (9 + destroyed * 1.2) * mult;
  }

  function evaluate() {
    game.phase = 'done';
    if (!physics.allCleared(game.pstate)) {
      if (game.events.onFail) game.events.onFail('tall');
      return;
    }
    let stars = 3;
    const notes = [];
    if (game.dust >= game.level.dustGreen) {
      stars--;
      notes.push('ほこりが もくもく だったね');
    }
    if (physics.spillCount(game.pstate) > 2) {
      stars--;
      notes.push('がれきが とんじゃった');
    }
    stars = Math.max(1, stars);
    const comment = notes.length ? notes.join('。') : 'あんぜんに かいたい できたね！';
    const b = game.pstate.bounds;
    fx.confetti((b.minX + b.maxX) / 2, b.topY + 60, (b.maxX - b.minX) * 0.7);
    audio.play('yay');
    if (game.events.onCleared) game.events.onCleared(stars, comment);
  }

  game.update = function (dt, time) {
    if (!game.running) return;
    game.impactBudget = 3;

    /* どうかせん */
    for (const s of game.pstate.sockets) {
      if (s.status === 'lit') {
        s.fuseT -= dt;
        if (s.fuseT <= 0) detonate(s);
      }
    }

    physics.update(game.pstate, dt);
    fx.update(dt);
    ui.setDust(game.dust, game.level.dustGreen);

    /* おとなりに当たった → やさしい失敗 */
    if (game.failPending > 0) {
      game.failPending -= dt;
      if (game.failPending <= 0) {
        game.phase = 'fail';
        game.running = false;
        ui.hideHand();
        if (game.events.onFail) game.events.onFail('neighbor');
        return;
      }
    }

    /* 全部爆破ずみ → 落ち着いたら評価 */
    if (game.phase === 'boom' || game.phase === 'settle') {
      const allDone = game.pstate.sockets.every((s) => s.status === 'done');
      if (allDone) {
        game.phase = 'settle';
        game.settleT += dt;
        if ((game.settleT > 1.3 && physics.settled(game.pstate)) || game.settleT > 8) {
          game.running = false;
          ui.hideHand();
          evaluate();
          return;
        }
      }
    }

    /* チュートリアルの手（すてーじ1のみ） */
    if (game.level.tutorial) {
      let target = null;
      if (game.phase === 'place') {
        target = game.pstate.sockets.find((s) => s.status === 'empty');
      } else if (game.phase === 'boom') {
        target = game.pstate.sockets.find((s) => s.status === 'armed');
      }
      if (target) {
        const p = toScreen(target.x, target.y);
        ui.handAt(p.x + 18, p.y + 12);
      } else {
        ui.hideHand();
      }
    }
  };

  /* ---------- 描画 ---------- */
  function drawSky(ctx, cw, ch, time) {
    const g = ctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, '#6cc4f5');
    g.addColorStop(0.65, '#bfe8fb');
    g.addColorStop(1, '#e6f7ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
    /* たいよう */
    ctx.fillStyle = '#ffe28a';
    ctx.beginPath();
    ctx.arc(cw * 0.85, ch * 0.13, Math.min(cw, ch) * 0.07, 0, Math.PI * 2);
    ctx.fill();
    /* くも */
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const drift = (time * 6) % (cw + 300) - 150;
    for (const [bx, by, s] of [[drift, ch * 0.12, 1], [cw * 0.3, ch * 0.22, 0.7], [cw * 0.62, ch * 0.08, 0.85]]) {
      ctx.beginPath();
      ctx.arc(bx, by, 26 * s, 0, Math.PI * 2);
      ctx.arc(bx + 24 * s, by - 10 * s, 20 * s, 0, Math.PI * 2);
      ctx.arc(bx + 48 * s, by, 22 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  game.drawSky = drawSky;

  game.draw = function (ctx, cw, ch, time) {
    drawSky(ctx, cw, ch, time);
    if (!game.pstate) return;
    updateCamera(cw, ch);

    ctx.save();
    const sh = fx.getShake();
    const shx = (Math.random() - 0.5) * sh;
    const shy = (Math.random() - 0.5) * sh;
    ctx.translate(game.cam.offX + shx, game.cam.offY + shy);
    ctx.scale(game.cam.scale, game.cam.scale);

    physics.drawWorld(ctx, game.pstate, time, {
      showSockets: game.phase === 'place',
      pulseBombs: game.phase === 'boom' || game.phase === 'settle',
    });
    fx.draw(ctx);
    ctx.restore();
  };

  window.GameCore = game;
})();
