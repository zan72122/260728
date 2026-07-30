'use strict';
(function(){
const G = window.G;

/*
 * Cyanotype simulation.
 *
 * The paper keeps a per-pixel exposure map (expC, red channel).
 * Every exposure tick adds a little white light to it, minus:
 *   - object masks (translucent parts leak a little light through)
 *   - drifting cloud shadows (local mottling)
 * Washing keeps a per-pixel wash map: scrubbed areas transition from
 * the coated look (yellow-green / bronze) to the final Prussian-blue
 * ramp. Over-washing gently fades the blue.
 */

// coated paper -> print-out bronze/slate (what you see while exposing)
const LUT_EXP = G.makeLUT([
  [0, '#eaedc9'], [60, '#c9cf9b'], [120, '#9aa47a'],
  [180, '#6d7a72'], [230, '#4d5c68'], [255, '#3e4c5e']
]);
// washed paper: white -> pale blue -> Prussian blue
const LUT_BLUE = G.makeLUT([
  [0, '#f6f7f2'], [35, '#e2eaf2'], [80, '#aec7e4'],
  [130, '#6f97cd'], [180, '#3c66a8'], [220, '#1f4485'], [255, '#122e5e']
]);

function makeFiber(w, h){
  const c = G.canvas2d(w, h), x = c.getContext('2d');
  const id = x.createImageData(w, h), d = id.data;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const v = (246 + Math.random() * 9 - 4) | 0;
    d[p] = v; d[p+1] = v; d[p+2] = v; d[p+3] = 255;
  }
  x.putImageData(id, 0, 0);
  x.strokeStyle = 'rgba(180,185,170,0.06)';
  for (let i = 0; i < 26; i++) {
    x.lineWidth = G.rand(0.6, 1.6);
    const y0 = Math.random() * h;
    x.beginPath();
    x.moveTo(-10, y0);
    x.quadraticCurveTo(w / 2, y0 + G.rand(-14, 14), w + 10, y0 + G.rand(-10, 10));
    x.stroke();
  }
  return c;
}

G.Sheet = function(portrait){
  const L = 560, S = 436;
  this.tw = portrait ? S : L;
  this.th = portrait ? L : S;
  const tw = this.tw, th = this.th;

  this.maskC = G.canvas2d(tw, th);  this.mctx = this.maskC.getContext('2d');
  this.frameC = G.canvas2d(tw, th); this.fctx = this.frameC.getContext('2d');
  this.expC = G.canvas2d(tw, th);   this.ectx = this.expC.getContext('2d');
  this.viewC = G.canvas2d(tw, th);  this.vctx = this.viewC.getContext('2d');
  this.streakC = G.canvas2d(tw, th); this.sctx = this.streakC.getContext('2d');

  this.ectx.fillStyle = '#000';
  this.ectx.fillRect(0, 0, tw, th);

  this.fiber = makeFiber(tw, th);
  this.outId = this.vctx.createImageData(tw, th);
  this.wash = new Float32Array(tw * th);
  this.washSum = 0;
  this.washAvg = 0;
  this.overwash = 0;
  this.soak = 0;
  this.exposureSec = 0;
  this.maskDirty = true;
  this.viewDirty = false;
  this.E = null;
  this.brightPts = null;
  this._tmp = document.createElement('canvas');

  this.refreshExposedView();
};

const P = G.Sheet.prototype;

P.rebuildMask = function(objects){
  const m = this.mctx;
  m.clearRect(0, 0, this.tw, this.th);
  for (const o of objects) {
    const shape = G.shapes.byId[o.id];
    const pad = Math.ceil(o.s * 1.9 + 20);
    const t = this._tmp;
    t.width = pad * 2; t.height = pad * 2;
    const tc = t.getContext('2d');
    tc.save();
    tc.translate(pad, pad);
    tc.rotate(o.rot);
    shape.mask(tc, o.s);
    tc.restore();
    if (o.lift > 0.02) {
      // a lifted object throws a blurred silhouette: draw the temp canvas
      // far off-screen and let only its blurred shadow land on the mask
      m.save();
      m.shadowColor = 'rgba(255,255,255,1)';
      m.shadowBlur = o.lift * 13;
      m.shadowOffsetX = 10000;
      m.shadowOffsetY = 0;
      m.drawImage(t, o.x - pad - 10000, o.y - pad);
      m.restore();
    } else {
      m.drawImage(t, o.x - pad, o.y - pad);
    }
  }
};

P.exposeTick = function(dt, power, shadows){
  const f = this.fctx, tw = this.tw, th = this.th;
  f.globalCompositeOperation = 'source-over';
  f.clearRect(0, 0, tw, th);
  f.globalAlpha = Math.min(0.06, 0.2 * power * dt);
  f.fillStyle = '#fff';
  f.fillRect(0, 0, tw, th);
  f.globalAlpha = 1;
  f.globalCompositeOperation = 'destination-out';
  if (shadows) {
    for (const s of shadows) {
      const gr = f.createRadialGradient(s.x, s.y, s.r * 0.1, s.x, s.y, s.r);
      gr.addColorStop(0, 'rgba(0,0,0,' + s.a + ')');
      gr.addColorStop(0.7, 'rgba(0,0,0,' + s.a * 0.75 + ')');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = gr;
      f.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
    }
  }
  // objects block ~93% of light; the rest leaks, so very long exposures
  // fog even the covered areas ("too dark all over")
  f.globalAlpha = 0.93;
  f.drawImage(this.maskC, 0, 0);
  f.globalAlpha = 1;
  f.globalCompositeOperation = 'source-over';

  this.ectx.globalCompositeOperation = 'lighter';
  this.ectx.drawImage(this.frameC, 0, 0);
  this.ectx.globalCompositeOperation = 'source-over';
  this.exposureSec += dt * power;
};

P._fiberOverlay = function(){
  this.vctx.globalCompositeOperation = 'multiply';
  this.vctx.drawImage(this.fiber, 0, 0);
  this.vctx.globalCompositeOperation = 'source-over';
};

P.refreshExposedView = function(){
  const tw = this.tw, th = this.th, n = tw * th;
  const src = this.ectx.getImageData(0, 0, tw, th).data;
  const od = this.outId.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const j = src[p] * 3;
    od[p] = LUT_EXP[j];
    od[p+1] = LUT_EXP[j+1];
    od[p+2] = LUT_EXP[j+2];
    od[p+3] = 255;
  }
  this.vctx.putImageData(this.outId, 0, 0);
  this._fiberOverlay();
};

P.beginWash = function(){
  const tw = this.tw, th = this.th, n = tw * th;
  const src = this.ectx.getImageData(0, 0, tw, th).data;
  const E = this.E = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) E[i] = src[p];
  const pts = this.brightPts = [];
  for (let y = 6; y < th; y += 9) {
    for (let x = 6; x < tw; x += 9) {
      if (E[y * tw + x] > 110) pts.push([x, y]);
    }
  }
  this.viewDirty = true;
};

P.scrub = function(tx, ty, r, amt){
  const tw = this.tw, th = this.th, w = this.wash;
  const x0 = Math.max(0, (tx - r) | 0), x1 = Math.min(tw - 1, (tx + r) | 0);
  const y0 = Math.max(0, (ty - r) | 0), y1 = Math.min(th - 1, (ty + r) | 0);
  let sum = this.washSum;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - tx, dy = y - ty;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= r) continue;
      const f = 1 - d / r;
      const i = y * tw + x, old = w[i], nv = old + amt * f;
      w[i] = nv;
      sum += Math.min(1, nv) - Math.min(1, old);
    }
  }
  this.washSum = sum;
  this.washAvg = sum / (tw * th);
  if (this.washAvg > 0.92) this.overwash = Math.min(1, this.overwash + amt * 0.02);
  this.viewDirty = true;
};

P.refreshWashView = function(){
  const tw = this.tw, th = this.th, n = tw * th;
  const E = this.E, w = this.wash, od = this.outId.data;
  const owf = 1 - 0.35 * this.overwash;
  const soak = this.soak;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const e = E[i];
    let wv = w[i] + soak; if (wv > 1) wv = 1;
    const j = e * 3, k = ((e * owf) | 0) * 3;
    od[p]   = LUT_EXP[j]   + (LUT_BLUE[k]   - LUT_EXP[j])   * wv;
    od[p+1] = LUT_EXP[j+1] + (LUT_BLUE[k+1] - LUT_EXP[j+1]) * wv;
    od[p+2] = LUT_EXP[j+2] + (LUT_BLUE[k+2] - LUT_EXP[j+2]) * wv;
    od[p+3] = 255;
  }
  this.vctx.putImageData(this.outId, 0, 0);
  this._fiberOverlay();
  this.vctx.drawImage(this.streakC, 0, 0);
  this.viewDirty = false;
};

P.bakePrint = function(){
  const c = G.canvas2d(this.tw, this.th), x = c.getContext('2d');
  x.drawImage(this.viewC, 0, 0);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = 'rgba(24,48,105,0.15)';
  x.fillRect(0, 0, this.tw, this.th);
  x.globalCompositeOperation = 'source-over';
  return c;
};
})();
