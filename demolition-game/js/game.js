/* game.js — 1ステージのゲーム進行（自由設置 → 起爆 → 崩壊 → 評価）
 * 爆弾はブロックに貼り付き、崩壊時はブロックと一緒に動いて現在位置で爆発する。
 */
(function () {
  'use strict';

  const physics = window.GamePhysics;
  const fx = window.GameFx;
  const audio = window.GameAudio;
  const ui = window.GameUI;

  const FUSE_TIME = 0.75;
  const GRAB_PX = 70; /* タップの当たり判定（画面px、子ども向けに大きめ） */

  const game = {
    running: false,
    level: null,
    pstate: null,
    phase: 'place', /* place → boom → settle → done/fail */
    dust: 0,
    settleT: 0,
    failPending: 0,
    impactBudget: 0,
    simTime: 0,
    bombs: [],      /* {host: <block body>, status: 'armed'|'lit'|'done', fuseT} */
    maxBombs: 0,
    minBombs: 0,
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
    game.bombs = [];
    game.maxBombs = level.maxBombs || level.sockets.length;
    game.minBombs = level.minBombs || game.maxBombs;
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
      const pal = paletteOf(blk);
      fx.chips(x, y, pal.wall, 5);
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
    ui.hideGo();
    ui.message(level.hintPlace, 2600);
  };

  game.stop = function () {
    game.running = false;
    ui.hideHand();
    ui.hideMessage();
    ui.hideGo();
  };

  function paletteOf(blk) {
    const meta = blk.plugin.meta;
    return meta.palette || game.level.buildings[meta.bi].palette;
  }

  /* 爆弾の現在ワールド位置（ホストブロックの位置＋回転済みローカルオフセット） */
  function bombWorldPos(b) {
    const h = b.host;
    const c = Math.cos(h.angle), s = Math.sin(h.angle);
    return {
      x: h.position.x + b.off.x * c - b.off.y * s,
      y: h.position.y + b.off.x * s + b.off.y * c,
    };
  }
  game.bombWorldPos = bombWorldPos;

  /* ---------- 画面座標ヘルパー ---------- */
  game.socketScreen = function (i) {
    const s = game.pstate.sockets[i];
    return window.GameRender.screenPos(s.x, s.y);
  };
  game.bombScreen = function (i) {
    const p = bombWorldPos(game.bombs[i]);
    return window.GameRender.screenPos(p.x, p.y);
  };

  function nearestBomb(sx, sy, status) {
    let best = null, bestD = GRAB_PX;
    for (const b of game.bombs) {
      if (b.status !== status) continue;
      const w = bombWorldPos(b);
      const p = window.GameRender.screenPos(w.x, w.y);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bestD) { best = b; bestD = d; }
    }
    return best;
  }

  function nearestBlock(sx, sy) {
    let best = null, bestD = GRAB_PX;
    for (const blk of physics.activeBlocks(game.pstate)) {
      const p = window.GameRender.screenPos(blk.position.x, blk.position.y);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bestD) { best = blk; bestD = d; }
    }
    return best;
  }

  /* ---------- 入力 ---------- */
  game.tap = function (sx, sy) {
    if (!game.running) return;

    if (game.phase === 'place') {
      /* 置いた爆弾をタップ → 外して置き直せる */
      const placed = nearestBomb(sx, sy, 'armed');
      if (placed) {
        game.bombs.splice(game.bombs.indexOf(placed), 1);
        audio.play('tap');
        updateGo();
        return;
      }
      /* 好きなブロックをタップ → そこに爆弾を貼り付ける */
      const blk = nearestBlock(sx, sy);
      if (blk) {
        if (game.bombs.length >= game.maxBombs) {
          ui.message('ばくだんは もう ないよ！', 1600);
          audio.play('tap');
          return;
        }
        if (game.bombs.some((b) => b.host === blk)) return;
        /* タップした位置そのままにブロックへ貼り付ける（ローカルオフセット保持） */
        const w = window.GameRender.worldFromScreen(sx, sy);
        const half = 26;
        const off = {
          x: Math.max(-half, Math.min(half, w.x - blk.position.x)),
          y: Math.max(-half, Math.min(half, w.y - blk.position.y)),
        };
        game.bombs.push({ host: blk, status: 'armed', fuseT: 0, off });
        audio.play('pop');
        updateGo();
      }
    } else if (game.phase === 'boom' || game.phase === 'settle') {
      const b = nearestBomb(sx, sy, 'armed');
      if (b) {
        b.status = 'lit';
        b.fuseT = FUSE_TIME;
        audio.play('fuse');
      }
    }
  };

  function updateGo() {
    if (game.bombs.length >= game.minBombs) ui.showGo(); else ui.hideGo();
  }

  /* 「ばくは かいし！」ボタン */
  game.startBoom = function () {
    if (!game.running || game.phase !== 'place') return;
    if (game.bombs.length < game.minBombs) return;
    game.phase = 'boom';
    ui.hideGo();
    audio.play('tap');
    ui.message(game.level.hintBoom, 3200);
  };

  /* ---------- 進行 ---------- */
  function detonateBomb(bomb) {
    bomb.status = 'done';
    const host = bomb.host;
    const pos = bombWorldPos(bomb);
    const meta = host.plugin.meta;
    /* 下の装置がまだ残っているのに上を爆破 → ささえごと壊す雑な爆破でほこり増 */
    const messy = game.bombs.some((b) =>
      b !== bomb && (b.status === 'armed' || b.status === 'lit') &&
      b.host.plugin.meta.bi === meta.bi && b.host.plugin.meta.row < meta.row);
    const destroyed = physics.detonate(game.pstate, pos);
    fx.explosion(pos.x, pos.y, messy ? 120 : 90, paletteOf(host).wall);
    audio.play('boom');
    const mult = (1 + fx.airborneDust() * 3.0) * (messy ? 1.8 : 1);
    game.dust += (9 + destroyed * 1.2) * mult;
  }

  function evaluate() {
    game.phase = 'done';
    const b = game.pstate.bounds;

    /* 建築モード：星評価なしのごほうびエンド */
    if (game.level.sandbox) {
      fx.confetti((b.minX + b.maxX) / 2, b.topY + 60, (b.maxX - b.minX) * 0.7);
      audio.play('yay');
      if (game.events.onCleared) game.events.onCleared(-1, 'ドッカーン！やったね！');
      return;
    }

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
    fx.confetti((b.minX + b.maxX) / 2, b.topY + 60, (b.maxX - b.minX) * 0.7);
    audio.play('yay');
    if (game.events.onCleared) game.events.onCleared(stars, comment);
  }

  game.update = function (dt, time) {
    if (!game.running) return;
    game.simTime += dt;
    game.impactBudget = 3;

    /* どうかせん */
    for (const b of game.bombs) {
      if (b.status === 'lit') {
        b.fuseT -= dt;
        if (b.fuseT <= 0) detonateBomb(b);
      }
    }

    physics.update(game.pstate, dt);
    fx.update(dt);

    /* 爆弾のついたブロックが消えたとき：
     * 爆風で消し飛んだ → 誘爆／衝撃で砕けた → 近くのがれきに乗り移る */
    for (const b of game.bombs) {
      if (b.status !== 'armed' && b.status !== 'lit') continue;
      const meta = b.host.plugin.meta;
      if (!meta.removed) continue;
      if (meta.removedBy === 'blast') {
        detonateBomb(b);
        continue;
      }
      const pos = bombWorldPos(b);
      /* 動きの遅い（落ち着いた）がれきを優先して乗り移る */
      let best = null, bestScore = Infinity;
      for (const blk of physics.activeBlocks(game.pstate)) {
        const d = Math.hypot(blk.position.x - pos.x, blk.position.y - pos.y);
        if (d > 95) continue;
        const speed = Math.hypot(blk.velocity.x, blk.velocity.y);
        const score = d + speed * 25;
        if (score < bestScore) { best = blk; bestScore = score; }
      }
      if (best) {
        const half = 26;
        b.host = best;
        b.off = {
          x: Math.max(-half, Math.min(half, pos.x - best.position.x)),
          y: Math.max(-half, Math.min(half, pos.y - best.position.y)),
        };
      } else {
        detonateBomb(b); /* まわりに何もなければその場で爆発 */
      }
    }

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
      const allDone = game.bombs.length > 0 && game.bombs.every((s) => s.status === 'done');
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
      if (game.phase === 'place') {
        if (game.bombs.length < game.minBombs) {
          /* まだ爆弾がのっていないおすすめポイントを指す */
          const hint = game.pstate.sockets.find((s) =>
            !game.bombs.some((b) =>
              Math.hypot(b.host.position.x - s.x, b.host.position.y - s.y) < 30));
          if (hint) {
            const p = window.GameRender.screenPos(hint.x, hint.y);
            ui.handAt(p.x + 18, p.y + 12);
          } else {
            ui.hideHand();
          }
        } else {
          ui.handAtGo(); /* 「ばくはかいし！」ボタンを指す */
        }
      } else if (game.phase === 'boom') {
        const b = game.bombs.find((s) => s.status === 'armed');
        if (b) {
          const w = bombWorldPos(b);
          const p = window.GameRender.screenPos(w.x, w.y);
          ui.handAt(p.x + 18, p.y + 12);
        } else {
          ui.hideHand();
        }
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
      bombs: game.bombs,
    });
  };

  window.GameCore = game;
})();
