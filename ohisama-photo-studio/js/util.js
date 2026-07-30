'use strict';
window.G = window.G || {};
(function(){
const G = window.G;

G.TAU = Math.PI * 2;
G.FONT = '"Hiragino Maru Gothic ProN","Zen Maru Gothic","Yu Gothic",system-ui,sans-serif';

G.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
G.lerp = (a, b, t) => a + (b - a) * t;
G.rand = (a, b) => a + Math.random() * (b - a);
G.pick = a => a[(Math.random() * a.length) | 0];
G.dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
G.easeOut = t => 1 - Math.pow(1 - G.clamp(t, 0, 1), 3);
G.easeInOut = t => { t = G.clamp(t, 0, 1); return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; };

G.hex2rgb = h => {
  const n = parseInt(h.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
};

// stops: [[0..255, '#hex'], ...] sorted, first at 0 and last at 255
G.makeLUT = stops => {
  const lut = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    let j = 0;
    while (j < stops.length - 2 && stops[j + 1][0] < i) j++;
    const a = stops[j], b = stops[j + 1];
    const t = b[0] === a[0] ? 0 : G.clamp((i - a[0]) / (b[0] - a[0]), 0, 1);
    const ca = G.hex2rgb(a[1]), cb = G.hex2rgb(b[1]);
    lut[i*3]   = ca[0] + (cb[0] - ca[0]) * t;
    lut[i*3+1] = ca[1] + (cb[1] - ca[1]) * t;
    lut[i*3+2] = ca[2] + (cb[2] - ca[2]) * t;
  }
  return lut;
};

G.roundRect = (ctx, x, y, w, h, r) => {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

G.canvas2d = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
};
})();
