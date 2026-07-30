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
  };

  game.start = function (level) {
    game.level = level;
    game.pstate = physics.buildLevel(level);
    game.phase = 'place';
    game.dust = 0;
    game.settleT = 0;
    game.failPending = 0;
    game.simTime = 0;
    game.running = true;
    fx.clear();

    game.pstate.onImpact = (x, y, speed) => {
      if (game.impactBudget <= 0) return;
      game.impactBudget--;
      fx.dustAt(x, y, speed * 0.5);
      game.dust += Math.min(0.7, speed * 0.05);
      if (speed > 6) audio.play('thud');
    };
    game.pstate.onCrumble = (x, y, blk) => {
      fx.dustAt(x, y, 4);
      const bld = blk && game.level.buildings[blk.plugin.meta.bi];
      fx.chips(x, y, bld ? bld.palette.wall : '#c9bfae', 5);
      game.dust += 0.5;
    };
    game.pstate.onNeighborHit = (i) => {
      if (game.phase === 'fail' || game.failPending > 0) return;
      const nb = game.pstate.neighbors[i];
      if (nb) nb.hit = true;
      audio.play('uhoh');
      game.failPending = 0.9; /* 少し見せてからオーバーレイ */
    };

    window.GameRender.buildScene(game.pstate);
    ui.setDust(0, level.dustGreen);
    ui.message(level.hintPlace, 2600);
  };

  game.stop = function () {
    game.running = false;
    ui.hideHand();
    ui.hideMessage();
  };

  /* ---------- 入力（画面座標で判定） ---------- */
  game.socketScreen = function (i) {
    const s = game.pstate.sockets[i];
    return window.GameRender.screenPos(s.x, s.y);
  };

  function nearestSocket(sx, sy, status) {
    const grabR = 85; /* 子ども向けに大きめの当たり判定(px) */
    let best = null, bestD = grabR;
    for (let i = 0; i < game.pstate.sockets.length; i++) {
      const s = game.pstate.sockets[i];
      if (s.status !== status) continue;
      const p = game.socketScreen(i);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bestD) { best = s; bestD = d; }
    }
    return best;
  }

  game.tap = function (sx, sy) {
    if (!game.running) return;

    if (game.phase === 'place') {
      const best = nearestSocket(sx, sy, 'empty');
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
      const best = nearestSocket(sx, sy, 'armed');
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
    const wallColor = game.level.buildings[spec.b].palette.wall;
    fx.explosion(socket.x, socket.y, messy ? 120 : 90, wallColor);
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
    game.simTime += dt;
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
        const p = window.GameRender.screenPos(target.x, target.y);
        ui.handAt(p.x + 18, p.y + 12);
      } else {
        ui.hideHand();
      }
    }
  };

  /* ---------- 描画（render3d.js に委譲） ---------- */
  game.draw = function (time) {
    window.GameRender.render(game.pstate, time, {
      showSockets: game.phase === 'place',
      pulseBombs: game.phase === 'boom' || game.phase === 'settle',
    });
  };

  window.GameCore = game;
})();
