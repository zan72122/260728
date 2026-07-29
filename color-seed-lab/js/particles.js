// キラキラ・水しぶき・泡・波紋などの短命パーティクル

import { MAX_PARTICLES } from './config.js';

const TWO_PI = Math.PI * 2;

export class Particles {
  constructor() {
    this.list = [];
  }

  push(p) {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    this.list.push(p);
  }

  // 境目などで光る小さなキラキラ
  sparkle(x, y, color = '#ffffff') {
    this.push({
      kind: 'sparkle', x, y, color,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 0.5) * 14 - 8,
      age: 0, life: 0.5 + Math.random() * 0.6,
      size: 2.5 + Math.random() * 3.5,
      spin: Math.random() * TWO_PI,
    });
  }

  // じょうろの水滴
  drop(x, y) {
    this.push({
      kind: 'drop',
      x: x + (Math.random() - 0.5) * 70,
      y: y - 40 - Math.random() * 50,
      targetY: y + (Math.random() - 0.5) * 50,
      vy: 60 + Math.random() * 80,
      age: 0, life: 2,
      size: 2.5 + Math.random() * 2,
    });
  }

  // 広がる波紋
  ring(x, y, color = 'rgba(255,255,255,0.7)', maxR = 46) {
    this.push({
      kind: 'ring', x, y, color, maxR,
      age: 0, life: 0.9 + Math.random() * 0.4,
    });
  }

  // ふわふわ上る泡
  bubble(x, y, big = false) {
    this.push({
      kind: 'bubble', x, y,
      vy: -(18 + Math.random() * 26) * (big ? 1.3 : 1),
      wob: Math.random() * TWO_PI,
      age: 0, life: 1.6 + Math.random() * 1.6,
      size: (big ? 7 : 3.5) + Math.random() * (big ? 8 : 4),
    });
  }

  // 種を置いた時などの放射状のはじけ
  burst(x, y, color, count = 12, speed = 90) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TWO_PI + Math.random() * 0.4;
      const v = speed * (0.5 + Math.random() * 0.7);
      this.push({
        kind: 'dot', x, y, color,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        age: 0, life: 0.5 + Math.random() * 0.35,
        size: 3 + Math.random() * 3.5,
      });
    }
  }

  update(dt) {
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.age += dt;
      let dead = p.age >= p.life;
      switch (p.kind) {
        case 'sparkle':
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.spin += dt * 6;
          break;
        case 'dot':
          p.x += p.vx * dt; p.y += p.vy * dt;
          p.vx *= 1 - 2.5 * dt; p.vy *= 1 - 2.5 * dt;
          break;
        case 'drop':
          p.vy += 320 * dt;
          p.y += p.vy * dt;
          if (p.y >= p.targetY) {
            dead = true;
            this.ring(p.x, p.targetY, 'rgba(255,255,255,0.55)', 18 + Math.random() * 14);
          }
          break;
        case 'bubble':
          p.y += p.vy * dt;
          p.x += Math.sin(p.age * 4 + p.wob) * 14 * dt;
          break;
        case 'ring':
          break;
      }
      if (dead) list.splice(i, 1);
    }
  }

  draw(ctx) {
    for (const p of this.list) {
      const k = p.age / p.life;
      const fade = 1 - k;
      switch (p.kind) {
        case 'sparkle': {
          ctx.save();
          ctx.globalAlpha = fade;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.spin);
          ctx.fillStyle = p.color;
          const s = p.size * (0.6 + 0.4 * Math.sin(p.age * 14));
          // ダイヤ型のきらめき
          ctx.beginPath();
          ctx.moveTo(0, -s); ctx.lineTo(s * 0.35, 0);
          ctx.lineTo(0, s); ctx.lineTo(-s * 0.35, 0);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(-s, 0); ctx.lineTo(0, s * 0.35);
          ctx.lineTo(s, 0); ctx.lineTo(0, -s * 0.35);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'dot':
          ctx.globalAlpha = fade;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * fade, 0, TWO_PI);
          ctx.fill();
          ctx.globalAlpha = 1;
          break;
        case 'drop':
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = '#bfe9ff';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.size * 0.7, p.size * 1.3, 0, 0, TWO_PI);
          ctx.fill();
          ctx.globalAlpha = 1;
          break;
        case 'bubble': {
          ctx.globalAlpha = 0.75 * fade + 0.15;
          ctx.strokeStyle = 'rgba(255,255,255,0.95)';
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, TWO_PI);
          ctx.fill();
          ctx.stroke();
          // 泡のつや
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.beginPath();
          ctx.arc(p.x - p.size * 0.35, p.y - p.size * 0.35, p.size * 0.22, 0, TWO_PI);
          ctx.fill();
          ctx.globalAlpha = 1;
          break;
        }
        case 'ring': {
          const r = 4 + (p.maxR - 4) * k;
          ctx.globalAlpha = fade * 0.8;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2.5 * fade + 0.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, TWO_PI);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
      }
    }
  }
}
