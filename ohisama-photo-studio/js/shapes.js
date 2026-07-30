'use strict';
(function(){
const G = window.G;
const TAU = G.TAU;

/* =========================================================
 * Placeable objects.
 * Each shape draws centered at (0,0) with nominal half-size s.
 *  - real(ctx, s): pretty full-color version (tray / on the paper)
 *  - mask(ctx, s): light-blocking map, white with per-part alpha.
 *    Translucent parts (leaf veins, gems, fabric) block less light,
 *    so they come out blue inside the white silhouette — like a
 *    real photogram. mask() is always drawn on its own temp canvas,
 *    so destination-out is safe here.
 * ========================================================= */

/* ---------- leaf ---------- */
function leafPath(ctx, s){
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.bezierCurveTo(s*0.62, -s*0.55, s*0.66, s*0.35, 0, s*0.95);
  ctx.bezierCurveTo(-s*0.66, s*0.35, -s*0.62, -s*0.55, 0, -s);
  ctx.closePath();
}
function leafVeins(ctx, s, stroke, aMain, aSide){
  ctx.lineCap = 'round';
  ctx.strokeStyle = stroke;
  ctx.globalAlpha = aMain;
  ctx.lineWidth = s*0.055;
  ctx.beginPath();
  ctx.moveTo(0, -s*0.85);
  ctx.quadraticCurveTo(s*0.03, 0, 0, s*0.9);
  ctx.stroke();
  ctx.lineWidth = s*0.035;
  ctx.globalAlpha = aSide;
  for (let i = 0; i < 5; i++) {
    const y = -s*0.62 + i * s*0.3;
    const len = s * (0.42 - Math.abs(i - 2) * 0.07);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.quadraticCurveTo(len*0.5, y + s*0.06, len, y + s*0.18);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.quadraticCurveTo(-len*0.5, y + s*0.06, -len, y + s*0.18);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
const leaf = {
  id: 'leaf', k: 1.0,
  real(ctx, s){
    const g = ctx.createLinearGradient(0, -s, 0, s);
    g.addColorStop(0, '#74c264');
    g.addColorStop(1, '#3c8a46');
    ctx.strokeStyle = '#39813f';
    ctx.lineWidth = s*0.09;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, s*0.9);
    ctx.quadraticCurveTo(s*0.02, s*1.05, s*0.09, s*1.2);
    ctx.stroke();
    ctx.fillStyle = g;
    leafPath(ctx, s);
    ctx.fill();
    ctx.strokeStyle = 'rgba(35,90,45,0.5)';
    ctx.lineWidth = s*0.04;
    ctx.stroke();
    leafVeins(ctx, s, 'rgba(233,255,224,0.8)', 0.85, 0.6);
  },
  mask(ctx, s){
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    leafPath(ctx, s);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = s*0.09;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, s*0.9);
    ctx.quadraticCurveTo(s*0.02, s*1.05, s*0.09, s*1.2);
    ctx.stroke();
    // veins let sunlight through -> blue lines inside the white leaf
    ctx.globalCompositeOperation = 'destination-out';
    leafVeins(ctx, s, 'rgba(0,0,0,1)', 0.5, 0.4);
    ctx.globalCompositeOperation = 'source-over';
  }
};

/* ---------- shell (scallop) ---------- */
function shellGeom(s){
  const hy = s*0.78, R = s*1.5;
  const a0 = -2.55, a1 = -0.59, lobes = 6;
  const rim = [];
  for (let i = 0; i <= lobes; i++) {
    const a = a0 + (a1 - a0) * i / lobes;
    rim.push([Math.cos(a) * R, hy + Math.sin(a) * R, a]);
  }
  return { hy, R, rim, a0, a1, lobes };
}
function shellPath(ctx, s){
  const g = shellGeom(s);
  ctx.beginPath();
  ctx.moveTo(-s*0.22, g.hy);
  ctx.lineTo(g.rim[0][0], g.rim[0][1]);
  for (let i = 0; i < g.rim.length - 1; i++) {
    const a = (g.rim[i][2] + g.rim[i+1][2]) / 2;
    const bx = Math.cos(a) * g.R * 1.13;
    const by = g.hy + Math.sin(a) * g.R * 1.13;
    ctx.quadraticCurveTo(bx, by, g.rim[i+1][0], g.rim[i+1][1]);
  }
  ctx.lineTo(s*0.22, g.hy);
  ctx.closePath();
}
function shellRidges(ctx, s, stroke, alpha, width){
  const g = shellGeom(s);
  ctx.strokeStyle = stroke;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  for (let i = 1; i < g.rim.length - 1; i++) {
    const [rx, ry] = g.rim[i];
    ctx.beginPath();
    ctx.moveTo(rx*0.12, g.hy + (ry - g.hy) * 0.12);
    ctx.lineTo(rx*0.94, g.hy + (ry - g.hy) * 0.94);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
const shell = {
  id: 'shell', k: 0.92,
  real(ctx, s){
    const gr = ctx.createLinearGradient(0, -s, 0, s*0.8);
    gr.addColorStop(0, '#f9ecda');
    gr.addColorStop(0.55, '#f2cfae');
    gr.addColorStop(1, '#e0a37e');
    ctx.fillStyle = gr;
    shellPath(ctx, s);
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,120,85,0.55)';
    ctx.lineWidth = s*0.045;
    ctx.stroke();
    shellRidges(ctx, s, 'rgba(196,138,100,0.75)', 1, s*0.045);
    ctx.fillStyle = '#e0a37e';
    G.roundRect(ctx, -s*0.26, s*0.72, s*0.52, s*0.2, s*0.07);
    ctx.fill();
  },
  mask(ctx, s){
    ctx.fillStyle = 'rgba(255,255,255,0.93)';
    shellPath(ctx, s);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.93)';
    G.roundRect(ctx, -s*0.26, s*0.72, s*0.52, s*0.2, s*0.07);
    ctx.fill();
    // grooves between the ribs are thinner -> light leaks through
    ctx.globalCompositeOperation = 'destination-out';
    shellRidges(ctx, s, 'rgba(0,0,0,1)', 0.45, s*0.055);
    ctx.globalCompositeOperation = 'source-over';
  }
};

/* ---------- ribbon bow ---------- */
function ribbonLoop(ctx, s, dir){
  ctx.beginPath();
  ctx.moveTo(0, -s*0.08);
  ctx.bezierCurveTo(dir*s*0.45, -s*0.72, dir*s*1.18, -s*0.52, dir*s*1.08, -s*0.08);
  ctx.bezierCurveTo(dir*s*1.0, s*0.3, dir*s*0.4, s*0.28, 0, s*0.08);
  ctx.closePath();
}
function ribbonTail(ctx, s, dir){
  ctx.beginPath();
  ctx.moveTo(dir*s*0.08, s*0.12);
  ctx.quadraticCurveTo(dir*s*0.52, s*0.5, dir*s*0.72, s*0.98);
  ctx.lineTo(dir*s*0.5, s*0.82);
  ctx.lineTo(dir*s*0.3, s*1.0);
  ctx.quadraticCurveTo(dir*s*0.16, s*0.5, dir*s*0.04, s*0.3);
  ctx.closePath();
}
const ribbon = {
  id: 'ribbon', k: 0.88,
  real(ctx, s){
    ctx.fillStyle = '#f78cb1';
    ribbonTail(ctx, s, 1); ctx.fill();
    ribbonTail(ctx, s, -1); ctx.fill();
    ctx.fillStyle = '#ff9fc0';
    ribbonLoop(ctx, s, 1); ctx.fill();
    ribbonLoop(ctx, s, -1); ctx.fill();
    ctx.strokeStyle = 'rgba(200,80,125,0.5)';
    ctx.lineWidth = s*0.05;
    ribbonLoop(ctx, s, 1); ctx.stroke();
    ribbonLoop(ctx, s, -1); ctx.stroke();
    ctx.fillStyle = '#e86f9c';
    G.roundRect(ctx, -s*0.2, -s*0.22, s*0.4, s*0.44, s*0.12);
    ctx.fill();
  },
  mask(ctx, s){
    // fabric is a bit translucent; overlapping layers block more
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ribbonTail(ctx, s, 1); ctx.fill();
    ribbonTail(ctx, s, -1); ctx.fill();
    ribbonLoop(ctx, s, 1); ctx.fill();
    ribbonLoop(ctx, s, -1); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    G.roundRect(ctx, -s*0.2, -s*0.22, s*0.4, s*0.44, s*0.12);
    ctx.fill();
  }
};

/* ---------- star ---------- */
function starPath(ctx, s){
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? s : s*0.46;
    const a = -Math.PI/2 + i * Math.PI/5;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
const star = {
  id: 'star', k: 0.9,
  real(ctx, s){
    const g = ctx.createLinearGradient(-s, -s, s, s);
    g.addColorStop(0, '#ffe089');
    g.addColorStop(1, '#f2a93b');
    ctx.fillStyle = g;
    starPath(ctx, s);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,140,40,0.7)';
    ctx.lineWidth = s*0.06;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(-s*0.22, -s*0.3, s*0.12, 0, TAU);
    ctx.fill();
  },
  mask(ctx, s){
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    starPath(ctx, s);
    ctx.fill();
  }
};

/* ---------- heart ---------- */
function heartPath(ctx, s){
  ctx.beginPath();
  ctx.moveTo(0, s*0.9);
  ctx.bezierCurveTo(-s*1.05, s*0.15, -s*0.75, -s*0.85, 0, -s*0.35);
  ctx.bezierCurveTo(s*0.75, -s*0.85, s*1.05, s*0.15, 0, s*0.9);
  ctx.closePath();
}
const heart = {
  id: 'heart', k: 0.9,
  real(ctx, s){
    const g = ctx.createLinearGradient(0, -s, 0, s);
    g.addColorStop(0, '#ff9db4');
    g.addColorStop(1, '#e84f78');
    ctx.fillStyle = g;
    heartPath(ctx, s);
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,50,90,0.55)';
    ctx.lineWidth = s*0.055;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(-s*0.34, -s*0.32, s*0.16, s*0.1, -0.5, 0, TAU);
    ctx.fill();
  },
  mask(ctx, s){
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    heartPath(ctx, s);
    ctx.fill();
  }
};

/* ---------- tiara ---------- */
function tiaraGeom(s){
  const peaks = [];
  for (const f of [-0.58, 0, 0.58]) {
    const t = (f + 1) / 2;
    peaks.push({ x: f * s, y: s * t * (1 - t) * 2, h: f === 0 ? s*0.85 : s*0.55 });
  }
  return peaks;
}
function tiaraBand(ctx, s){
  ctx.beginPath();
  ctx.moveTo(-s, 0);
  ctx.quadraticCurveTo(0, s*0.5, s, 0);
}
function tiaraDraw(ctx, s, metal, drawGem){
  const peaks = tiaraGeom(s);
  ctx.lineCap = 'round';
  for (const p of peaks) {
    ctx.fillStyle = metal;
    ctx.beginPath();
    ctx.moveTo(p.x - s*0.16, p.y);
    ctx.quadraticCurveTo(p.x - s*0.05, p.y - p.h*0.6, p.x, p.y - p.h);
    ctx.quadraticCurveTo(p.x + s*0.05, p.y - p.h*0.6, p.x + s*0.16, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y - p.h - s*0.04, s*0.07, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = metal;
  ctx.lineWidth = s*0.17;
  tiaraBand(ctx, s);
  ctx.stroke();
  drawGem(0, s*0.25, s*0.12, 0);
  drawGem(-s*0.5, s*0.19, s*0.075, 1);
  drawGem(s*0.5, s*0.19, s*0.075, 2);
}
const tiara = {
  id: 'tiara', k: 1.05,
  real(ctx, s){
    const g = ctx.createLinearGradient(0, -s, 0, s*0.5);
    g.addColorStop(0, '#f6d264');
    g.addColorStop(1, '#d99a2e');
    const gemColors = ['#ff6fa8', '#58c9e8', '#58c9e8'];
    tiaraDraw(ctx, s, '#eebd4a', (x, y, r, i) => {
      const rg = ctx.createRadialGradient(x - r*0.3, y - r*0.3, r*0.1, x, y, r);
      rg.addColorStop(0, '#ffffff');
      rg.addColorStop(0.35, gemColors[i]);
      rg.addColorStop(1, gemColors[i]);
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(170,120,30,0.7)';
      ctx.lineWidth = r*0.25;
      ctx.stroke();
    });
    ctx.fillStyle = g;
  },
  mask(ctx, s){
    tiaraDraw(ctx, s, 'rgba(255,255,255,0.95)', () => {});
    // gems are glass: light shines through them -> blue dots in the print
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (const [x, y, r] of [[0, s*0.25, s*0.12], [-s*0.5, s*0.19, s*0.075], [s*0.5, s*0.19, s*0.075]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
};

G.shapes = { list: [leaf, star, heart, ribbon, shell, tiara], byId: {} };
for (const sh of G.shapes.list) G.shapes.byId[sh.id] = sh;

/* =========================================================
 * UI icons (all vector, no text)
 * ========================================================= */
const I = G.icons = {};

I.sun = function(ctx, r, t, held, power){
  power = power || 0;
  if (power > 0.02) {
    const g = ctx.createRadialGradient(0, 0, r*0.5, 0, 0, r*2.4);
    g.addColorStop(0, 'rgba(255,225,130,' + 0.4*power + ')');
    g.addColorStop(1, 'rgba(255,225,130,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r*2.4, 0, TAU);
    ctx.fill();
  }
  ctx.save();
  ctx.rotate(t * 0.25);
  ctx.fillStyle = 'rgba(255,203,77,0.95)';
  for (let i = 0; i < 12; i++) {
    ctx.rotate(TAU / 12);
    const len = r * (1.32 + (i % 2) * 0.14 + 0.05*Math.sin(t*3 + i) + power*0.18);
    ctx.beginPath();
    ctx.moveTo(r*0.86, -r*0.13);
    ctx.lineTo(len, 0);
    ctx.lineTo(r*0.86, r*0.13);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const g2 = ctx.createRadialGradient(-r*0.25, -r*0.3, r*0.1, 0, 0, r);
  g2.addColorStop(0, '#fff4c8');
  g2.addColorStop(0.55, '#ffd76e');
  g2.addColorStop(1, '#ffab45');
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  // face
  ctx.strokeStyle = '#8a5a20';
  ctx.lineCap = 'round';
  ctx.lineWidth = r*0.07;
  if (held) {
    for (const dx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(dx * r*0.32, -r*0.02, r*0.13, Math.PI, TAU);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#6b4a1d';
    for (const dx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(dx * r*0.32, -r*0.08, r*0.08, 0, TAU);
      ctx.fill();
    }
  }
  ctx.beginPath();
  ctx.arc(0, r*0.12, r*0.26, 0.3, Math.PI - 0.3);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,110,80,0.35)';
  for (const dx of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(dx * r*0.5, r*0.16, r*0.14, 0, TAU);
    ctx.fill();
  }
};

I.cloud = function(ctx, s){
  ctx.fillStyle = 'rgba(200,218,232,0.9)';
  ctx.beginPath();
  ctx.ellipse(0, s*0.3, s*1.05, s*0.42, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  for (const [x, y, r] of [[-s*0.55, 0.05*s, s*0.44], [0, -s*0.2, s*0.56], [s*0.52, 0.02*s, s*0.42], [0, s*0.14, s*0.5]]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
};

I.bucket = function(ctx, s){
  ctx.strokeStyle = '#88919b';
  ctx.lineWidth = s*0.1;
  ctx.beginPath();
  ctx.arc(0, -s*0.15, s*0.62, Math.PI*1.15, Math.PI*1.85);
  ctx.stroke();
  const g = ctx.createLinearGradient(0, -s*0.5, 0, s*0.7);
  g.addColorStop(0, '#8fd0ea');
  g.addColorStop(1, '#4f9cc9');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-s*0.62, -s*0.3);
  ctx.lineTo(-s*0.45, s*0.62);
  ctx.quadraticCurveTo(0, s*0.74, s*0.45, s*0.62);
  ctx.lineTo(s*0.62, -s*0.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#cdeaf6';
  ctx.beginPath();
  ctx.ellipse(0, -s*0.3, s*0.62, s*0.16, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#9fd9ef';
  ctx.beginPath();
  ctx.ellipse(0, -s*0.3, s*0.5, s*0.11, 0, 0, TAU);
  ctx.fill();
};

I.peg = function(ctx, s){
  // clothesline with a small hanging print
  ctx.strokeStyle = '#b78955';
  ctx.lineWidth = s*0.09;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-s*0.9, -s*0.35);
  ctx.quadraticCurveTo(0, -s*0.15, s*0.9, -s*0.35);
  ctx.stroke();
  ctx.fillStyle = '#f6f7f2';
  G.roundRect(ctx, -s*0.42, -s*0.28, s*0.84, s*0.95, s*0.08);
  ctx.fill();
  ctx.fillStyle = '#3c66a8';
  G.roundRect(ctx, -s*0.32, -s*0.16, s*0.64, s*0.7, s*0.06);
  ctx.fill();
  ctx.fillStyle = '#f6f7f2';
  ctx.beginPath();
  ctx.arc(-s*0.05, s*0.18, s*0.16, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#d8a86b';
  G.roundRect(ctx, -s*0.3, -s*0.42, s*0.14, s*0.3, s*0.05);
  ctx.fill();
  G.roundRect(ctx, s*0.16, -s*0.42, s*0.14, s*0.3, s*0.05);
  ctx.fill();
};

I.newPaper = function(ctx, s, t){
  ctx.save();
  ctx.rotate(-0.08);
  ctx.fillStyle = '#e4e8c4';
  G.roundRect(ctx, -s*0.6, -s*0.72, s*1.2, s*1.44, s*0.1);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#f0f2d8';
  G.roundRect(ctx, -s*0.55, -s*0.66, s*1.2, s*1.44, s*0.1);
  ctx.fill();
  ctx.strokeStyle = 'rgba(160,165,120,0.6)';
  ctx.lineWidth = s*0.05;
  G.roundRect(ctx, -s*0.55, -s*0.66, s*1.2, s*1.44, s*0.1);
  ctx.stroke();
  ctx.save();
  ctx.translate(s*0.55, -s*0.55);
  ctx.rotate((t || 0) * 0.8);
  I.sparkle(ctx, s*0.34);
  ctx.restore();
};

I.sparkle = function(ctx, s){
  ctx.fillStyle = '#ffd76e';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? s : s*0.36;
    const a = i * Math.PI / 4;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
};

I.speaker = function(ctx, s, muted){
  ctx.fillStyle = '#5b6770';
  ctx.beginPath();
  ctx.moveTo(-s*0.9, -s*0.35);
  ctx.lineTo(-s*0.3, -s*0.35);
  ctx.lineTo(s*0.25, -s*0.85);
  ctx.lineTo(s*0.25, s*0.85);
  ctx.lineTo(-s*0.3, s*0.35);
  ctx.lineTo(-s*0.9, s*0.35);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#5b6770';
  ctx.lineWidth = s*0.18;
  ctx.lineCap = 'round';
  if (muted) {
    ctx.beginPath();
    ctx.moveTo(s*0.45, -s*0.4);
    ctx.lineTo(s*1.05, s*0.4);
    ctx.moveTo(s*1.05, -s*0.4);
    ctx.lineTo(s*0.45, s*0.4);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(s*0.3, 0, s*0.55, -0.9, 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s*0.3, 0, s*0.95, -0.9, 0.9);
    ctx.stroke();
  }
};

I.basket = function(ctx, s){
  ctx.strokeStyle = '#a5763d';
  ctx.lineWidth = s*0.14;
  ctx.beginPath();
  ctx.arc(0, -s*0.1, s*0.5, Math.PI*1.1, Math.PI*1.9);
  ctx.stroke();
  ctx.fillStyle = '#d8a86b';
  ctx.beginPath();
  ctx.moveTo(-s*0.85, -s*0.15);
  ctx.lineTo(-s*0.6, s*0.6);
  ctx.quadraticCurveTo(0, s*0.75, s*0.6, s*0.6);
  ctx.lineTo(s*0.85, -s*0.15);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(140,95,45,0.55)';
  ctx.lineWidth = s*0.06;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * s*0.3, -s*0.13);
    ctx.lineTo(i * s*0.24, s*0.62);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-s*0.78, s*0.08);
  ctx.quadraticCurveTo(0, s*0.22, s*0.78, s*0.08);
  ctx.stroke();
};

I.hint = function(ctx, x, y, r, t){
  const p = 0.5 + 0.5 * Math.sin(t * 4);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,' + (0.35 + 0.4 * p) + ')';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, r * (1 + 0.09 * p), 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,210,110,' + (0.3 + 0.35 * p) + ')';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, r * (1.12 + 0.14 * p), 0, TAU);
  ctx.stroke();
  ctx.restore();
};
})();
