// パーティクル：空気のもや・キラキラ・紙ふぶき・ハートなど。
// space が 'world' ならカメラ変換の内側、'screen' なら画面座標で描く。
import { TAU, rand, clamp } from './util.js';

export class Particles {
  constructor() {
    this.items = [];
  }

  clear() { this.items.length = 0; }

  spawn(p) {
    if (this.items.length > 420) this.items.shift();
    this.items.push({
      x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0.6,
      life: 0, max: 1, size: 8, rot: 0, spin: 0,
      color: '#ffffff', type: 'puff', space: 'world',
      ...p,
    });
  }

  /** 空気が抜けるモワッ */
  airPuff(x, y, dirX, dirY, n = 6, space = 'world') {
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dirY, dirX) + rand(-0.55, 0.55);
      const sp = rand(60, 190);
      this.spawn({
        x: x + rand(-4, 4), y: y + rand(-4, 4),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
        g: -34, drag: 1.4, max: rand(0.6, 1.15), size: rand(7, 16),
        type: 'puff', color: '#ffffff', space,
      });
    }
  }

  sparkle(x, y, n = 8, color = '#FFE9A3', space = 'world', spread = 40) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(50, 210);
      this.spawn({
        x: x + Math.cos(a) * rand(0, spread), y: y + Math.sin(a) * rand(0, spread),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: 40, drag: 2.2, max: rand(0.45, 0.9), size: rand(5, 12),
        rot: rand(0, TAU), spin: rand(-7, 7),
        type: 'sparkle', color, space,
      });
    }
  }

  confetti(x, y, n = 26, space = 'screen') {
    const cols = ['#FF8FA3', '#FFD36E', '#8ED2F5', '#A8E6A1', '#C6A8F5', '#FFFFFF'];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rand(-1.1, 1.1);
      const sp = rand(260, 620);
      this.spawn({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: 900, drag: 0.35, max: rand(1.4, 2.6), size: rand(8, 15),
        rot: rand(0, TAU), spin: rand(-11, 11),
        type: 'confetti', color: cols[i % cols.length], space,
      });
    }
  }

  heart(x, y, n = 3, space = 'screen') {
    for (let i = 0; i < n; i++) {
      this.spawn({
        x: x + rand(-14, 14), y: y + rand(-10, 10),
        vx: rand(-40, 40), vy: rand(-150, -70),
        g: 40, drag: 0.8, max: rand(0.8, 1.3), size: rand(12, 20),
        rot: rand(-0.3, 0.3), spin: rand(-1.5, 1.5),
        type: 'heart', color: ['#FF8FA3', '#FFB3C6', '#FFD36E'][i % 3], space,
      });
    }
  }

  dust(x, y, dir = -1, space = 'world') {
    this.spawn({
      x, y, vx: rand(20, 70) * dir, vy: rand(-40, -8),
      g: 60, drag: 1.8, max: rand(0.4, 0.8), size: rand(6, 13),
      type: 'puff', color: '#EBD9B6', space,
    });
  }

  update(dt) {
    const list = this.items;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life += dt;
      if (p.life >= p.max) { list.splice(i, 1); continue; }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
  }

  draw(ctx, space) {
    for (const p of this.items) {
      if (p.space !== space) continue;
      const t = clamp(p.life / p.max, 0, 1);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      switch (p.type) {
        case 'puff': {
          const s = p.size * (0.55 + t * 1.15);
          ctx.globalAlpha = (1 - t) * 0.72;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(0, 0, s, 0, TAU);
          ctx.arc(s * 0.7, -s * 0.35, s * 0.62, 0, TAU);
          ctx.fill();
          break;
        }
        case 'sparkle': {
          const s = p.size * (1 - t * 0.55);
          ctx.globalAlpha = 1 - t * t;
          ctx.fillStyle = p.color;
          star4(ctx, s);
          ctx.fill();
          break;
        }
        case 'confetti': {
          const s = p.size;
          ctx.globalAlpha = t > 0.75 ? (1 - t) * 4 : 1;
          ctx.fillStyle = p.color;
          const sq = Math.abs(Math.cos(p.life * 7));
          ctx.fillRect(-s / 2, (-s * 0.6 * sq) / 2, s, s * 0.62 * sq + 1.5);
          break;
        }
        case 'heart': {
          const s = p.size * (1 + t * 0.35);
          ctx.globalAlpha = 1 - t * t;
          ctx.fillStyle = p.color;
          heartPath(ctx, s);
          ctx.fill();
          break;
        }
        default:
          break;
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

export function star4(ctx, s) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2;
    const r = i % 2 === 0 ? s : s * 0.34;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function heartPath(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(0, s * 0.42);
  ctx.bezierCurveTo(-s * 1.05, -s * 0.25, -s * 0.5, -s * 0.95, 0, -s * 0.35);
  ctx.bezierCurveTo(s * 0.5, -s * 0.95, s * 1.05, -s * 0.25, 0, s * 0.42);
  ctx.closePath();
}
