// 色の種の管理: 置く・育つ・動かす・水で元気になる・しぼんで消える

import { COLORS, SEED } from './config.js';

export class SeedBox {
  constructor() {
    this.seeds = [];
    this.nextId = 1;
    this.minDim = 600;
    this.shrinking = false; // リセット中は全部しぼむ
  }

  setStageSize(width, height) {
    this.minDim = Math.min(width, height);
    const cap = this.capRMax();
    for (const s of this.seeds) {
      s.rMax = Math.min(s.rMax, cap);
    }
  }

  baseRMax() { return this.minDim * SEED.BASE_RMAX_RATIO; }
  capRMax() { return this.minDim * SEED.CAP_RMAX_RATIO; }

  // 種を置く。数がいっぱいなら一番古い種を弾いて場所を空ける。
  // 戻り値: { seed, popped } popped は弾かれた種（演出用）
  add(x, y, colorIdx) {
    let popped = null;
    if (this.seeds.length >= SEED.MAX_COUNT) {
      popped = this.seeds.shift();
    }
    const seed = {
      id: this.nextId++,
      x, y,
      colorIdx,
      r: SEED.START_R,
      rMax: this.baseRMax(),
      boost: 0.9,     // 置いた直後は勢いよく広がる。水やりでも 1 に戻る（0..1で減衰）
      jiggle: 1,      // 置いた直後は大きくぷるぷる（0..1で減衰）
      bornAt: performance.now() / 1000,
      dragging: false,
    };
    this.seeds.push(seed);
    this.shrinking = false;
    return { seed, popped };
  }

  findNear(x, y, radius = SEED.GRAB_R) {
    let bestSeed = null;
    let bestDist = radius;
    for (const s of this.seeds) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestDist) {
        bestDist = d;
        bestSeed = s;
      }
    }
    return bestSeed;
  }

  // 水やり: 範囲内の種の最大半径を伸ばし、成長ブーストをかける。戻り値は潤った種たち。
  water(x, y) {
    const range = this.minDim * SEED.WATER_RADIUS_RATIO;
    const bonus = this.minDim * SEED.WATER_RMAX_BONUS_RATIO;
    const cap = this.capRMax();
    const watered = [];
    for (const s of this.seeds) {
      if (Math.hypot(s.x - x, s.y - y) < range + s.r * 0.4) {
        s.rMax = Math.min(cap, s.rMax + bonus);
        s.boost = 1;
        s.jiggle = Math.max(s.jiggle, 0.6);
        watered.push(s);
      }
    }
    return watered;
  }

  jiggleAll(amount = 1) {
    for (const s of this.seeds) s.jiggle = Math.max(s.jiggle, amount);
  }

  beginShrink() {
    this.shrinking = true;
    for (const s of this.seeds) s.dragging = false;
  }

  update(dt) {
    const growSpeed = this.minDim * SEED.GROW_SPEED_RATIO;
    for (let i = this.seeds.length - 1; i >= 0; i--) {
      const s = this.seeds[i];
      if (this.shrinking) {
        s.r -= dt * this.minDim * 0.5;
        if (s.r <= 0) this.seeds.splice(i, 1);
        continue;
      }
      // 上限に近づくほどゆっくり。水やりブーストで一時的に加速。
      const room = Math.max(0, 1 - s.r / s.rMax);
      s.r += growSpeed * (0.25 + room) * (1 + s.boost * 2.5) * dt;
      s.r = Math.min(s.r, s.rMax);
      s.boost = Math.max(0, s.boost - dt * 0.45);
      s.jiggle = Math.max(0, s.jiggle - dt * (s.dragging ? 0 : 0.8));
    }
    if (this.shrinking && this.seeds.length === 0) this.shrinking = false;
  }

  // つやつやのキャンディーのような種を描く
  draw(ctx, t) {
    for (const s of this.seeds) {
      const bob = Math.sin(t * 3 + s.id * 1.7) * 1.5;
      const r = SEED.DRAW_R * (1 + s.jiggle * 0.18 + (s.dragging ? 0.25 : 0));
      const x = s.x;
      const y = s.y + bob;
      const hex = COLORS[s.colorIdx].hex;

      ctx.save();
      // 落ち影
      ctx.fillStyle = 'rgba(30,60,80,0.18)';
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.75, r * 0.85, r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      // 本体
      const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.35, hex);
      grad.addColorStop(1, hex);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      // 白いふち
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      // つやのハイライト
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.ellipse(x - r * 0.32, y - r * 0.38, r * 0.26, r * 0.16, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
