// 底辺エリアの反応オブジェクト: カップ・スポンジ・紙・水たまり。
// どれも「しずくを受け取ると目に見えて変わる」ことが最優先。
// 花は flowers.js に分離している。

import { CONFIG } from './config.js';
import { mixRyb, rybToRgb, rgbCss, shade } from './color.js';
import { sounds } from './audio.js';

// ---------------------------------------------------------------- カップ
export class Cup {
  constructor(xRatio) {
    this.xRatio = xRatio;
    this.fill = 0;               // 入っている体積
    this.ryb = [0, 0, 1];
    this.wobble = 0;             // 着水時のぷるん
    this.spillTimer = 0;
    this.x = 0; this.w = 64; this.h = 74; this.topY = 0;
  }

  layout(w, groundY, scale) {
    this.x = this.xRatio * w;
    this.w = 58 * scale;
    this.h = 70 * scale;
    this.topY = groundY - this.h;
  }

  get fullness() { return Math.min(1, this.fill / CONFIG.CUP_CAPACITY); }

  /** 落下中のしずくが口に入ったか */
  tryCatch(drop, prevY, world) {
    const inX = Math.abs(drop.x - this.x) < this.w / 2 - 4;
    const crossed = prevY < this.topY + 6 && drop.y + drop.r >= this.topY + 6;
    if (!inX || !crossed) return false;
    this.ryb = this.fill > 0.2 ? mixRyb(this.ryb, this.fill, drop.currentRyb(0), drop.vol) : drop.currentRyb(0).slice();
    this.fill += drop.vol;
    this.wobble = 1;
    const surfaceY = this.topY + (1 - this.fullness) * (this.h - 10) + 4;
    world.particles.splash(drop.x, surfaceY, this.ryb, drop.vol * 0.6);
    sounds.splash(drop.vol);
    return true;
  }

  update(dt, world) {
    this.wobble = Math.max(0, this.wobble - dt * 3);
    // 満杯を超えたぶんは、ふちから小川になってあふれる
    if (this.fill > CONFIG.CUP_CAPACITY) {
      this.spillTimer -= dt;
      if (this.spillTimer <= 0) {
        this.spillTimer = 0.22;
        const excess = Math.min(1.2, this.fill - CONFIG.CUP_CAPACITY);
        this.fill -= excess;
        const side = Math.random() < 0.5 ? -1 : 1;
        world.droplets.spawn(this.x + side * (this.w / 2 - 2), this.topY + 4, this.ryb, {
          vol: excess, vx: side * 40, vy: 10,
        });
        world.particles.bubbles(this.x, this.topY + 4, this.ryb, 3);
        sounds.bubble();
      }
    }
  }

  draw(ctx, time) {
    const squash = 1 + Math.sin((1 - this.wobble) * Math.PI * 2) * this.wobble * 0.06;
    const w = this.w * squash;
    const h = this.h * (2 - squash);
    const x = this.x;
    const bottomY = this.topY + this.h;
    const topW = w;
    const botW = w * 0.78;
    ctx.save();
    // 液体
    if (this.fill > 0.15) {
      const level = this.fullness;
      const liquidH = level * (h - 8);
      const surfY = bottomY - 6 - liquidH;
      const rgb = rybToRgb(this.ryb);
      const lw = botW + (topW - botW) * level;
      ctx.beginPath();
      ctx.moveTo(x - lw / 2 + 3, surfY);
      ctx.lineTo(x - botW / 2 + 3, bottomY - 8);
      ctx.quadraticCurveTo(x, bottomY, x + botW / 2 - 3, bottomY - 8);
      ctx.lineTo(x + lw / 2 - 3, surfY);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, surfY, 0, bottomY);
      grad.addColorStop(0, rgbCss(shade(rgb, 0.15), 0.92));
      grad.addColorStop(1, rgbCss(shade(rgb, -0.15), 0.95));
      ctx.fillStyle = grad;
      ctx.fill();
      // 液面
      ctx.beginPath();
      ctx.ellipse(x, surfY, lw / 2 - 3, 4, 0, 0, Math.PI * 2);
      ctx.fillStyle = rgbCss(shade(rgb, 0.35), 0.9);
      ctx.fill();
    }
    // ガラスのコップ
    ctx.beginPath();
    ctx.moveTo(x - topW / 2, this.topY);
    ctx.lineTo(x - botW / 2, bottomY - 8);
    ctx.quadraticCurveTo(x, bottomY + 2, x + botW / 2, bottomY - 8);
    ctx.lineTo(x + topW / 2, this.topY);
    ctx.strokeStyle = 'rgba(150,170,200,0.75)';
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(210,230,250,0.16)';
    ctx.fill();
    // つやの縦線
    ctx.beginPath();
    ctx.moveTo(x - topW * 0.3, this.topY + 8);
    ctx.lineTo(x - botW * 0.28, bottomY - 14);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  reset() { this.fill = 0; this.spillTimer = 0; }
}

// -------------------------------------------------------------- スポンジ
export class Sponge {
  constructor(xRatio) {
    this.xRatio = xRatio;
    this.sat = 0;              // 吸った体積
    this.ryb = [0, 0, 1];
    this.dripTimer = 0;
    this.squish = 0;
    this.x = 0; this.w = 76; this.h = 40; this.topY = 0;
    // 穴の位置は固定乱数で決めて、毎フレーム同じ模様にする
    this.holes = Array.from({ length: 7 }, () => ({
      dx: Math.random() - 0.5, dy: Math.random() - 0.5, r: 2 + Math.random() * 2.5,
    }));
  }

  layout(w, groundY, scale) {
    this.x = this.xRatio * w;
    this.w = 78 * scale;
    this.h = 40 * scale;
    this.topY = groundY - this.h;
  }

  get wetness() { return Math.min(1, this.sat / CONFIG.SPONGE_CAPACITY); }

  tryCatch(drop, prevY, world) {
    const inX = Math.abs(drop.x - this.x) < this.w / 2;
    const crossed = prevY < this.topY && drop.y + drop.r >= this.topY;
    if (!inX || !crossed) return false;
    this.ryb = this.sat > 0.2 ? mixRyb(this.ryb, this.sat, drop.currentRyb(0), drop.vol) : drop.currentRyb(0).slice();
    this.sat += drop.vol;
    this.squish = 1;
    world.particles.splash(drop.x, this.topY, this.ryb, drop.vol * 0.4);
    sounds.splash(drop.vol * 0.6);
    return true;
  }

  update(dt, world) {
    this.squish = Math.max(0, this.squish - dt * 3);
    // 飽和したら底からぽたぽた
    if (this.sat > CONFIG.SPONGE_CAPACITY) {
      this.dripTimer -= dt;
      if (this.dripTimer <= 0) {
        this.dripTimer = 0.65;
        const part = Math.min(0.9, this.sat - CONFIG.SPONGE_CAPACITY + 0.3);
        this.sat -= part;
        const dx = (Math.random() - 0.5) * this.w * 0.6;
        world.droplets.spawn(this.x + dx, this.topY + this.h - 4, this.ryb, { vol: part, vy: 20 });
        sounds.plop(part);
      }
    }
  }

  draw(ctx) {
    const squashY = 1 - this.squish * 0.12;
    const h = this.h * squashY;
    const topY = this.topY + this.h - h;
    const wet = this.wetness;
    // 乾いた色 → 吸った色へ暗くなりながら変化
    const dry = [255, 233, 168];
    const tint = rybToRgb(this.ryb);
    const mixT = wet * 0.75;
    const body = [0, 1, 2].map((i) => Math.round(dry[i] * (1 - mixT) + tint[i] * mixT * (1 - wet * 0.25)));
    ctx.save();
    roundRect(ctx, this.x - this.w / 2, topY, this.w, h, 10);
    ctx.fillStyle = rgbCss(body);
    ctx.fill();
    ctx.strokeStyle = rgbCss(shade(body, -0.25), 0.8);
    ctx.lineWidth = 2;
    ctx.stroke();
    // スポンジの穴
    for (const hole of this.holes) {
      ctx.beginPath();
      ctx.arc(this.x + hole.dx * this.w * 0.8, topY + h / 2 + hole.dy * h * 0.7, hole.r, 0, Math.PI * 2);
      ctx.fillStyle = rgbCss(shade(body, -0.35), 0.7);
      ctx.fill();
    }
    // 濡れたつや
    if (wet > 0.3) {
      roundRect(ctx, this.x - this.w / 2 + 4, topY + 3, this.w - 8, 6, 3);
      ctx.fillStyle = `rgba(255,255,255,${0.25 * wet})`;
      ctx.fill();
    }
    ctx.restore();
  }

  reset() { this.sat = 0; this.dripTimer = 0; }
}

// ------------------------------------------------------------------ 紙
export class Paper {
  constructor(xRatio) {
    this.xRatio = xRatio;
    this.hits = 0;
    this.flutter = 0;
    this.x = 0; this.w = 92; this.h = 110; this.topY = 0;
  }

  layout(w, groundY, scale) {
    this.x = this.xRatio * w;
    this.w = 88 * scale;
    this.h = 106 * scale;
    this.topY = groundY - this.h;
  }

  get rect() {
    return { x: this.x - this.w / 2, y: this.topY, w: this.w, h: this.h };
  }

  tryCatch(drop, prevY, world) {
    const inX = Math.abs(drop.x - this.x) < this.w / 2;
    const crossed = prevY < this.topY && drop.y + drop.r >= this.topY;
    if (!inX || !crossed) return false;
    // 紙の上のどこかに、ゆっくり広がる水彩のにじみを作る
    const hitY = this.topY + 10 + Math.random() * (this.h - 30);
    const base = drop.currentRyb(0);
    world.stains.stamp(drop.x, hitY, drop.r * 2.6, base, 0.2, this.rect);
    // 少し遅れて広がる輪(タイマーは world 側の遅延キューで処理)
    world.later(0.25, () => world.stains.stamp(drop.x, hitY, drop.r * 4, base, 0.08, this.rect));
    world.later(0.55, () => world.stains.stamp(drop.x, hitY, drop.r * 5.5, base, 0.04, this.rect));
    this.hits++;
    this.flutter = 1;
    world.particles.splash(drop.x, this.topY + 4, base, drop.vol * 0.4);
    sounds.splash(drop.vol * 0.5);
    return true;
  }

  update(dt) {
    this.flutter = Math.max(0, this.flutter - dt * 2.5);
  }

  /** 紙はシミより下に描く(にじみが紙の上に見えるように) */
  drawSheet(ctx, time) {
    const r = this.rect;
    const tilt = Math.sin(time * 6) * this.flutter * 0.02;
    ctx.save();
    ctx.translate(this.x, this.topY + this.h);
    ctx.rotate(tilt);
    ctx.translate(-this.x, -(this.topY + this.h));
    ctx.shadowColor = 'rgba(120,90,110,0.2)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    roundRect(ctx, r.x, r.y, r.w, r.h, 5);
    ctx.fillStyle = '#fffdf6';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(190,180,200,0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // めくれた角
    ctx.beginPath();
    ctx.moveTo(r.x + r.w - 16, r.y);
    ctx.lineTo(r.x + r.w, r.y + 16);
    ctx.lineTo(r.x + r.w - 16, r.y + 16);
    ctx.closePath();
    ctx.fillStyle = '#efe9dc';
    ctx.fill();
    ctx.restore();
  }
}

// ------------------------------------------------------------ 水たまり
export class PuddleManager {
  constructor() {
    this.puddles = [];
  }

  /** 床に液が落ちた時に呼ぶ。近くの水たまりに合流するか、新しく生む */
  add(x, vol, ryb, world) {
    let target = null;
    for (const p of this.puddles) {
      if (Math.abs(x - p.x) < p.w / 2 + 26) { target = p; break; }
    }
    if (target) {
      target.x = (target.x * target.vol + x * vol) / (target.vol + vol);
      target.ryb = mixRyb(target.ryb, target.vol, ryb, vol);
      target.vol += vol;
    } else {
      this.puddles.push({ x, vol, ryb: ryb.slice(), w: 10, sparkleTimer: Math.random() * 2 });
    }
    // 多すぎたら一番近いペアを結合(性能と見た目の両方のため)
    while (this.puddles.length > CONFIG.PUDDLE_MAX_COUNT) this._mergeClosest();
    if (world && vol > 0.5) sounds.splash(vol * 0.4);
  }

  _mergeClosest() {
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < this.puddles.length; i++) {
      for (let j = i + 1; j < this.puddles.length; j++) {
        const d = Math.abs(this.puddles[i].x - this.puddles[j].x);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
    }
    const a = this.puddles[bi];
    const b = this.puddles[bj];
    a.x = (a.x * a.vol + b.x * b.vol) / (a.vol + b.vol);
    a.ryb = mixRyb(a.ryb, a.vol, b.ryb, b.vol);
    a.vol += b.vol;
    this.puddles.splice(bj, 1);
  }

  update(dt, world) {
    for (const p of this.puddles) {
      // じわっと目標幅まで広がる
      const targetW = Math.min(world.width * 0.4, 24 + p.vol * 7);
      p.w += (targetW - p.w) * Math.min(1, dt * 2.2);
      // 大きい水たまりはときどききらめく
      if (p.vol >= CONFIG.PUDDLE_SHINE_VOL) {
        p.sparkleTimer -= dt;
        if (p.sparkleTimer <= 0) {
          p.sparkleTimer = 1.6 + Math.random() * 2;
          world.particles.sparkle(p.x + (Math.random() - 0.5) * p.w * 0.6, world.groundY - 4, 3);
        }
      }
    }
  }

  draw(ctx, groundY) {
    for (const p of this.puddles) {
      const rgb = rybToRgb(p.ryb);
      const h = Math.min(16, 5 + p.vol * 0.35);
      const grad = ctx.createRadialGradient(p.x, groundY, 2, p.x, groundY, p.w / 2);
      grad.addColorStop(0, rgbCss(shade(rgb, 0.2), 0.85));
      grad.addColorStop(1, rgbCss(shade(rgb, -0.1), 0.65));
      ctx.beginPath();
      ctx.ellipse(p.x, groundY, p.w / 2, h, 0, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      // 大きくなるとツヤ反射
      if (p.vol >= CONFIG.PUDDLE_SHINE_VOL) {
        ctx.beginPath();
        ctx.ellipse(p.x - p.w * 0.15, groundY - h * 0.35, p.w * 0.22, h * 0.25, -0.1, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fill();
      }
    }
  }

  reset() { this.puddles = []; }
}

/** 角丸長方形パス(共有ヘルパー) */
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
