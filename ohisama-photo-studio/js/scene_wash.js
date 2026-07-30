'use strict';
(function(){
const G = window.G;
const S = {};
(G.scenes = G.scenes || {}).wash = S;

let pr = { x: 0, y: 0, w: 0, h: 0 };
let basin = { x: 0, y: 0, w: 0, h: 0 };
let pegPos = { x: 0, y: 0, r: 30 };
let drags = {};
let splashes = [];
let bubbles = [];
let streaks = [];
let tilt = 0, tiltTarget = 0;
let enterT = 0;
let washSpeed = 0;
let lastRefresh = 0;
let splashed = false;
let idleT = 0;

S.debug = () => ({ pr, basin, pegPos, pegOn: pegOn() });

function sheet(){ return G.state.sheet; }
function pegOn(){
  const sh = sheet();
  return sh.washAvg > 0.15 && sh.washAvg + sh.soak > 0.5 && enterT > 1;
}

S.enter = function(){
  const sh = sheet();
  sh.beginWash();
  G.state.objects = [];
  drags = {};
  splashes = [];
  bubbles = [];
  streaks = [];
  tilt = 0; tiltTarget = 0;
  enterT = 0;
  washSpeed = 0;
  splashed = false;
  idleT = 0;
  G.audio.washStart();
  for (let i = 0; i < 7; i++) {
    bubbles.push({ x: Math.random(), y: Math.random(), r: G.rand(3, 8), ph: G.rand(0, 6) });
  }
};

S.exit = function(){
  G.audio.washStop();
};

function layout(){
  const W = G.W, H = G.H;
  const sh = sheet();
  const a = sh.tw / sh.th;
  const m = 56;
  let pw = W - m * 2, ph = pw / a;
  const availH = H - 150;
  if (ph > availH) { ph = availH; pw = ph * a; }
  pr = { x: W / 2 - pw / 2, y: (H + 70) / 2 - ph / 2, w: pw, h: ph };
  basin = { x: pr.x - 30, y: pr.y - 30, w: pw + 60, h: ph + 60 };
  pegPos = { x: W / 2, y: 52, r: 30 };
}

function toTex(p){
  const sh = sheet();
  return { x: (p.x - pr.x) / pr.w * sh.tw, y: (p.y - pr.y) / pr.h * sh.th };
}

S.update = function(dt){
  layout();
  const sh = sheet();
  enterT += dt;
  idleT += dt;

  tilt += (tiltTarget - tilt) * Math.min(1, dt * 5);
  washSpeed = Math.max(0, washSpeed - dt * 2.2);
  G.audio.washLevel(washSpeed);

  if (!splashed && enterT > 0.55) {
    splashed = true;
    G.audio.splash();
    for (let i = 0; i < 22; i++) {
      splashes.push({
        x: G.rand(pr.x, pr.x + pr.w), y: pr.y + pr.h * G.rand(0.3, 0.9),
        vx: G.rand(-120, 120), vy: G.rand(-260, -80),
        r: G.rand(3, 7), t: 0, life: G.rand(0.4, 0.7)
      });
    }
  }

  // soaking in the water slowly rinses even unscrubbed spots
  sh.soak = Math.min(0.5, sh.soak + dt * 0.022);
  S._soakTick = (S._soakTick || 0) + dt;
  if (S._soakTick > 0.45) { S._soakTick = 0; sh.viewDirty = true; }

  // tilting the tray makes the blue run in soft streaks
  if (Math.abs(tilt) > 2.5 && sh.washAvg > 0.06 && sh.brightPts && sh.brightPts.length) {
    if (streaks.length < 10 && Math.random() < dt * Math.abs(tilt) * 1.4) {
      const [x, y] = G.pick(sh.brightPts);
      streaks.push({
        x, y,
        vx: Math.sign(tilt) * G.rand(30, 85) * Math.abs(tilt) / 9,
        vy: G.rand(-4, 14),
        w: G.rand(9, 20), t: 0, life: G.rand(0.9, 1.6)
      });
    }
  }
  const sc = sh.sctx;
  sc.lineCap = 'round';
  sc.strokeStyle = 'rgba(30,58,118,0.018)';
  for (let i = streaks.length - 1; i >= 0; i--) {
    const st = streaks[i];
    st.t += dt;
    const nx = st.x + st.vx * dt, ny = st.y + st.vy * dt;
    sc.lineWidth = st.w;
    sc.beginPath();
    sc.moveTo(st.x, st.y);
    sc.lineTo(nx, ny);
    sc.stroke();
    st.x = nx; st.y = ny;
    if (st.t > st.life || st.x < 0 || st.x > sh.tw) streaks.splice(i, 1);
    else sh.viewDirty = true;
  }

  if (sh.viewDirty && G.time - lastRefresh > 1 / 12) {
    lastRefresh = G.time;
    sh.refreshWashView();
  }

  for (let i = splashes.length - 1; i >= 0; i--) {
    const p = splashes[i];
    p.t += dt;
    p.vy += 700 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.t > p.life) splashes.splice(i, 1);
  }
};

S.draw = function(ctx){
  const W = G.W, H = G.H, t = G.time;
  const sh = sheet();

  // tiled bathroom-ish background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#c3e5ec');
  bg.addColorStop(1, '#9dd0dc');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  for (let x = 32; x < W; x += 72) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 32; y < H; y += 72) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // basin
  ctx.save();
  ctx.shadowColor = 'rgba(30,60,80,0.3)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#eef3f4';
  G.roundRect(ctx, basin.x - 14, basin.y - 14, basin.w + 28, basin.h + 28, 30);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#79b8cc';
  G.roundRect(ctx, basin.x, basin.y, basin.w, basin.h, 20);
  ctx.fill();

  // paper (slides in, then tilts with the tray)
  const slide = G.easeOut(Math.min(1, enterT / 0.6));
  const py = G.lerp(-pr.h - 40, pr.y, slide);
  ctx.save();
  ctx.translate(pr.x + pr.w / 2, py + pr.h / 2);
  ctx.rotate(tilt * Math.PI / 180);
  ctx.drawImage(sh.viewC, -pr.w / 2, -pr.h / 2, pr.w, pr.h);
  ctx.fillStyle = 'rgba(110,160,190,0.12)';
  ctx.fillRect(-pr.w / 2, -pr.h / 2, pr.w, pr.h);
  ctx.restore();

  // water overlay (always level -> shows the tilt)
  ctx.save();
  G.roundRect(ctx, basin.x, basin.y, basin.w, basin.h, 20);
  ctx.clip();
  const wg = ctx.createLinearGradient(0, basin.y, 0, basin.y + basin.h);
  wg.addColorStop(0, 'rgba(160,215,235,0.4)');
  wg.addColorStop(1, 'rgba(120,180,210,0.16)');
  ctx.fillStyle = wg;
  ctx.fillRect(basin.x, basin.y, basin.w, basin.h);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const yy = basin.y + basin.h * (0.25 + i * 0.25) + Math.sin(t * 1.4 + i * 2) * 6;
    ctx.beginPath();
    for (let x = 0; x <= 1; x += 0.05) {
      const px = basin.x + 14 + x * (basin.w - 28);
      const yw = yy + Math.sin(x * 9 + t * 2.2 + i) * 4;
      if (x === 0) ctx.moveTo(px, yw); else ctx.lineTo(px, yw);
    }
    ctx.stroke();
  }
  for (const b of bubbles) {
    const bx = basin.x + 16 + b.x * (basin.w - 32) + Math.sin(t * 0.8 + b.ph) * 8;
    const by = basin.y + 16 + b.y * (basin.h - 32) + Math.cos(t * 0.6 + b.ph) * 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bx, by, b.r, 0, G.TAU);
    ctx.stroke();
  }
  ctx.restore();

  // splash droplets
  for (const p of splashes) {
    ctx.globalAlpha = 1 - p.t / p.life;
    ctx.fillStyle = '#dff3fa';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, G.TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // clothesline icon when washed enough
  if (pegOn()) {
    ctx.save();
    ctx.translate(pegPos.x, pegPos.y);
    ctx.scale(1 + 0.04 * Math.sin(t * 3), 1 + 0.04 * Math.sin(t * 3));
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, pegPos.r + 8, 0, G.TAU);
    ctx.fill();
    G.icons.peg(ctx, pegPos.r * 0.85);
    ctx.restore();
    if (idleT > 2.5) G.icons.hint(ctx, pegPos.x, pegPos.y, pegPos.r + 14, t);
  } else if (idleT > 3 && enterT > 1.5) {
    // hint: rub the middle of the paper
    G.icons.hint(ctx, pr.x + pr.w / 2, pr.y + pr.h / 2, 44, t);
  }
};

S.down = function(id, p){
  idleT = 0;
  if (pegOn() && G.dist(p.x, p.y, pegPos.x, pegPos.y) < pegPos.r + 16) {
    G.audio.ping();
    G.fadeTo('dry');
    return;
  }
  const inPaper = p.x > pr.x && p.x < pr.x + pr.w && p.y > pr.y && p.y < pr.y + pr.h;
  const inBasin = p.x > basin.x - 14 && p.x < basin.x + basin.w + 14 && p.y > basin.y - 14 && p.y < basin.y + basin.h + 14;
  if (inPaper && enterT > 0.7) {
    drags[id] = { mode: 'scrub', lx: p.x, ly: p.y };
  } else if (inBasin) {
    drags[id] = { mode: 'tilt', sx: p.x };
  }
};

S.move = function(id, p){
  const d = drags[id];
  if (!d) return;
  const sh = sheet();
  if (d.mode === 'scrub') {
    const dist = G.dist(p.x, p.y, d.lx, d.ly);
    if (dist > 2) {
      const tp = toTex(p);
      const r = Math.max(52, sh.tw * 0.16);
      sh.scrub(tp.x, tp.y, r, Math.min(30, dist) * 0.028);
      washSpeed = Math.min(1, washSpeed + dist * 0.004);
      if (Math.random() < 0.35) {
        splashes.push({
          x: p.x + G.rand(-14, 14), y: p.y + G.rand(-10, 6),
          vx: G.rand(-90, 90), vy: G.rand(-190, -60),
          r: G.rand(2, 6), t: 0, life: G.rand(0.3, 0.55)
        });
      }
      if (Math.random() < 0.05) G.audio.drip();
      d.lx = p.x; d.ly = p.y;
    }
  } else if (d.mode === 'tilt') {
    tiltTarget = G.clamp((p.x - d.sx) * 0.06, -9, 9);
  }
};

S.up = function(id){
  const d = drags[id];
  if (!d) return;
  if (d.mode === 'tilt') tiltTarget = 0;
  delete drags[id];
};
})();
