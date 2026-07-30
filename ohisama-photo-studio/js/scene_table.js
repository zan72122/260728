'use strict';
(function(){
const G = window.G;
const S = {};
(G.scenes = G.scenes || {}).table = S;

const TICK = 1 / 12;

let pr = { x: 0, y: 0, w: 0, h: 0 };   // paper rect on screen
let sunPos = { x: 0, y: 0, r: 50 };
let bucketPos = { x: 0, y: 0, r: 34 };
let tray = { open: 1, t: 1, vertical: false, pts: [], tab: { x: 0, y: 0 } };
let drags = {};
let clouds = [];
let particles = [];
let expAcc = 0;
let sunHeld = false, sunPointer = null, sunPower = 0;
let idleT = 0;

// exposed for automated tests
S.debug = () => ({ pr, sunPos, bucketPos, trayPts: tray.pts, bucketOn: bucketVisible() });

function sheet(){ return G.state.sheet; }
function bucketVisible(){ return sheet().exposureSec > 0.55; }

S.enter = function(){
  if (!G.state.sheet) G.newSheet();
  clouds = [];
  drags = {};
  particles = [];
  sunHeld = false; sunPointer = null; sunPower = 0;
  expAcc = 0;
  tray.open = 1; tray.t = 1;
  idleT = 0;
};

S.exit = function(){
  if (sunHeld) { sunHeld = false; G.audio.sunStop(); }
};

function layout(){
  const W = G.W, H = G.H;
  const landscape = W > H * 1.25;
  tray.vertical = landscape;
  const sunR = Math.min(60, Math.min(W, H) * 0.07 + 16);

  let ax0, ay0, ax1, ay1;
  if (landscape) {
    const trayW = 104;
    sunPos = { x: W - trayW - sunR - 26, y: sunR + 22, r: sunR };
    bucketPos = { x: 60, y: H - 62, r: 34 };
    ax0 = 120; ay0 = 30; ax1 = W - trayW - 26; ay1 = H - 26;
    const sp = Math.min(92, (H - 48) / 6);
    tray.pts = [];
    for (let i = 0; i < 6; i++) {
      tray.pts.push({ x: W - trayW / 2 + (1 - tray.t) * trayW, y: H / 2 + (i - 2.5) * sp });
    }
    tray.tab = { x: W - trayW * tray.t - 18, y: H / 2 };
    tray.panel = { x: W - trayW * tray.t, y: 12, w: trayW, h: H - 24 };
  } else {
    const trayH = 118;
    sunPos = { x: W - sunR - 20, y: sunR + 22, r: sunR };
    bucketPos = { x: W - 58, y: H - trayH - 62, r: 34 };
    ax0 = 22; ay0 = sunR * 2 + 44; ax1 = W - 22; ay1 = H - trayH - 34;
    const sp = Math.min(96, (W - 48) / 6);
    tray.pts = [];
    for (let i = 0; i < 6; i++) {
      tray.pts.push({ x: W / 2 + (i - 2.5) * sp, y: H - (trayH / 2 + 4) * tray.t + (1 - tray.t) * 40 });
    }
    tray.tab = { x: W / 2, y: H - trayH * tray.t - 18 };
    tray.panel = { x: 14, y: H - trayH * tray.t + 8, w: W - 28, h: trayH };
  }

  const sh = sheet();
  const a = sh.tw / sh.th;
  let pw = ax1 - ax0, ph = pw / a;
  if (ph > ay1 - ay0) { ph = ay1 - ay0; pw = ph * a; }
  pr = { x: (ax0 + ax1) / 2 - pw / 2, y: (ay0 + ay1) / 2 - ph / 2, w: pw, h: ph };
}

function toTex(p){
  const sh = sheet();
  return { x: (p.x - pr.x) / pr.w * sh.tw, y: (p.y - pr.y) / pr.h * sh.th };
}
function toScr(x, y){
  const sh = sheet();
  return { x: pr.x + x / sh.tw * pr.w, y: pr.y + y / sh.th * pr.h };
}

function spawnCloud(){
  const c = {
    x: -80, y: G.rand(40, sunPos.y + 40),
    s: G.rand(34, 52),
    vx: G.rand(70, 110),
    shadowY: G.rand(0.25, 0.75) * sheet().th,
    subs: [[G.rand(-0.5, 0.5), G.rand(-0.4, 0.4)], [G.rand(-0.5, 0.5), G.rand(-0.4, 0.4)]]
  };
  clouds.push(c);
  G.audio.wind();
}

function cloudShadows(){
  const sh = sheet(), out = [];
  for (const c of clouds) {
    const cx = (c.x - pr.x) / pr.w * sh.tw;
    if (cx < -sh.tw * 0.4 || cx > sh.tw * 1.4) continue;
    const r = sh.tw * 0.24 * (c.s / 42);
    out.push({ x: cx, y: c.shadowY, r, a: 0.75 });
    for (const [ox, oy] of c.subs) out.push({ x: cx + ox * r, y: c.shadowY + oy * r, r: r * 0.7, a: 0.55 });
  }
  return out;
}

function cloudOcclusion(){
  let occ = 0;
  for (const c of clouds) {
    occ = Math.max(occ, 1 - Math.min(1, Math.abs(c.x - sunPos.x) / (sunPos.r * 3)));
  }
  return occ;
}

function addSparkles(x, y, n, spread){
  for (let i = 0; i < n; i++) {
    particles.push({
      x: x + G.rand(-spread, spread), y: y + G.rand(-spread, spread),
      vx: G.rand(-40, 40), vy: G.rand(-70, -10),
      life: G.rand(0.4, 0.8), t: 0, s: G.rand(4, 9)
    });
  }
}

S.update = function(dt){
  layout();
  const sh = sheet();
  idleT += dt;

  tray.t += ((tray.open ? 1 : 0) - tray.t) * Math.min(1, dt * 7);
  sunPower += ((sunHeld ? 1 : 0) - sunPower) * Math.min(1, dt * 6);

  if (sunHeld && sh.exposureSec > 1.1 && clouds.length < 1 && Math.random() < dt * 0.3) spawnCloud();
  for (let i = clouds.length - 1; i >= 0; i--) {
    clouds[i].x += clouds[i].vx * dt;
    if (clouds[i].x > G.W + 100) clouds.splice(i, 1);
  }

  if (sunPower > 0.04) {
    expAcc += dt;
    while (expAcc >= TICK) {
      expAcc -= TICK;
      if (sh.maskDirty) { sh.rebuildMask(G.state.objects); sh.maskDirty = false; }
      const power = sunPower * (1 - 0.55 * cloudOcclusion());
      sh.exposeTick(TICK, power, cloudShadows());
      sh.refreshExposedView();
    }
    if (Math.random() < dt * 2.0) G.audio.shimmer();
  } else {
    expAcc = 0;
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.t > p.life) particles.splice(i, 1);
  }
};

function drawWood(ctx){
  const W = G.W, H = G.H;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#d2a878');
  g.addColorStop(1, '#a87c4f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(90,55,25,0.08)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 7; i++) {
    const y = (i + 0.5) * H / 7;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.quadraticCurveTo(W / 2, y + 18 * Math.sin(i * 2.7), W, y - 10 * Math.sin(i * 1.3));
    ctx.stroke();
  }
}

function drawObject(ctx, o, i){
  const sh = sheet();
  const k = pr.w / sh.tw;
  const pos = toScr(o.x, o.y);
  const bob = o.lift > 0.02 ? Math.sin(G.time * 3 + i * 1.7) * o.lift * 4 : 0;
  const shape = G.shapes.byId[o.id];

  // soft ground shadow, farther when lifted
  ctx.save();
  ctx.translate(pos.x + 3 + o.lift * 8, pos.y + 6 + o.lift * 10);
  ctx.scale(1, 0.4);
  ctx.fillStyle = 'rgba(60,50,30,' + (0.12 - o.lift * 0.05) + ')';
  ctx.beginPath();
  ctx.arc(0, 0, o.s * k * 0.72, 0, G.TAU);
  ctx.fill();
  ctx.restore();

  let sy = 1;
  if (o.patAnim) {
    const e = G.time - o.patAnim;
    if (e < 0.18) sy = 1 - 0.25 * Math.sin(e / 0.18 * Math.PI);
  }
  ctx.save();
  ctx.translate(pos.x, pos.y + bob);
  ctx.rotate(o.rot);
  ctx.scale(k * (o.dragging ? 1.08 : 1), k * sy * (o.dragging ? 1.08 : 1));
  shape.real(ctx, o.s);
  ctx.restore();
}

S.draw = function(ctx){
  const W = G.W, H = G.H, t = G.time;
  const sh = sheet();
  drawWood(ctx);

  // paper
  ctx.save();
  ctx.shadowColor = 'rgba(70,45,15,0.35)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#e9ecc9';
  ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
  ctx.restore();
  ctx.drawImage(sh.viewC, pr.x, pr.y, pr.w, pr.h);

  // sun beam over the paper while exposing
  if (sunPower > 0.03) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(sunPos.x, sunPos.y, sunPos.r, sunPos.x, sunPos.y, Math.max(W, H));
    g.addColorStop(0, 'rgba(255,240,180,' + 0.28 * sunPower + ')');
    g.addColorStop(1, 'rgba(255,240,180,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // objects (drag ghosts included)
  for (let i = 0; i < G.state.objects.length; i++) drawObject(ctx, G.state.objects[i], i);

  // tray
  if (tray.t > 0.02 || true) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,252,240,0.72)';
    G.roundRect(ctx, tray.panel.x, tray.panel.y, tray.panel.w, tray.panel.h, 26);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,110,60,0.35)';
    ctx.lineWidth = 2;
    G.roundRect(ctx, tray.panel.x, tray.panel.y, tray.panel.w, tray.panel.h, 26);
    ctx.stroke();
    ctx.restore();
    if (tray.t > 0.4) {
      for (let i = 0; i < G.shapes.list.length; i++) {
        const p = tray.pts[i];
        ctx.save();
        ctx.globalAlpha = G.clamp((tray.t - 0.4) / 0.6, 0, 1);
        ctx.translate(p.x, p.y + Math.sin(t * 2 + i) * 2);
        ctx.rotate(Math.sin(t * 1.3 + i * 2) * 0.06);
        const ts = Math.min(24, Math.min(G.W, G.H) * 0.032 + 10);
        G.shapes.list[i].real(ctx, ts * G.shapes.list[i].k);
        ctx.restore();
      }
    }
  }
  // tray tab
  ctx.save();
  ctx.translate(tray.tab.x, tray.tab.y);
  ctx.fillStyle = 'rgba(255,252,240,0.9)';
  ctx.beginPath();
  ctx.arc(0, 0, 26, 0, G.TAU);
  ctx.fill();
  G.icons.basket(ctx, 15);
  ctx.restore();

  // clouds
  for (const c of clouds) {
    ctx.save();
    ctx.translate(c.x, c.y);
    G.icons.cloud(ctx, c.s);
    ctx.restore();
  }

  // sun
  ctx.save();
  ctx.translate(sunPos.x, sunPos.y);
  G.icons.sun(ctx, sunPos.r, t, sunHeld, sunPower);
  ctx.restore();

  // bucket appears once some exposure happened
  if (bucketVisible()) {
    ctx.save();
    ctx.translate(bucketPos.x, bucketPos.y);
    ctx.scale(1 + 0.04 * Math.sin(t * 3), 1 + 0.04 * Math.sin(t * 3));
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(0, 0, bucketPos.r + 8, 0, G.TAU);
    ctx.fill();
    G.icons.bucket(ctx, bucketPos.r * 0.9);
    ctx.restore();
  }

  // sparkles
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = 1 - p.t / p.life;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.t * 4);
    G.icons.sparkle(ctx, p.s);
    ctx.restore();
  }

  // wordless guidance
  if (idleT > 3) {
    if (G.state.objects.length === 0 && tray.t > 0.8) {
      G.icons.hint(ctx, tray.pts[0].x, tray.pts[0].y, 34, t);
    } else if (G.state.objects.length > 0 && sh.exposureSec < 0.55 && !sunHeld) {
      G.icons.hint(ctx, sunPos.x, sunPos.y, sunPos.r * 1.4, t);
    } else if (bucketVisible() && !sunHeld && idleT > 5) {
      G.icons.hint(ctx, bucketPos.x, bucketPos.y, bucketPos.r + 12, t);
    }
  }
};

S.down = function(id, p){
  idleT = 0;
  const sh = sheet();
  // sun
  if (G.dist(p.x, p.y, sunPos.x, sunPos.y) < sunPos.r * 1.3) {
    sunHeld = true; sunPointer = id;
    tray.open = 0;
    G.audio.sunStart();
    return;
  }
  // bucket
  if (bucketVisible() && G.dist(p.x, p.y, bucketPos.x, bucketPos.y) < bucketPos.r + 14) {
    G.audio.ping();
    G.fadeTo('wash');
    return;
  }
  // tray tab
  if (G.dist(p.x, p.y, tray.tab.x, tray.tab.y) < 32) {
    tray.open = tray.open ? 0 : 1;
    G.audio.pop();
    return;
  }
  // tray items -> spawn new object
  if (tray.t > 0.6) {
    for (let i = 0; i < tray.pts.length; i++) {
      if (G.dist(p.x, p.y, tray.pts[i].x, tray.pts[i].y) < 36) {
        if (G.state.objects.length >= 8) { G.audio.pat(); return; }
        const shape = G.shapes.list[i];
        const tp = toTex(p);
        const o = {
          id: shape.id,
          x: tp.x, y: tp.y,
          rot: G.rand(-0.5, 0.5),
          s: Math.min(sh.tw, sh.th) * 0.155 * shape.k,
          lift: 0, patAnim: 0, dragging: true
        };
        G.state.objects.push(o);
        drags[id] = { obj: o, isNew: true, t0: G.time, moved: true };
        return;
      }
    }
  }
  // placed objects (topmost first)
  const k = pr.w / sh.tw;
  for (let i = G.state.objects.length - 1; i >= 0; i--) {
    const o = G.state.objects[i];
    const pos = toScr(o.x, o.y);
    if (G.dist(p.x, p.y, pos.x, pos.y) < Math.max(30, o.s * k * 1.15)) {
      G.state.objects.splice(i, 1);
      G.state.objects.push(o);
      drags[id] = { obj: o, isNew: false, t0: G.time, moved: false, sx: p.x, sy: p.y };
      return;
    }
  }
};

S.move = function(id, p){
  const d = drags[id];
  if (!d) return;
  if (!d.moved && G.dist(p.x, p.y, d.sx, d.sy) > 9) d.moved = true;
  if (d.moved || d.isNew) {
    const tp = toTex(p);
    d.obj.x = tp.x; d.obj.y = tp.y;
    d.obj.dragging = true;
    sheet().maskDirty = true;
  }
};

S.up = function(id, p){
  if (sunPointer === id) {
    sunHeld = false; sunPointer = null;
    G.audio.sunStop();
    tray.open = 1;
  }
  const d = drags[id];
  if (!d) return;
  delete drags[id];
  const o = d.obj;
  o.dragging = false;
  const sh = sheet();

  // quick tap on a placed object = pat it flat (sharp edges)
  if (!d.isNew && !d.moved && G.time - d.t0 < 0.4) {
    o.lift = 0;
    o.patAnim = G.time;
    sh.maskDirty = true;
    G.audio.pat();
    addSparkles(p.x, p.y, 3, 12);
    return;
  }

  const onPaper = o.x > 0 && o.x < sh.tw && o.y > 0 && o.y < sh.th;
  if (onPaper) {
    if (d.isNew || d.moved) o.lift = G.rand(0.15, 0.5);
    sh.maskDirty = true;
    G.audio.pop();
  } else {
    const idx = G.state.objects.indexOf(o);
    if (idx >= 0) G.state.objects.splice(idx, 1);
    sh.maskDirty = true;
    G.audio.poof();
    addSparkles(p.x, p.y, 6, 18);
  }
};
})();
