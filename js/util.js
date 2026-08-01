// 小さな数学 / 描画ヘルパー群
export const TAU = Math.PI * 2;
export const PI = Math.PI;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mix = lerp;

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);

export function easeOutBack(t, s = 1.70158) {
  const p = t - 1;
  return 1 + (s + 1) * p * p * p + s * p * p;
}

export function easeOutElastic(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c) + 1;
}

/** フレームレート非依存の指数補間 */
export function approach(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function angleWrap(a) {
  a = (a + PI) % TAU;
  if (a < 0) a += TAU;
  return a - PI;
}

export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** 決定論的な擬似乱数（背景の草花などを毎フレーム同じ位置に置くため） */
export function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function hash2(n, seed) {
  return hash1(n * 1.618 + seed * 57.31);
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 太さのある線分（手足・フレームなど） */
export function capsule(ctx, x1, y1, x2, y2, w, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** 2 関節 IK：根元 (ax,ay) から目標 (tx,ty) へ、長さ l1+l2 の関節位置を返す */
export function ik2(ax, ay, tx, ty, l1, l2, bendSign = 1) {
  let dx = tx - ax;
  let dy = ty - ay;
  let d = Math.hypot(dx, dy);
  const maxD = (l1 + l2) * 0.999;
  if (d > maxD) {
    dx *= maxD / d;
    dy *= maxD / d;
    d = maxD;
  }
  if (d < 1e-4) d = 1e-4;
  const a = (d * d + l1 * l1 - l2 * l2) / (2 * d);
  const hSq = Math.max(0, l1 * l1 - a * a);
  const h = Math.sqrt(hSq);
  const ux = dx / d;
  const uy = dy / d;
  const px = ax + ux * a;
  const py = ay + uy * a;
  return {
    jx: px + -uy * h * bendSign,
    jy: py + ux * h * bendSign,
    ex: ax + dx,
    ey: ay + dy,
  };
}

/** 色文字列に不透明度を掛ける（#rrggbb 専用） */
export function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** #rrggbb を明るく / 暗くする */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) + 255 * amt), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) + 255 * amt), 0, 255);
  const b = clamp(Math.round((n & 255) + 255 * amt), 0, 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
