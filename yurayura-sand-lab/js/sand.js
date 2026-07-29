// すなのシステム。
import { SAND_TUNING } from './config.js';
import { getLayout } from './layout.js';
import { rand, clamp, roundRectPath, TAU } from './utils.js';

export class SandSystem {
  constructor(stageW, stageH) {
    this.floor = document.createElement('canvas');
    this.floor.width = stageW;
    this.floor.height = stageH;
    this.fctx = this.floor.getContext('2d');
    this.paperBg = '#fbf0dc';

    this.amount = SAND_TUNING.maxAmount;
    this.flowBase = rand(SAND_TUNING.flowMin, SAND_TUNING.flowMax);
    this.flowPhase = rand(0, TAU);
    this.type = null;

    this.lastEmit = null;
    this.pending = [];
    this.grains = [];
    this.sparkles = [];

    this.depositCount = 0;
    this.colorsUsed = new Set();
  }

  /** 画面リサイズ。堆積はかみ領域ごとスケールして維持する。 */
  resize(newW, newH, oldLayout) {
    const newLayout = getLayout();
    const oldFloor = this.floor;
    const next = document.createElement('canvas');
    next.width = newW;
    next.height = newH;
    const nctx = next.getContext('2d');

    if (oldLayout) {
      const op = oldLayout.paper;
      const np = newLayout.paper;
      nctx.fillStyle = this.paperBg;
      roundRectPath(nctx, np.x, np.y, np.w, np.h, np.r);
      nctx.fill();
      nctx.drawImage(oldFloor, op.x, op.y, op.w, op.h, np.x, np.y, np.w, np.h);
    }

    this.floor = next;
    this.fctx = nctx;
    this.pending = [];
    this.grains = [];
    const sx = oldLayout ? newLayout.stage.w / oldLayout.stage.w : 1;
    const sy = oldLayout ? newLayout.stage.h / oldLayout.stage.h : 1;
    for (const s of this.sparkles) {
      s.x *= sx;
      s.y *= sy;
    }
    if (this.lastEmit) {
      this.lastEmit.x *= sx;
      this.lastEmit.y *= sy;
    }
  }

  setType(type) {
    this.type = type;
  }

  setPaper(paper) {
    const region = getLayout().paper;
    this.paperDark = paper.dark;
    const c = this.fctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, this.floor.width, this.floor.height);
    roundRectPath(c, region.x, region.y, region.w, region.h, region.r);
    c.fillStyle = paper.bg;
    c.fill();
    this.paperBg = paper.bg;
    this.lastEmit = null;
    this.pending = [];
    this.depositCount = 0;
    this.colorsUsed = new Set();
  }

  refill() {
    this.amount = rand(SAND_TUNING.maxAmount * 0.9, SAND_TUNING.maxAmount);
    this.flowBase = rand(SAND_TUNING.flowMin, SAND_TUNING.flowMax);
  }

  get level() {
    return clamp(this.amount / SAND_TUNING.maxAmount, 0, 1);
  }

  currentColor(t) {
    if (!this.type) return '#f97ba8';
    if (this.type.kind === 'rainbow') {
      const hue = (t * 42) % 360;
      return `hsl(${hue.toFixed(0)} 82% 68%)`;
    }
    return this.type.color;
  }

  update(dt, cupPos, t) {
    const flowing = this.amount > 0 && this.type != null;
    if (flowing) {
      const flow = this.flowBase * (0.85 + 0.3 * Math.sin(t * 0.7 + this.flowPhase));
      const out = Math.min(this.amount, flow * dt);
      this.amount -= out;
      this.emitSegment(cupPos, out, t);
      this.spawnGrains(dt, cupPos, t);
    } else {
      this.lastEmit = null;
    }
    this.applyPending(t);
    this.updateFx(dt);
    return flowing;
  }

  emitSegment(cupPos, out, t) {
    const { scale } = getLayout();
    if (!this.lastEmit) this.lastEmit = { x: cupPos.x, y: cupPos.y };
    const from = this.lastEmit;
    const dx = cupPos.x - from.x;
    const dy = cupPos.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len > 90 * scale) {
      this.lastEmit = { x: cupPos.x, y: cupPos.y };
      return;
    }
    const spacing = SAND_TUNING.dotSpacing * scale;
    const dots = Math.max(1, Math.ceil(len / spacing));
    const alpha = clamp((out * SAND_TUNING.alphaScale) / dots, 0.03, 0.4);
    const color = this.currentColor(t);
    const kind = this.type.kind;
    for (let i = 1; i <= dots; i++) {
      const px = from.x + (dx * i) / dots + rand(-1.6, 1.6) * scale;
      const py = from.y + (dy * i) / dots + rand(-1.6, 1.6) * scale;
      const radius = (kind === 'sugar' ? rand(2.6, 4.4) : rand(1.7, 3.0)) * scale;
      this.pending.push({
        x: px, y: py, r: radius, alpha, color, kind,
        due: t + SAND_TUNING.fallTimeSec,
      });
    }
    this.lastEmit = { x: cupPos.x, y: cupPos.y };
    this.colorsUsed.add(this.type.id);
  }

  applyPending(t) {
    while (this.pending.length > 0 && this.pending[0].due <= t) {
      const dot = this.pending.shift();
      this.depositDot(dot);
      this.depositCount++;
    }
  }

  depositDot(dot) {
    const region = getLayout().paper;
    const c = this.fctx;
    c.save();
    roundRectPath(c, region.x, region.y, region.w, region.h, region.r);
    c.clip();
    c.globalCompositeOperation = this.compositeFor(dot.kind);
    c.globalAlpha = dot.alpha;
    c.fillStyle = dot.color;
    const { scale } = getLayout();
    if (dot.kind === 'star' && Math.random() < 0.02) {
      c.globalAlpha = Math.min(0.7, dot.alpha * 3);
      drawStar(c, dot.x, dot.y, rand(3.5, 6.5) * scale);
    } else {
      c.beginPath();
      c.arc(dot.x, dot.y, dot.r, 0, TAU);
      c.fill();
    }
    if (Math.random() < SAND_TUNING.bleedChance) {
      c.globalAlpha = dot.alpha * 0.25;
      c.beginPath();
      c.arc(dot.x, dot.y, dot.r * 2.6, 0, TAU);
      c.fill();
    }
    c.restore();
  }

  compositeFor(kind) {
    if (kind === 'sugar') return 'source-over';
    if (this.paperDark) return kind === 'star' ? 'lighter' : 'screen';
    return 'multiply';
  }

  mistStep() {
    const region = getLayout().paper;
    const c = this.fctx;
    c.save();
    roundRectPath(c, region.x, region.y, region.w, region.h, region.r);
    c.clip();
    c.globalCompositeOperation = 'source-over';
    c.filter = 'blur(1.4px)';
    c.globalAlpha = 0.45;
    c.drawImage(this.floor, 0, 0);
    c.filter = 'none';
    c.globalAlpha = 0.02;
    c.fillStyle = this.paperBg;
    c.fillRect(region.x, region.y, region.w, region.h);
    c.restore();
  }

  spawnMistDrops() {
    const region = getLayout().paper;
    for (let i = 0; i < 46; i++) {
      this.sparkles.push({
        x: rand(region.x + 30, region.x + region.w - 30),
        y: rand(region.y + 20, region.y + region.h - 20),
        r: rand(1, 2.6),
        life: rand(0.5, 1.1),
        age: 0,
        color: 'rgba(255,255,255,0.8)',
        drift: rand(8, 26),
      });
    }
  }

  spawnSettleSparkles(x, y) {
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU);
      const speed = rand(30, 110) * getLayout().scale;
      this.sparkles.push({
        x, y, r: rand(1.5, 3.2) * getLayout().scale,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: rand(0.5, 0.9),
        age: 0,
        color: 'rgba(255, 226, 130, 0.95)',
      });
    }
  }

  spawnGrains(dt, cupPos, t) {
    const { scale } = getLayout();
    const perSec = 42;
    if (Math.random() > perSec * dt) return;
    this.grains.push({
      x: cupPos.x + rand(-3, 3) * scale,
      y: cupPos.y + rand(28, 34) * scale,
      vx: rand(-14, 14) * scale,
      vy: rand(46, 90) * scale,
      r: rand(1.4, 2.4) * scale,
      life: SAND_TUNING.fallTimeSec,
      age: 0,
      color: this.currentColor(t),
      sparkle: this.type.kind === 'star',
    });
  }

  updateFx(dt) {
    for (const g of this.grains) {
      g.age += dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
    }
    this.grains = this.grains.filter((g) => g.age < g.life);
    for (const s of this.sparkles) {
      s.age += dt;
      if (s.vx !== undefined) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vx *= 0.94;
        s.vy *= 0.94;
      } else if (s.drift) {
        s.y += s.drift * dt;
      }
    }
    this.sparkles = this.sparkles.filter((s) => s.age < s.life);
  }

  drawFx(ctx) {
    const { scale } = getLayout();
    for (const g of this.grains) {
      const k = 1 - g.age / g.life;
      ctx.globalAlpha = 0.85 * k;
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r * (0.4 + 0.6 * k), 0, TAU);
      ctx.fill();
      if (g.sparkle && Math.random() < 0.25) {
        ctx.globalAlpha = 0.7 * k;
        ctx.fillStyle = '#fff3c4';
        drawStar(ctx, g.x + rand(-4, 4) * scale, g.y + rand(-4, 4) * scale, 2.4 * scale);
      }
    }
    for (const s of this.sparkles) {
      const k = 1 - s.age / s.life;
      ctx.globalAlpha = 0.9 * k;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawStar(ctx, cx, cy, size) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4 - Math.PI / 2;
    const radius = i % 2 === 0 ? size : size * 0.42;
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}
