// 飛沫・キラキラなどの小さな装飾パーティクル。
// 上限数を超えたら古いものから消して性能を守る。

import { CONFIG } from './config.js';
import { rybCss } from './color.js';

export class ParticleSystem {
  constructor() {
    this.items = [];
  }

  /** 着水の飛沫 */
  splash(x, y, ryb, size = 1) {
    const n = Math.min(8, 3 + Math.round(size * 2));
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
      const spd = 90 + Math.random() * 160 * Math.sqrt(size);
      this._add({
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        r: 1.6 + Math.random() * 2.4,
        life: 0.4 + Math.random() * 0.25,
        ryb,
        kind: 'drop',
      });
    }
  }

  /** 花などのキラキラ */
  sparkle(x, y, count = 5) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 20 + Math.random() * 60;
      this._add({
        x: x + (Math.random() - 0.5) * 18,
        y: y + (Math.random() - 0.5) * 18,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 40,
        r: 1.5 + Math.random() * 2,
        life: 0.6 + Math.random() * 0.5,
        ryb: null,
        kind: 'sparkle',
      });
    }
  }

  /** あふれの泡 */
  bubbles(x, y, ryb, count = 4) {
    for (let i = 0; i < count; i++) {
      this._add({
        x: x + (Math.random() - 0.5) * 16,
        y,
        vx: (Math.random() - 0.5) * 30,
        vy: -40 - Math.random() * 50,
        r: 2 + Math.random() * 3,
        life: 0.5 + Math.random() * 0.4,
        ryb,
        kind: 'bubble',
      });
    }
  }

  _add(p) {
    p.maxLife = p.life;
    this.items.push(p);
    if (this.items.length > CONFIG.MAX_PARTICLES) {
      this.items.splice(0, this.items.length - CONFIG.MAX_PARTICLES);
    }
  }

  update(dt) {
    const g = CONFIG.GRAVITY * 0.55;
    for (const p of this.items) {
      p.life -= dt;
      if (p.kind !== 'bubble') p.vy += g * dt;
      else p.vy -= 20 * dt; // 泡は浮かぶ
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.items = this.items.filter((p) => p.life > 0);
  }

  draw(ctx, time) {
    for (const p of this.items) {
      const a = Math.max(0, p.life / p.maxLife);
      if (p.kind === 'sparkle') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(time * 3 + p.x);
        ctx.fillStyle = `rgba(255,240,160,${0.9 * a})`;
        const s = p.r * (0.7 + 0.5 * a);
        // 小さな十字のきらめき
        ctx.fillRect(-s * 2, -s * 0.4, s * 4, s * 0.8);
        ctx.fillRect(-s * 0.4, -s * 2, s * 0.8, s * 4);
        ctx.restore();
      } else if (p.kind === 'bubble') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.strokeStyle = p.ryb ? rybCss(p.ryb, 0.7 * a) : `rgba(255,255,255,${0.7 * a})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.5 + a * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = p.ryb ? rybCss(p.ryb, 0.85 * a) : `rgba(160,200,255,${0.8 * a})`;
        ctx.fill();
      }
    }
  }
}
