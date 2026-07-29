/*
 * particles.js
 * モアレの「明るいところ」に反応する粒子エフェクト。
 *  - glint : 模様の山にきらめく光の粒 (常時、控えめに)
 *  - drop  : 霧吹きの水滴。ゆっくり流れ、明るい線の上で光る
 *  - spark : 重なりの強い場所を速く動かしたときの、花火のような粒
 * 明るさの計算は sheets.js の envelopeAt() (モアレの包絡線) を使う。
 */
(function () {
  'use strict';
  const ML = (window.MoireLab = window.MoireLab || {});

  const MAX_PARTICLES = 260;
  const GLINT_TRIES_PER_FRAME = 6;   // 毎フレームの抽選回数
  const GLINT_THRESHOLD = 0.62;      // これより明るい場所だけ光る
  const SPRAY_DROPS = 30;

  function createParticles(canvas, state) {
    const ctx = canvas.getContext('2d');
    const items = [];
    let width = 0;
    let height = 0;
    let minDim = 1;

    function resize(w, h) {
      width = w;
      height = h;
      minDim = Math.min(w, h);
      canvas.width = w;
      canvas.height = h;
    }

    // 画面ピクセル座標 → ワールド座標 (短辺=1, 中心原点)
    function toWorld(px, py) {
      return [(px - width / 2) / minDim, (py - height / 2) / minDim];
    }

    function push(p) {
      if (items.length >= MAX_PARTICLES) items.shift();
      items.push(p);
    }

    // ---- きらめき: 模様の明るい山に、星のような光を散らす ----
    function spawnGlints() {
      for (let i = 0; i < GLINT_TRIES_PER_FRAME; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const w = toWorld(x, y);
        const env = ML.envelopeAt(state, w[0], w[1]);
        if (env > GLINT_THRESHOLD && Math.random() < (env - GLINT_THRESHOLD) * 1.6) {
          push({
            type: 'glint', x, y,
            life: 0, maxLife: 0.9 + Math.random() * 0.8,
            size: minDim * (0.006 + Math.random() * 0.010),
          });
        }
      }
    }

    // ---- 霧吹き: 画面いっぱいに水滴をまく ----
    function sprayBurst() {
      state.mist = Math.min(1.0, state.mist + 0.4);
      for (let i = 0; i < SPRAY_DROPS; i++) {
        push({
          type: 'drop',
          x: Math.random() * width,
          y: Math.random() * height * 0.85,
          vy: minDim * (0.010 + Math.random() * 0.028),
          sway: Math.random() * Math.PI * 2,
          life: 0, maxLife: 3.5 + Math.random() * 3.0,
          size: minDim * (0.004 + Math.random() * 0.008),
          bright: 0,
        });
      }
      ML.audio.shimmer();
    }

    // ---- 花火: 重なりの強い場所を勢いよく動かしたとき ----
    function burstAt(px, py) {
      const n = 14 + Math.floor(Math.random() * 8);
      const baseHue = Math.random() * 360;
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = minDim * (0.10 + Math.random() * 0.22);
        push({
          type: 'spark',
          x: px, y: py,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          hue: (baseHue + Math.random() * 70) % 360,
          life: 0, maxLife: 0.7 + Math.random() * 0.6,
          size: minDim * (0.004 + Math.random() * 0.006),
        });
      }
      ML.audio.twinkle();
    }

    function update(dt) {
      spawnGlints();
      for (let i = items.length - 1; i >= 0; i--) {
        const p = items[i];
        p.life += dt;
        if (p.life >= p.maxLife) { items.splice(i, 1); continue; }
        if (p.type === 'drop') {
          p.sway += dt * 2.0;
          p.x += Math.sin(p.sway) * minDim * 0.006 * dt * 10;
          p.y += p.vy * dt * 10;
          if (p.y > height + 20) { items.splice(i, 1); continue; }
          const w = toWorld(p.x, p.y);
          // 明るい線の上に来た水滴だけ、きらっと光る
          p.bright = Math.max(0, (ML.envelopeAt(state, w[0], w[1]) - 0.4) * 1.8);
        } else if (p.type === 'spark') {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.96;
          p.vy = p.vy * 0.96 + minDim * 0.05 * dt; // ふわっと落ちる
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of items) {
        const t = p.life / p.maxLife;
        if (p.type === 'glint') {
          const a = Math.sin(Math.PI * t); // ふわっと現れて消える
          const r = p.size * (0.6 + 0.8 * a);
          ctx.strokeStyle = `rgba(255, 250, 220, ${0.75 * a})`;
          ctx.lineWidth = Math.max(1, p.size * 0.22);
          ctx.beginPath();
          ctx.moveTo(p.x - r * 1.7, p.y); ctx.lineTo(p.x + r * 1.7, p.y);
          ctx.moveTo(p.x, p.y - r * 1.7); ctx.lineTo(p.x, p.y + r * 1.7);
          ctx.stroke();
          ctx.fillStyle = `rgba(255, 255, 245, ${0.85 * a})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 0.5, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.type === 'drop') {
          const fade = t < 0.1 ? t / 0.1 : (t > 0.8 ? (1 - t) / 0.2 : 1);
          const a = fade * (0.28 + 0.72 * p.bright);
          ctx.fillStyle = `rgba(215, 240, 255, ${0.55 * a})`;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.size * 0.8, p.size * 1.15, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(255, 255, 255, ${0.9 * a})`;
          ctx.beginPath();
          ctx.arc(p.x - p.size * 0.25, p.y - p.size * 0.35, p.size * 0.28, 0, Math.PI * 2);
          ctx.fill();
        } else { // spark
          const a = 1 - t;
          ctx.fillStyle = `hsla(${p.hue}, 90%, 72%, ${0.9 * a})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.5 + a), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    return { resize, update, draw, sprayBurst, burstAt, toWorld };
  }

  ML.createParticles = createParticles;
})();
