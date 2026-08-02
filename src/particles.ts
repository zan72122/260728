import { starPath, TAU, type Ctx } from './gfx';

export type PKind = 'spark' | 'star' | 'drip' | 'puff' | 'sparkle' | 'splash' | 'streak';

export interface Particle {
  kind: PKind;
  x: number; y: number;
  vx: number; vy: number;
  age: number; life: number;
  size: number;
  color: string;
  grav: number;
  rot: number; vr: number;
  floorY?: number;
  onFloor?: (p: Particle) => void;
}

export class Particles {
  list: Particle[] = [];

  add(p: Partial<Particle> & { kind: PKind; x: number; y: number }): void {
    if (this.list.length > 420) this.list.splice(0, 40);
    this.list.push({
      vx: 0, vy: 0, age: 0, life: 0.8, size: 4, color: '#fff', grav: 0, rot: 0, vr: 0,
      ...p,
    });
  }

  sparks(x: number, y: number, n: number, spread = 1): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = (60 + Math.random() * 260) * spread;
      const star = Math.random() < 0.16;
      this.add({
        kind: star ? 'star' : 'spark',
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.8 - 40,
        life: star ? 0.55 + Math.random() * 0.3 : 0.3 + Math.random() * 0.35,
        size: star ? 5 + Math.random() * 5 : 1.6 + Math.random() * 2,
        color: star ? '#ffe9a8' : (Math.random() < 0.5 ? '#ffd977' : '#bfe6ff'),
        grav: 500,
        vr: (Math.random() - 0.5) * 8,
      });
    }
  }

  sparkleBurst(x: number, y: number, n: number, color = '#ffe9a8', spread = 1): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = (30 + Math.random() * 130) * spread;
      this.add({
        kind: 'sparkle', x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30,
        life: 0.5 + Math.random() * 0.5,
        size: 3 + Math.random() * 5,
        color, grav: 60,
        vr: (Math.random() - 0.5) * 6,
      });
    }
  }

  drop(x: number, y: number, color: string, floorY: number): void {
    this.add({
      kind: 'drip', x, y, vx: (Math.random() - 0.5) * 8, vy: 20,
      life: 3, size: 4 + Math.random() * 2, color, grav: 720, floorY,
      onFloor: (p) => {
        for (let i = 0; i < 3; i++) {
          this.add({
            kind: 'splash', x: p.x, y: floorY, vx: (Math.random() - 0.5) * 90,
            vy: -40 - Math.random() * 60, life: 0.35, size: 2.2, color: p.color, grav: 600,
          });
        }
      },
    });
  }

  dust(x: number, y: number, n: number, dir = 0): void {
    for (let i = 0; i < n; i++) {
      this.add({
        kind: 'puff', x: x + (Math.random() - 0.5) * 16, y: y + (Math.random() - 0.5) * 6,
        vx: dir * (30 + Math.random() * 60) + (Math.random() - 0.5) * 40,
        vy: -20 - Math.random() * 40,
        life: 0.5 + Math.random() * 0.4,
        size: 7 + Math.random() * 9,
        color: 'rgba(190,185,178,0.5)', grav: -60,
      });
    }
  }

  streak(x: number, y: number, vx: number, color: string): void {
    this.add({ kind: 'streak', x, y, vx, vy: 0, life: 0.3, size: 3, color, grav: 0 });
  }

  update(dt: number): void {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.age += dt;
      if (p.age >= p.life) { l.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === 'drip' && p.floorY !== undefined && p.y >= p.floorY) {
        p.onFloor?.(p);
        l.splice(i, 1);
      }
    }
  }

  draw(ctx: Ctx): void {
    for (const p of this.list) {
      const t = p.age / p.life;
      const a = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      ctx.save();
      ctx.globalAlpha = a;
      switch (p.kind) {
        case 'spark': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          ctx.stroke();
          break;
        }
        case 'star': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          starPath(ctx, 0, 0, p.size * (1 - t * 0.4), 4, 0.4);
          ctx.fill();
          break;
        }
        case 'sparkle': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          starPath(ctx, 0, 0, p.size * (1 - t * 0.5), 4, 0.32);
          ctx.fill();
          break;
        }
        case 'drip': {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.size * 0.62, p.size, 0, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = a * 0.6;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(p.x - p.size * 0.2, p.y - p.size * 0.3, p.size * 0.22, 0, TAU);
          ctx.fill();
          break;
        }
        case 'splash': {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, TAU);
          ctx.fill();
          break;
        }
        case 'puff': {
          ctx.fillStyle = p.color;
          ctx.globalAlpha = a * 0.6;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.6 + t * 0.8), 0, TAU);
          ctx.fill();
          break;
        }
        case 'streak': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.06, p.y);
          ctx.stroke();
          break;
        }
      }
      ctx.restore();
    }
  }
}
