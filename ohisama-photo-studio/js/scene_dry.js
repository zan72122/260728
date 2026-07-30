'use strict';
(function(){
const G = window.G;
const S = {};
(G.scenes = G.scenes || {}).dry = S;

let hangT = 0;
let dry = 0;
let done = false;
let drips = [];
let sparks = [];
let newBtn = { x: 0, y: 0, r: 34 };

S.debug = () => ({ newBtn, dry, done });

function sheet(){ return G.state.sheet; }

S.enter = function(){
  hangT = 0;
  dry = 0;
  done = false;
  drips = [];
  sparks = [];
  if (sheet().viewDirty) sheet().refreshWashView();
};

function ropeY(x){
  const W = G.W, H = G.H;
  const y0 = H * 0.2, y1 = H * 0.17, sag = H * 0.05;
  const t = x / W;
  return G.lerp(y0, y1, t) + Math.sin(Math.PI * t) * sag;
}

function paperRect(){
  const W = G.W, H = G.H;
  const sh = sheet();
  const a = sh.tw / sh.th;
  let pw = Math.min(W * 0.62, 460), ph = pw / a;
  const maxH = H * 0.52;
  if (ph > maxH) { ph = maxH; pw = ph * a; }
  const x = W / 2 - pw / 2;
  const yTop = ropeY(W / 2);
  return { x, y: yTop + 6, w: pw, h: ph };
}

S.update = function(dt){
  const W = G.W, H = G.H;
  hangT = Math.min(1, hangT + dt / 0.9);
  if (hangT >= 1) {
    const before = dry;
    dry = Math.min(1, dry + dt / 4.2);
    if (dry < 0.5 && Math.random() < dt * 6) {
      const p = paperRect();
      drips.push({
        x: p.x + Math.random() * p.w, y: p.y + p.h,
        vy: G.rand(40, 90), t: 0, life: G.rand(0.5, 0.9)
      });
      if (Math.random() < 0.3) G.audio.drip();
    }
    if (before < 1 && dry >= 1 && !done) {
      done = true;
      G.audio.chime();
      G.audio.sparkleBurst();
      const p = paperRect();
      for (let i = 0; i < 26; i++) {
        sparks.push({
          x: p.x + Math.random() * p.w, y: p.y + Math.random() * p.h,
          vx: G.rand(-50, 50), vy: G.rand(-90, -20),
          t: 0, life: G.rand(0.7, 1.4), s: G.rand(4, 11)
        });
      }
    }
  }
  for (let i = drips.length - 1; i >= 0; i--) {
    const d = drips[i];
    d.t += dt; d.vy += 500 * dt; d.y += d.vy * dt;
    if (d.t > d.life) drips.splice(i, 1);
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt;
    if (s.t > s.life) sparks.splice(i, 1);
  }
  newBtn = { x: W / 2, y: H - 76, r: 36 };
};

function drawHanging(ctx, img, cx, w, h, sway){
  const yTop = ropeY(cx);
  ctx.save();
  ctx.translate(cx, yTop);
  ctx.rotate(sway);
  ctx.shadowColor = 'rgba(60,80,110,0.25)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 8;
  ctx.drawImage(img, -w / 2, 6, w, h);
  ctx.shadowColor = 'transparent';
  // clothespins
  for (const dx of [-w * 0.32, w * 0.32]) {
    ctx.fillStyle = '#d8a86b';
    G.roundRect(ctx, dx - 6, -8, 12, 26, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(140,95,45,0.5)';
    ctx.fillRect(dx - 1.5, -8, 3, 14);
  }
  ctx.restore();
}

S.draw = function(ctx){
  const W = G.W, H = G.H, t = G.time;
  const sh = sheet();

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#a5daf2');
  sky.addColorStop(0.7, '#dff2fb');
  sky.addColorStop(1, '#f4fbff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // little sun in the corner, watching
  ctx.save();
  ctx.translate(W - 74, 74);
  G.icons.sun(ctx, 36, t, done, done ? 0.4 : 0.15);
  ctx.restore();

  // grass
  const gg = ctx.createLinearGradient(0, H * 0.82, 0, H);
  gg.addColorStop(0, '#b8e29b');
  gg.addColorStop(1, '#8cc873');
  ctx.fillStyle = gg;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.88);
  ctx.quadraticCurveTo(W * 0.5, H * 0.82, W, H * 0.88);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 7; i++) {
    const fx = (i + 0.5) * W / 7, fy = H * (0.9 + 0.05 * Math.sin(i * 3.7));
    ctx.fillStyle = ['#ff9fc0', '#ffd76e', '#9fc7ef'][i % 3];
    for (let k = 0; k < 5; k++) {
      const a = k * G.TAU / 5;
      ctx.beginPath();
      ctx.ellipse(fx + Math.cos(a) * 5, fy + Math.sin(a) * 5, 3.4, 3.4, 0, 0, G.TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(fx, fy, 2.6, 0, G.TAU);
    ctx.fill();
  }

  // clothesline
  ctx.strokeStyle = '#b78955';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 16) {
    if (x === 0) ctx.moveTo(x, ropeY(x)); else ctx.lineTo(x, ropeY(x));
  }
  ctx.stroke();

  // earlier prints from this play session
  const p = paperRect();
  const prints = G.state.prints;
  for (let i = 0; i < prints.length; i++) {
    const pi = prints[prints.length - 1 - i];
    const cx = W / 2 + (i === 0 ? -1 : 1) * W * 0.33;
    const w = p.w * 0.45, h = w / pi.ar;
    drawHanging(ctx, pi.c, cx, w, h, Math.sin(t * 1.1 + i * 2) * 0.02);
  }

  // current paper rises up to the line
  const rise = G.easeOut(hangT);
  const cy = G.lerp(H + p.h, 0, rise);
  ctx.save();
  ctx.translate(0, cy);
  drawHanging(ctx, sh.viewC, W / 2, p.w, p.h, Math.sin(t * 1.3) * 0.02 * (2 - dry));
  // wet sheen and drying deepening, clipped to the paper
  ctx.save();
  ctx.translate(W / 2, ropeY(W / 2));
  ctx.rotate(Math.sin(t * 1.3) * 0.02 * (2 - dry));
  ctx.beginPath();
  ctx.rect(-p.w / 2, 6, p.w, p.h);
  ctx.clip();
  if (dry < 1) {
    const shg = ctx.createLinearGradient(-p.w / 2, 6, p.w / 2, p.h);
    shg.addColorStop(0, 'rgba(255,255,255,' + 0.22 * (1 - dry) + ')');
    shg.addColorStop(0.5, 'rgba(255,255,255,0)');
    shg.addColorStop(1, 'rgba(180,210,230,' + 0.15 * (1 - dry) + ')');
    ctx.fillStyle = shg;
    ctx.fillRect(-p.w / 2, 6, p.w, p.h);
  }
  if (dry > 0) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(24,48,105,' + 0.15 * dry + ')';
    ctx.fillRect(-p.w / 2, 6, p.w, p.h);
  }
  ctx.restore();
  ctx.restore();

  // drips
  ctx.fillStyle = 'rgba(150,200,230,0.8)';
  for (const d of drips) {
    ctx.globalAlpha = 1 - d.t / d.life;
    ctx.beginPath();
    ctx.ellipse(d.x, d.y + cy, 2.5, 4, 0, 0, G.TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // sparkles
  for (const s of sparks) {
    ctx.save();
    ctx.globalAlpha = 1 - s.t / s.life;
    ctx.translate(s.x, s.y);
    ctx.rotate(s.t * 3);
    G.icons.sparkle(ctx, s.s);
    ctx.restore();
  }

  // new sheet button
  if (done) {
    ctx.save();
    ctx.translate(newBtn.x, newBtn.y);
    ctx.scale(1 + 0.05 * Math.sin(t * 3), 1 + 0.05 * Math.sin(t * 3));
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(0, 0, newBtn.r + 10, 0, G.TAU);
    ctx.fill();
    G.icons.newPaper(ctx, newBtn.r * 0.8, t);
    ctx.restore();
    G.icons.hint(ctx, newBtn.x, newBtn.y, newBtn.r + 16, t);
  }
};

S.down = function(id, p){
  if (done && G.dist(p.x, p.y, newBtn.x, newBtn.y) < newBtn.r + 18) {
    const sh = sheet();
    G.state.prints.push({ c: sh.bakePrint(), ar: sh.tw / sh.th });
    if (G.state.prints.length > 2) G.state.prints.shift();
    G.newSheet();
    G.audio.pop();
    G.fadeTo('table');
    return;
  }
  const pRect = paperRect();
  if (p.x > pRect.x && p.x < pRect.x + pRect.w && p.y > pRect.y && p.y < pRect.y + pRect.h) {
    G.audio.ping();
    for (let i = 0; i < 6; i++) {
      sparks.push({
        x: p.x + G.rand(-20, 20), y: p.y + G.rand(-20, 20),
        vx: G.rand(-40, 40), vy: G.rand(-70, -10),
        t: 0, life: G.rand(0.5, 1), s: G.rand(4, 9)
      });
    }
  }
};
})();
