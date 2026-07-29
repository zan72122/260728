// 領域の中に生まれる「下流の変化」:
//   赤 → お花が咲く / 橙 → ちょうちょ / 黄 → 泡がわく
//   緑 → 芽が出る / 青 → 池になって波紋と魚 / 紫 → 星がまたたく
// 領域の色が変わったり縮んだりすると、そっと消えていく。

import { COLORS, DECO } from './config.js';

const TWO_PI = Math.PI * 2;

export class Decor {
  constructor() {
    this.items = [];
    this.spawnTimer = 0;
  }

  clear() {
    for (const it of this.items) it.state = 'fade';
  }

  update(dt, field, seeds, particles) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && seeds.length > 0) {
      this.spawnTimer = DECO.SPAWN_INTERVAL;
      this.trySpawn(field, seeds);
    }

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;

      // 今もその色の領域の中にいるか確認。外れたら消えていく。
      if (it.state !== 'fade') {
        const ownerIdx = field.ownerAt(it.x, it.y);
        const seed = ownerIdx >= 0 ? seeds[ownerIdx] : null;
        if (!seed || seed.colorIdx !== it.colorIdx) it.state = 'fade';
      }

      if (it.state === 'grow') {
        it.scale = Math.min(1, it.scale + dt * 1.8);
        if (it.scale >= 1) it.state = 'alive';
      } else if (it.state === 'fade') {
        it.scale -= dt * 2.2;
        if (it.scale <= 0) { this.items.splice(i, 1); continue; }
      }

      // 湧き出しタイプの装飾
      it.emitT -= dt;
      if (it.emitT <= 0 && it.state === 'alive') {
        if (it.type === 'bubbler') {
          particles.bubble(it.x + (Math.random() - 0.5) * 24, it.y);
          it.emitT = 0.5 + Math.random() * 0.9;
        } else if (it.type === 'pond') {
          particles.ring(it.x + (Math.random() - 0.5) * 30, it.y + (Math.random() - 0.5) * 30,
            'rgba(230,250,255,0.75)', 30 + Math.random() * 24);
          it.emitT = 1.2 + Math.random() * 1.6;
        } else if (it.type === 'star') {
          particles.sparkle(it.x + (Math.random() - 0.5) * 26, it.y + (Math.random() - 0.5) * 26, '#f2e6ff');
          it.emitT = 0.8 + Math.random() * 1.4;
        } else {
          it.emitT = 1;
        }
      }
    }
  }

  trySpawn(field, seeds) {
    const seedIdx = (Math.random() * seeds.length) | 0;
    const seed = seeds[seedIdx];
    if (!seed || seed.r < 40) return;

    // その色の装飾が多すぎないように
    let sameColor = 0;
    let seedsOfColor = 0;
    for (const it of this.items) if (it.colorIdx === seed.colorIdx) sameColor++;
    for (const s of seeds) if (s.colorIdx === seed.colorIdx) seedsOfColor++;
    if (sameColor >= seedsOfColor * DECO.MAX_PER_SEED) return;

    const spot = field.randomInteriorCell(seedIdx, DECO.MIN_DEPTH);
    if (!spot) return;
    for (const it of this.items) {
      if (Math.hypot(it.x - spot.x, it.y - spot.y) < DECO.MIN_GAP) return;
    }
    this.items.push({
      type: COLORS[seed.colorIdx].deco,
      colorIdx: seed.colorIdx,
      x: spot.x, y: spot.y,
      age: 0, scale: 0, state: 'grow',
      phase: Math.random() * TWO_PI,
      emitT: Math.random(),
    });
  }

  draw(ctx, t) {
    for (const it of this.items) {
      const s = it.scale * (1 + Math.sin(t * 2.2 + it.phase) * 0.05);
      if (s <= 0.01) continue;
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.scale(s, s);
      switch (it.type) {
        case 'flower':    drawFlower(ctx, t, it.phase); break;
        case 'butterfly': drawButterfly(ctx, t, it.phase); break;
        case 'bubbler':   drawFoam(ctx, t, it.phase); break;
        case 'sprout':    drawSprout(ctx, t, it.phase); break;
        case 'pond':      drawFish(ctx, t, it.phase); break;
        case 'star':      drawStar(ctx, t, it.phase); break;
      }
      ctx.restore();
    }
  }
}

// ---- それぞれの絵 ----

function drawFlower(ctx, t, phase) {
  ctx.rotate(Math.sin(t * 1.4 + phase) * 0.08);
  ctx.fillStyle = '#ffc7d4';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TWO_PI + phase * 0.2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * 8, Math.sin(a) * 8, 7, 4.5, a, 0, TWO_PI);
    ctx.fill();
  }
  ctx.fillStyle = '#ffe066';
  ctx.beginPath();
  ctx.arc(0, 0, 4.5, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = '#fff3bf';
  ctx.beginPath();
  ctx.arc(-1.2, -1.2, 1.6, 0, TWO_PI);
  ctx.fill();
}

function drawButterfly(ctx, t, phase) {
  // その場でひらひら
  ctx.translate(Math.sin(t * 1.3 + phase) * 7, Math.cos(t * 1.7 + phase) * 5);
  const flap = 0.45 + Math.abs(Math.sin(t * 7 + phase)) * 0.55;
  ctx.fillStyle = '#ffb066';
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side * flap, 1);
    ctx.beginPath();
    ctx.ellipse(7, -4, 7, 5, 0.5, 0, TWO_PI);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(6, 4, 5.5, 4, -0.4, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#fff1dc';
    ctx.beginPath();
    ctx.arc(8, -4, 1.8, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#ffb066';
    ctx.restore();
  }
  ctx.fillStyle = '#8a5a3b';
  ctx.beginPath();
  ctx.ellipse(0, 0, 1.6, 6, 0, 0, TWO_PI);
  ctx.fill();
}

function drawFoam(ctx, t, phase) {
  // あわあわのかたまり
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1.2;
  const bumps = [[-6, 2, 5], [0, -3, 6], [7, 2, 4.5], [2, 5, 4]];
  for (const [x, y, r] of bumps) {
    const rr = r * (1 + Math.sin(t * 3 + phase + x) * 0.12);
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawSprout(ctx, t, phase) {
  ctx.rotate(Math.sin(t * 1.6 + phase) * 0.09);
  ctx.strokeStyle = '#3f9c46';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.quadraticCurveTo(1.5, 0, 0, -8);
  ctx.stroke();
  ctx.fillStyle = '#5cc45f';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 6, -6, 6.5, 3.6, side * -0.7, 0, TWO_PI);
    ctx.fill();
  }
  ctx.fillStyle = '#a5e8a0';
  ctx.beginPath();
  ctx.arc(0, -9.5, 2.4, 0, TWO_PI);
  ctx.fill();
}

function drawFish(ctx, t, phase) {
  // ちいさな魚がくるくる泳ぐ
  const a = t * 1.1 + phase;
  const px = Math.cos(a) * 13;
  const py = Math.sin(a) * 9;
  ctx.translate(px, py);
  const dir = Math.sin(a + Math.PI / 2) >= 0 ? 1 : -1;
  ctx.scale(dir, 1);
  ctx.fillStyle = '#ff9d76';
  ctx.beginPath();
  ctx.ellipse(0, 0, 8, 4.5, 0, 0, TWO_PI);
  ctx.fill();
  const wag = Math.sin(t * 9 + phase) * 2;
  ctx.beginPath();
  ctx.moveTo(-7, 0);
  ctx.lineTo(-13, -4 + wag);
  ctx.lineTo(-13, 4 + wag);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(4.5, -1, 1.1, 0, TWO_PI);
  ctx.fill();
}

function drawStar(ctx, t, phase) {
  const tw = 0.65 + Math.sin(t * 3.2 + phase) * 0.35;
  ctx.globalAlpha = tw;
  ctx.rotate(Math.sin(t * 0.9 + phase) * 0.25);
  ctx.fillStyle = '#fff3ac';
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 9 : 4;
    const a = (i / 10) * TWO_PI - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;
}
