// ピンと「たわむ紐」。
// 紐は2次ベジェ曲線で近似したカテナリー(懸垂線)風カーブ。
// たわみ量 = 水平距離 × 係数 + しずくの荷重。ピンを動かすと即座に追従する。

import { CONFIG } from './config.js';

const PIN_COLORS = ['#ff6b81', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#b197fc'];
let nextPinId = 1;

export class Pin {
  constructor(x, y) {
    this.id = nextPinId++;
    this.x = x;
    this.y = y;
    this.color = PIN_COLORS[(this.id - 1) % PIN_COLORS.length];
    this.bounce = 1; // 置いた瞬間のぷるん演出(0で終了)
    this.r = 17;     // 見た目とヒット判定の半径
  }

  update(dt) {
    if (this.bounce > 0) this.bounce = Math.max(0, this.bounce - dt * 2.4);
  }

  draw(ctx) {
    const squash = 1 + Math.sin((1 - this.bounce) * Math.PI * 2) * this.bounce * 0.25;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(squash, 2 - squash);
    // 影
    ctx.beginPath();
    ctx.arc(1.5, 3, this.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(90,60,80,0.18)';
    ctx.fill();
    // 本体
    const grad = ctx.createRadialGradient(-5, -6, 2, 0, 0, this.r + 2);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.25, this.color);
    grad.addColorStop(1, this.color);
    ctx.beginPath();
    ctx.arc(0, 0, this.r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    // 中心の留め具
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
    ctx.restore();
  }

  hit(x, y, pad = 14) {
    const dx = x - this.x;
    const dy = y - this.y;
    return dx * dx + dy * dy <= (this.r + pad) * (this.r + pad);
  }
}

const ROPE_COLORS = ['#e8927c', '#7cb8e8', '#e8c47c', '#9fd08a', '#c79fe0'];
let nextRopeId = 1;

export class Rope {
  constructor(pinA, pinB) {
    this.id = nextRopeId++;
    this.a = pinA;
    this.b = pinB;
    this.color = ROPE_COLORS[(this.id - 1) % ROPE_COLORS.length];
    this.load = 0;        // 乗っているしずくの総体積(たわみに影響)
    this.wet = 0;         // 濡れ具合 0..1(ほのかに光る)
    this.wetRyb = [0, 0, 1];
    this.wobble = 0;      // 着弾・ピン移動時の揺れ振幅
    this.wobblePhase = 0;
    this._samples = null; // [{x,y,len}] 弧長テーブル(毎フレーム再計算)
    this._rebuildSamples(0); // 生成直後から当たり判定できるように
  }

  /** しずくが乗った/ピンが動いた時に呼ぶと、ぷるんと揺れる */
  excite(amount = 1) {
    this.wobble = Math.min(1.6, this.wobble + amount);
  }

  /** たわみ量(px) */
  sag() {
    const dx = Math.abs(this.b.x - this.a.x);
    const s = dx * CONFIG.SAG_FACTOR + this.load * CONFIG.SAG_LOAD_FACTOR + 6;
    return Math.min(CONFIG.SAG_MAX, s);
  }

  /** 制御点(揺れを含む) */
  controlPoint(time) {
    const mx = (this.a.x + this.b.x) / 2;
    const my = (this.a.y + this.b.y) / 2;
    const wob = this.wobble * Math.sin(time * 14 + this.wobblePhase) * 10;
    return { x: mx, y: my + this.sag() + wob };
  }

  /** 毎フレームの更新: 揺れ減衰・濡れ減衰・サンプル再計算 */
  update(dt, time) {
    this.wobble = Math.max(0, this.wobble - dt * 2.2);
    this.wet = Math.max(0, this.wet - dt * 0.06);
    this.load = 0; // 荷重は droplets 側で毎フレーム加算し直す
    this._rebuildSamples(time);
  }

  _rebuildSamples(time) {
    const n = CONFIG.STRING_SAMPLES;
    const cp = this.controlPoint(time);
    const pts = [];
    let len = 0;
    let px = this.a.x;
    let py = this.a.y;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      const x = u * u * this.a.x + 2 * u * t * cp.x + t * t * this.b.x;
      const y = u * u * this.a.y + 2 * u * t * cp.y + t * t * this.b.y;
      if (i > 0) len += Math.hypot(x - px, y - py);
      pts.push({ x, y, len });
      px = x;
      py = y;
    }
    this._samples = pts;
    this._cp = cp;
    this.length = len;
  }

  /** パラメータ t (0..1) の位置 */
  pointAt(t) {
    const cp = this._cp;
    const u = 1 - t;
    return {
      x: u * u * this.a.x + 2 * u * t * cp.x + t * t * this.b.x,
      y: u * u * this.a.y + 2 * u * t * cp.y + t * t * this.b.y,
    };
  }

  /** t における接線ベクトル(正規化しない) */
  derivAt(t) {
    const cp = this._cp;
    return {
      x: 2 * (1 - t) * (cp.x - this.a.x) + 2 * t * (this.b.x - cp.x),
      y: 2 * (1 - t) * (cp.y - this.a.y) + 2 * t * (this.b.y - cp.y),
    };
  }

  /** 紐のいちばん低い点(サンプル中の最大 y)。滴下位置に使う */
  lowestPoint() {
    let low = this._samples[0];
    for (const p of this._samples) {
      if (p.y > low.y) low = p;
    }
    return low;
  }

  /** 点にもっとも近い t とその距離を返す(サンプル走査+1回refine) */
  nearest(x, y) {
    const pts = this._samples;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = (pts[i].x - x) ** 2 + (pts[i].y - y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    let t = best / (pts.length - 1);
    // 近傍を細かく見て精度を上げる
    const step = 1 / (pts.length - 1) / 2;
    for (const cand of [t - step, t + step]) {
      if (cand < 0 || cand > 1) continue;
      const p = this.pointAt(cand);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) { bestD = d; t = cand; }
    }
    return { t, dist: Math.sqrt(bestD) };
  }

  draw(ctx) {
    const pts = this._samples;
    if (!pts) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 濡れているとほのかに光る
    if (this.wet > 0.04) {
      ctx.shadowBlur = 14 * this.wet;
      ctx.shadowColor = `rgba(120,190,255,${0.55 * this.wet})`;
    }
    // 毛糸らしく: 濃い芯 + 明るいハイライトの2度描き
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = this.color;
    ctx.lineWidth = CONFIG.STRING_WIDTH;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y - 1.5);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y - 1.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.38)';
    ctx.lineWidth = CONFIG.STRING_WIDTH * 0.35;
    ctx.stroke();
    ctx.restore();
  }
}

/** ドラッグ中のプレビュー紐(点線) */
export function drawRopePreview(ctx, pin, x, y) {
  const sag = Math.abs(x - pin.x) * CONFIG.SAG_FACTOR + 6;
  const cpx = (pin.x + x) / 2;
  const cpy = (pin.y + y) / 2 + sag;
  ctx.save();
  ctx.setLineDash([10, 12]);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(150,130,160,0.6)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(pin.x, pin.y);
  ctx.quadraticCurveTo(cpx, cpy, x, y);
  ctx.stroke();
  ctx.restore();
}
