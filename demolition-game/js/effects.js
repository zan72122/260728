/* effects.js — ほこり・爆発・紙吹雪などのパーティクルと画面シェイク */
(function () {
  'use strict';

  const parts = [];       /* {kind,x,y,vx,vy,r,life,maxLife,color,rot,vr} */
  let shake = 0;

  const DUST_COLORS = ['#b9b2a6', '#cfc8bb', '#a8a196', '#ded8cc'];
  const FIRE_COLORS = ['#ffd23e', '#ff9b1a', '#ff5a36', '#fff3b0'];
  const CONFETTI_COLORS = ['#ff5a5a', '#ffb02e', '#7ed957', '#5ab8ff', '#c77dff', '#ff8fd4'];

  function rnd(a, b) { return a + Math.random() * (b - a); }

  const fx = {};

  fx.clear = function () { parts.length = 0; shake = 0; };

  fx.shake = function (amount) { shake = Math.max(shake, amount); };
  fx.getShake = function () { return shake; };

  /* 爆発：火花＋大きなほこり雲 */
  fx.explosion = function (x, y, radius) {
    for (let i = 0; i < 18; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(3, 11);
      parts.push({
        kind: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2,
        r: rnd(6, 16), life: 0, maxLife: rnd(0.25, 0.5),
        color: FIRE_COLORS[(Math.random() * FIRE_COLORS.length) | 0],
      });
    }
    const n = Math.round(radius * 0.35);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), d = rnd(0, radius * 0.9);
      parts.push({
        kind: 'dust', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d,
        vx: rnd(-1.6, 1.6), vy: rnd(-2.2, -0.4),
        r: rnd(14, 34), life: 0, maxLife: rnd(1.2, 2.2),
        color: DUST_COLORS[(Math.random() * DUST_COLORS.length) | 0],
      });
    }
    fx.shake(Math.min(22, radius * 0.16));
  };

  /* 衝撃地点の小さなほこり */
  fx.dustAt = function (x, y, intensity) {
    const n = Math.min(6, Math.max(1, Math.round(intensity)));
    for (let i = 0; i < n; i++) {
      parts.push({
        kind: 'dust', x: x + rnd(-14, 14), y: y + rnd(-8, 8),
        vx: rnd(-1.2, 1.2), vy: rnd(-1.6, -0.3),
        r: rnd(8, 18), life: 0, maxLife: rnd(0.9, 1.8),
        color: DUST_COLORS[(Math.random() * DUST_COLORS.length) | 0],
      });
    }
  };

  fx.confetti = function (worldX, worldY, spreadW) {
    for (let i = 0; i < 90; i++) {
      parts.push({
        kind: 'confetti',
        x: worldX + rnd(-spreadW / 2, spreadW / 2), y: worldY,
        vx: rnd(-3, 3), vy: rnd(-13, -6),
        r: rnd(5, 9), life: 0, maxLife: rnd(1.8, 3),
        color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
        rot: rnd(0, Math.PI * 2), vr: rnd(-6, 6),
      });
    }
  };

  /* 空中に漂うほこりの量 0..1（連続爆破のほこり倍率に使う） */
  fx.airborneDust = function () {
    let c = 0;
    for (const p of parts) if (p.kind === 'dust') c++;
    return Math.min(1, c / 140);
  };

  fx.update = function (dt) {
    shake = Math.max(0, shake - dt * 40);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt;
      if (p.life >= p.maxLife) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      if (p.kind === 'dust') {
        p.vy -= 0.6 * dt;           /* ゆっくり上昇 */
        p.vx *= (1 - 0.6 * dt);
        p.r += 14 * dt;             /* 広がる */
      } else if (p.kind === 'fire') {
        p.vy += 6 * dt;
        p.r *= (1 - 2.2 * dt);
      } else if (p.kind === 'confetti') {
        p.vy += 14 * dt;
        p.vx *= (1 - 0.4 * dt);
        p.rot += p.vr * dt;
      }
    }
  };

  fx.draw = function (ctx) {
    for (const p of parts) {
      const t = p.life / p.maxLife;
      let alpha = 1 - t;
      if (p.kind === 'dust') alpha = 0.55 * (1 - t * t);
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = p.color;
      if (p.kind === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.r), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  };

  window.GameFx = fx;
})();
