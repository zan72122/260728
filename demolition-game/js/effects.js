/* effects.js — パーティクルのデータ管理と画面シェイク。
 * 描画は render3d.js が parts を読んで行う（ここは位置と寿命の更新のみ）。
 */
(function () {
  'use strict';

  const parts = [];  /* {kind,x,y,vx,vy,r,life,maxLife,color,rot,vr,size,z,r0,r1} */
  let shake = 0;

  const DUST_COLORS = ['#b9b2a6', '#cfc8bb', '#a8a196', '#ded8cc'];
  const FIRE_COLORS = ['#ffd23e', '#ff9b1a', '#ff5a36', '#fff3b0'];
  const CONFETTI_COLORS = ['#ff5a5a', '#ffb02e', '#7ed957', '#5ab8ff', '#c77dff', '#ff8fd4'];

  const GROUND = 596; /* GROUND_Y (600) のわずかに上 */

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function shade(hex, mult) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v * mult)));
    const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  const fx = {};
  fx.parts = parts;

  fx.clear = function () { parts.length = 0; shake = 0; };

  fx.shake = function (amount) { shake = Math.max(shake, amount); };
  fx.getShake = function () { return shake; };

  /* コンクリートの破片（小さな箱） */
  fx.chips = function (x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(2, 8);
      parts.push({
        kind: 'chip', x, y,
        vx: Math.cos(a) * sp, vy: -Math.abs(Math.sin(a)) * sp - 2,
        z: rnd(-10, 40),
        size: rnd(7, 16), life: 0, maxLife: rnd(0.8, 1.5),
        color: shade(color, rnd(0.7, 1.05)),
        rot: rnd(0, Math.PI * 2), vr: rnd(-8, 8),
      });
    }
  };

  /* 爆発：閃光＋衝撃波リング＋火花＋破片＋大きなほこり雲 */
  fx.explosion = function (x, y, radius, color) {
    parts.push({
      kind: 'flash', x, y, vx: 0, vy: 0,
      r: radius * 0.9, life: 0, maxLife: 0.18, color: '#fff3c8',
    });
    parts.push({
      kind: 'ring', x, y, vx: 0, vy: 0,
      r0: radius * 0.3, r1: radius * 2.4, life: 0, maxLife: 0.5, color: '#ffe9a8',
    });
    for (let i = 0; i < 18; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(3, 11);
      parts.push({
        kind: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2,
        r: rnd(6, 16), life: 0, maxLife: rnd(0.25, 0.5),
        color: FIRE_COLORS[(Math.random() * FIRE_COLORS.length) | 0],
      });
    }
    fx.chips(x, y, color || '#c9bfae', 10);
    const n = Math.round(radius * 0.35);
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), d = rnd(0, radius * 0.9);
      parts.push({
        kind: 'dust', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d,
        vx: rnd(-1.6, 1.6), vy: rnd(-2.2, -0.4), z: rnd(-20, 50),
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
        vx: rnd(-1.2, 1.2), vy: rnd(-1.6, -0.3), z: rnd(-10, 40),
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
        vx: rnd(-3, 3), vy: rnd(-13, -6), z: rnd(0, 120),
        r: rnd(6, 11), life: 0, maxLife: rnd(1.8, 3),
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
      } else if (p.kind === 'chip') {
        p.vy += 26 * dt;            /* 重力で落ちる */
        p.rot += p.vr * dt;
        if (p.y > GROUND) {         /* 地面でバウンド */
          p.y = GROUND;
          p.vy = -Math.abs(p.vy) * 0.35;
          p.vx *= 0.7;
        }
      } else if (p.kind === 'confetti') {
        p.vy += 14 * dt;
        p.vx *= (1 - 0.4 * dt);
        p.rot += p.vr * dt;
        if (p.y > GROUND) { p.y = GROUND; p.vy = 0; p.vx *= 0.5; }
      }
    }
  };

  window.GameFx = fx;
})();
