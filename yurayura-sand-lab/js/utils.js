// 小さな汎用ヘルパー。ここには純粋関数だけを置く。
export const TAU = Math.PI * 2;

export const rand = (min, max) => min + Math.random() * (max - min);

export const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

export const lerp = (from, to, t) => from + (to - from) * t;

export const pickOne = (array) => array[(Math.random() * array.length) | 0];

export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

/** roundRect が無い古い環境向けのフォールバック付きパス生成 */
export function roundRectPath(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
