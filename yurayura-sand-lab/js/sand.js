// すなのシステム。
// - 床(かみ)への堆積は永続オフスクリーンキャンバスに描く
// - カップから床までの落下は短い遅延キューで表現する
// - 見た目用の落下粒・きらめきもここで管理する
import { PAPER, SAND_TUNING } from './config.js';
import { rand, clamp, roundRectPath, TAU } from './utils.js';

export class SandSystem {
  constructor(stageW, stageH) {
    this.floor = document.createElement('canvas');
    this.floor.width = stageW;
    this.floor.height = stageH;
    this.fctx = this.floor.getContext('2d');

    this.amount = SAND_TUNING.maxAmount;
    this.flowBase = rand(SAND_TUNING.flowMin, SAND_TUNING.flowMax);
    this.flowPhase = rand(0, TAU);
    this.type = null;          // 選択中のすな(config.SAND_TYPES の要素)
    this.paperDark = false;

    this.lastEmit = null;      // 前フレームの放出位置(線分補間用)
    this.pending = [];         // 落下中で、まだ床に届いていない堆積ドット
    this.grains = [];          // 見た目用の落下粒
    this.sparkles = [];        // きらめき・霧のしずく

    this.depositCount = 0;     // このかみに置いたドット数(バッジ判定用)
    this.colorsUsed = new Set();
  }

  setType(type) {
    this.type = type;
  }

  /** かみを新しくする。堆積を消して背景色で塗り直す。 */
  setPaper(paper) {
    this.paperDark = paper.dark;
    const c = this.fctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, this.floor.width, this.floor.height);
    roundRectPath(c, PAPER.x, PAPER.y, PAPER.w, PAPER.h, PAPER.r);
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

  /** 現在のすなの色を返す(にじは時間で色が巡る) */
  currentColor(t) {
    if (!this.type) return '#f97ba8';
    if (this.type.kind === 'rainbow') {
      const hue = (t * 42) % 360;
      return `hsl(${hue.toFixed(0)} 82% 68%)`;
    }
    return this.type.color;
  }

  /**
   * 毎フレームの更新。カップ位置から砂を放出し、落下キューを処理する。
   * @returns {boolean} 砂が流れているか(音のヒス用)
   */
  update(dt, cupPos, t) {
    const flowing = this.amount > 0 && this.type != null;
    if (flowing) {
      // 流量は一定 + ゆっくり揺らぐ(毎回・毎瞬すこし違う)
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

  /** 前回位置から今回位置まで、砂の量を等間隔ドットに分配して落とす */
  emitSegment(cupPos, out, t) {
    if (!this.lastEmit) this.lastEmit = { x: cupPos.x, y: cupPos.y };
    const from = this.lastEmit;
    const dx = cupPos.x - from.x;
    const dy = cupPos.y - from.y;
    const len = Math.hypot(dx, dy);
    // 大きく飛んだときは線を引かずに繋ぎ直す(紙替え直後など)
    if (len > 90) {
      this.lastEmit = { x: cupPos.x, y: cupPos.y };
      return;
    }
    const dots = Math.max(1, Math.ceil(len / SAND_TUNING.dotSpacing));
    // 速く動くほど1粒あたりが薄くなる=線の濃淡が揺れの速さを写す
    const alpha = clamp((out * SAND_TUNING.alphaScale) / dots, 0.03, 0.4);
    const color = this.currentColor(t);
    const kind = this.type.kind;
    for (let i = 1; i <= dots; i++) {
      const px = from.x + (dx * i) / dots + rand(-1.6, 1.6);
      const py = from.y + (dy * i) / dots + rand(-1.6, 1.6);
      const radius = kind === 'sugar' ? rand(2.6, 4.4) : rand(1.7, 3.0);
      this.pending.push({
        x: px, y: py, r: radius, alpha, color, kind,
        due: t + SAND_TUNING.fallTimeSec,
      });
    }
    this.lastEmit = { x: cupPos.x, y: cupPos.y };
    this.colorsUsed.add(this.type.id);
  }

  /** 床に届いた分を堆積キャンバスへ焼き込む */
  applyPending(t) {
    while (this.pending.length > 0 && this.pending[0].due <= t) {
      const dot = this.pending.shift();
      this.depositDot(dot);
      this.depositCount++;
    }
  }

  depositDot(dot) {
    const c = this.fctx;
    c.save();
    roundRectPath(c, PAPER.x, PAPER.y, PAPER.w, PAPER.h, PAPER.r);
    c.clip();
    c.globalCompositeOperation = this.compositeFor(dot.kind);
    c.globalAlpha = dot.alpha;
    c.fillStyle = dot.color;
    if (dot.kind === 'star' && Math.random() < 0.02) {
      // ときどき小さな星のかたちで落ちる
      c.globalAlpha = Math.min(0.7, dot.alpha * 3);
      drawStar(c, dot.x, dot.y, rand(3.5, 6.5));
    } else {
      c.beginPath();
      c.arc(dot.x, dot.y, dot.r, 0, TAU);
      c.fill();
    }
    // にじみ:たまに大きく薄いハロを重ねる
    if (Math.random() < SAND_TUNING.bleedChance) {
      c.globalAlpha = dot.alpha * 0.25;
      c.beginPath();
      c.arc(dot.x, dot.y, dot.r * 2.6, 0, TAU);
      c.fill();
    }
    c.restore();
  }

  /** 紙の明るさとすなの種類で重ね方を選ぶ(重なりが濃く・光って見える) */
  compositeFor(kind) {
    if (kind === 'sugar') return 'source-over';
    if (this.paperDark) return kind === 'star' ? 'lighter' : 'screen';
    return 'multiply';
  }

  /** きりをかける:堆積を少しぼかして溶かす。毎フレーム少しずつ呼ぶ。 */
  mistStep() {
    const c = this.fctx;
    c.save();
    roundRectPath(c, PAPER.x, PAPER.y, PAPER.w, PAPER.h, PAPER.r);
    c.clip();
    c.globalCompositeOperation = 'source-over';
    c.filter = 'blur(1.4px)';
    c.globalAlpha = 0.45;
    c.drawImage(this.floor, 0, 0);
    c.filter = 'none';
    // うっすら紙色を重ねて「すこし溶けた」感じにする
    c.globalAlpha = 0.02;
    c.fillStyle = this.paperBg;
    c.fillRect(PAPER.x, PAPER.y, PAPER.w, PAPER.h);
    c.restore();
  }

  /** きりのしずく(見た目)をまく */
  spawnMistDrops() {
    for (let i = 0; i < 46; i++) {
      this.sparkles.push({
        x: rand(PAPER.x + 30, PAPER.x + PAPER.w - 30),
        y: rand(PAPER.y + 20, PAPER.y + PAPER.h - 20),
        r: rand(1, 2.6),
        life: rand(0.5, 1.1),
        age: 0,
        color: 'rgba(255,255,255,0.8)',
        drift: rand(8, 26),
      });
    }
  }

  /** 揺れ終わりのお祝いきらめき */
  spawnSettleSparkles(x, y) {
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU);
      const speed = rand(30, 110);
      this.sparkles.push({
        x, y, r: rand(1.5, 3.2),
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: rand(0.5, 0.9),
        age: 0,
        color: 'rgba(255, 226, 130, 0.95)',
      });
    }
  }

  /** 見た目用の落下粒。カップの下でちいさく散って消える。 */
  spawnGrains(dt, cupPos, t) {
    const perSec = 42;
    if (Math.random() > perSec * dt) return;
    this.grains.push({
      x: cupPos.x + rand(-3, 3),
      y: cupPos.y + rand(28, 34),
      vx: rand(-14, 14),
      vy: rand(46, 90),
      r: rand(1.4, 2.4),
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

  /** 落下粒ときらめきをライブキャンバスへ描く */
  drawFx(ctx) {
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
        drawStar(ctx, g.x + rand(-4, 4), g.y + rand(-4, 4), 2.4);
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

/** 4つの角がある小さな星を描く */
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
