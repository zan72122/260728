'use strict';
/* ==========================================================
   まぜまぜ！へんしんキッチン — core engine
   - single pointer input, gesture trackers
   - scene / step framework, particles, procedural drawing
   - WebAudio synthesized sounds (no assets)
   ========================================================== */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const wrapA = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const n1 = s => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function hexc(c) {
  if (c[0] === '#') { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  const m = c.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
}
function mixc(c1, c2, t) {
  t = clamp(t, 0, 1);
  const a = hexc(c1), b = hexc(c2);
  return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
}
function ramp(stops, t) {
  t = clamp(t, 0, 1);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      return mixc(c0, c1, (t - t0) / ((t1 - t0) || 1));
    }
  }
  return stops[stops.length - 1][1];
}
/* baking color: raw dough -> golden -> deep brown */
const BAKE = [[0, '#f9e9bd'], [0.3, '#f5cf82'], [0.55, '#e0a052'], [0.78, '#a9642c'], [1, '#5f3517']];
const bakeColor = t => ramp(BAKE, t);
const CARAMEL = [[0, '#fdf6e3'], [0.2, '#f6d98d'], [0.45, '#eaa93f'], [0.7, '#b85f14'], [1, '#571f06']];
const caramelColor = t => ramp(CARAMEL, t);

/* ---------------- registry ---------------- */
const DISHES = [];

/* ---------------- App ---------------- */
const App = {
  canvas: null, ctx: null, W: 0, H: 0, S: 1, time: 0,
  scene: null, nextScene: null, fadeT: 0,
  pointer: { down: false, id: null, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, downX: 0, downY: 0, downT: 0, moved: 0, lastT: 0 },

  init() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    const rs = () => this.resize();
    window.addEventListener('resize', rs);
    window.addEventListener('orientationchange', rs);
    this.resize();

    const P = this.pointer;
    const pos = e => ({ x: e.clientX, y: e.clientY });
    this.canvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      Snd.ensure();
      if (P.down) return;
      const { x, y } = pos(e);
      P.down = true; P.id = e.pointerId;
      P.x = P.px = P.downX = x; P.y = P.py = P.downY = y;
      P.vx = P.vy = 0; P.moved = 0; P.downT = performance.now(); P.lastT = performance.now();
      if (this.scene && this.scene.onDown) this.scene.onDown(P);
    }, { passive: false });
    window.addEventListener('pointermove', e => {
      if (!P.down || e.pointerId !== P.id) return;
      const { x, y } = pos(e);
      const now = performance.now();
      const dt = Math.max((now - P.lastT) / 1000, 0.001);
      P.px = P.x; P.py = P.y;
      P.moved += dist(P.x, P.y, x, y);
      P.vx = lerp(P.vx, (x - P.x) / dt, 0.45);
      P.vy = lerp(P.vy, (y - P.y) / dt, 0.45);
      P.x = x; P.y = y; P.lastT = now;
      if (this.scene && this.scene.onMove) this.scene.onMove(P);
    });
    const up = e => {
      if (!P.down || (e.pointerId !== undefined && e.pointerId !== P.id)) return;
      P.down = false;
      const tap = P.moved < 14 * this.S && (performance.now() - P.downT) < 450;
      if (this.scene && this.scene.onUp) this.scene.onUp(P, tap);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    document.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    document.addEventListener('gesturestart', e => e.preventDefault());

    let last = performance.now();
    const loop = now => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      this.time += dt;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.S = Math.min(this.W, this.H) / 760;
  },

  setScene(s) {
    Snd.setSizzle(0);
    if (!this.scene) { this.scene = s; return; }
    this.nextScene = s;
  },

  frame(dt) {
    if (this.nextScene) {
      this.fadeT += dt * 3.2;
      if (this.fadeT >= 1) { this.scene = this.nextScene; this.nextScene = null; }
    } else if (this.fadeT > 0) {
      this.fadeT = Math.max(0, this.fadeT - dt * 3.2);
    }
    if (this.scene) {
      if (this.scene.update) this.scene.update(dt);
      this.scene.draw(this.ctx);
    }
    if (this.fadeT > 0) {
      this.ctx.fillStyle = `rgba(255,250,240,${clamp(this.fadeT, 0, 1)})`;
      this.ctx.fillRect(0, 0, this.W, this.H);
    }
  }
};

/* ---------------- sound ---------------- */
const Snd = {
  c: null, master: null, sizz: null, sizzGain: null, _nb: null,
  ensure() {
    if (!this.c) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.c = new AC();
        this.master = this.c.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.c.destination);
      } catch (e) { /* no audio */ }
    }
    if (this.c && this.c.state === 'suspended') this.c.resume();
  },
  blip(f = 440, dur = 0.12, type = 'sine', vol = 0.15, f2) {
    if (!this.c || !this.master) return;
    try {
      const t = this.c.currentTime;
      const o = this.c.createOscillator(), g = this.c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.03);
    } catch (e) { }
  },
  pop() { this.blip(rnd(480, 700), 0.09, 'sine', 0.18, rnd(900, 1300)); },
  plop() { this.blip(rnd(250, 330), 0.16, 'sine', 0.2, 110); },
  tick() { this.blip(900, 0.05, 'triangle', 0.07); },
  knead() { this.blip(rnd(160, 230), 0.13, 'triangle', 0.1, 85); },
  splash() { this.blip(rnd(600, 900), 0.14, 'sine', 0.1, 250); this.blip(rnd(300, 420), 0.2, 'sine', 0.08, 150); },
  crunch() { this.blip(rnd(140, 200), 0.06, 'square', 0.1); this.blip(rnd(500, 800), 0.05, 'square', 0.06); },
  whoosh() { this.blip(220, 0.28, 'sine', 0.1, 620); },
  chime() { [660, 880, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.26, 'sine', 0.13), i * 90)); },
  tada() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.32, 'triangle', 0.13), i * 130)); },
  gulp() { this.blip(300, 0.18, 'sine', 0.15, 90); setTimeout(() => this.blip(200, 0.14, 'sine', 0.12, 320), 140); },
  noise() {
    if (!this._nb && this.c) {
      const len = this.c.sampleRate;
      const b = this.c.createBuffer(1, len, this.c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._nb = b;
    }
    return this._nb;
  },
  setSizzle(v) {
    if (!this.c || !this.master) return;
    try {
      if (!this.sizz && v > 0) {
        const s = this.c.createBufferSource();
        s.buffer = this.noise(); s.loop = true;
        const f = this.c.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = 5000; f.Q.value = 0.5;
        const g = this.c.createGain(); g.gain.value = 0;
        s.connect(f); f.connect(g); g.connect(this.master);
        s.start();
        this.sizz = s; this.sizzGain = g;
      }
      if (this.sizzGain) this.sizzGain.gain.linearRampToValueAtTime(clamp(v, 0, 0.22), this.c.currentTime + 0.15);
    } catch (e) { }
  }
};

/* ---------------- particles ---------------- */
class Particles {
  constructor() { this.l = []; }
  add(o) {
    this.l.push(Object.assign({
      age: 0, life: 1, x: 0, y: 0, vx: 0, vy: 0, g: 0, r: 6, color: '#fff',
      alpha: 1, grow: 0, kind: 'dot', rot: rnd(TAU), vr: 0
    }, o));
    if (this.l.length > 400) this.l.splice(0, this.l.length - 400);
  }
  update(dt) {
    for (const p of this.l) {
      p.age += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.r = Math.max(0.1, p.r + p.grow * dt);
      p.rot += p.vr * dt;
    }
    this.l = this.l.filter(p => p.age < p.life);
  }
  draw(ctx) {
    for (const p of this.l) {
      const k = 1 - p.age / p.life;
      ctx.save();
      ctx.globalAlpha = clamp(p.alpha * k, 0, 1);
      ctx.fillStyle = p.color;
      if (p.kind === 'dot' || p.kind === 'steam') {
        if (p.kind === 'steam') ctx.globalAlpha = clamp(p.alpha * k * 0.6, 0, 1);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      } else if (p.kind === 'spark') {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        starPath(ctx, 0, 0, p.r, 4, 0.42); ctx.fill();
      } else if (p.kind === 'confetti') {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2);
      } else if (p.kind === 'ring') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 3 * App.S;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
  }
}

/* ---------------- gesture trackers ---------------- */
class Stir {
  constructor() { this.pa = null; this.speed = 0; this.revs = 0; }
  /* returns smoothed angular speed (rad/s) while pointer circles (cx,cy) */
  feed(p, cx, cy, rmax, dt) {
    let sp = 0;
    if (p.down && dist(p.x, p.y, cx, cy) < rmax && dist(p.x, p.y, cx, cy) > 8 * App.S) {
      const a = Math.atan2(p.y - cy, p.x - cx);
      if (this.pa !== null) {
        const da = wrapA(a - this.pa);
        sp = Math.abs(da) / Math.max(dt, 0.001);
        this.revs += Math.abs(da) / TAU;
      }
      this.pa = a;
    } else this.pa = null;
    this.speed = lerp(this.speed, Math.min(sp, 40), 0.12);
    return this.speed;
  }
}

class Spring {
  constructor() { this.x = 0; this.v = 0; }
  kick(a) { this.v += a; }
  update(dt, k = 90, d = 7) {
    this.v += (-k * this.x - d * this.v) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

/* ---------------- drawing helpers ---------------- */
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function circle(ctx, x, y, r, color) {
  if (color) ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}
function ell(ctx, x, y, rx, ry, color) {
  if (color) ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
}
function starPath(ctx, x, y, r, n = 5, inner = 0.5) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = i / (n * 2) * TAU - Math.PI / 2;
    const rr2 = i % 2 === 0 ? r : r * inner;
    const px = x + Math.cos(a) * rr2, py = y + Math.sin(a) * rr2;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}
function heartPath(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.85);
  ctx.bezierCurveTo(x - r * 1.35, y - r * 0.15, x - r * 0.7, y - r * 1.05, x, y - r * 0.4);
  ctx.bezierCurveTo(x + r * 0.7, y - r * 1.05, x + r * 1.35, y - r * 0.15, x, y + r * 0.85);
  ctx.closePath();
}
function flowerPath(ctx, x, y, r) {
  ctx.beginPath();
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const a = i / N * TAU;
    const rr2 = r * (0.82 + 0.18 * Math.cos(a * 6));
    const px = x + Math.cos(a) * rr2, py = y + Math.sin(a) * rr2;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}
function blobPath(ctx, x, y, r, irr = 0.1, seed = 0) {
  ctx.beginPath();
  const N = 26;
  for (let i = 0; i <= N; i++) {
    const a = i / N * TAU;
    const w = Math.sin(a * 5 + seed) * 0.55 + Math.sin(a * 3 + seed * 2.7) * 0.45;
    const rr2 = r * (1 + irr * w);
    const px = x + Math.cos(a) * rr2, py = y + Math.sin(a) * rr2;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

/* pointing hand pictogram (for hints) */
function drawHand(ctx, x, y, s, ang = 0) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = '#ffd9b8';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3.5 * s;
  rr(ctx, -15 * s, -4 * s, 30 * s, 30 * s, 13 * s); ctx.fill(); ctx.stroke();
  rr(ctx, -6 * s, -34 * s, 12 * s, 36 * s, 6 * s); ctx.fill(); ctx.stroke();
  ctx.restore();
}

/* animated gesture hint */
function drawHint(ctx, type, x, y, opt = {}) {
  const S = App.S, t = App.time;
  const a = 0.55 + 0.25 * Math.sin(t * 3);
  ctx.save();
  ctx.globalAlpha = a;
  if (type === 'stir') {
    const R = (opt.r || 74) * S;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 5 * S; ctx.setLineDash([12 * S, 10 * S]);
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    const ha = t * 2.6;
    drawHand(ctx, x + Math.cos(ha) * R, y + Math.sin(ha) * R, S);
  } else if (type === 'rub') {
    const o = Math.sin(t * 4) * 55 * S;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 5 * S; ctx.setLineDash([10 * S, 9 * S]);
    ctx.beginPath(); ctx.moveTo(x - 65 * S, y); ctx.lineTo(x + 65 * S, y); ctx.stroke(); ctx.setLineDash([]);
    drawHand(ctx, x + o, y + 8 * S, S);
  } else if (type === 'tap') {
    const k = Math.abs(Math.sin(t * 4));
    drawHand(ctx, x, y - 8 * S - k * 26 * S, S);
    if (k < 0.35) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 4 * S;
      ctx.beginPath(); ctx.arc(x, y + 16 * S, (16 + (1 - k) * 14) * S, 0, TAU); ctx.stroke();
    }
  } else if (type === 'hold') {
    drawHand(ctx, x, y, S);
    const k = (t * 0.9) % 1;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 5 * S;
    ctx.globalAlpha = a * (1 - k);
    ctx.beginPath(); ctx.arc(x, y - 8 * S, (22 + k * 34) * S, 0, TAU); ctx.stroke();
  } else if (type === 'drag') {
    const dx = (opt.dx !== undefined ? opt.dx : 1), dy = (opt.dy || 0);
    const len = 95 * S, k = (t * 0.8) % 1;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 6 * S; ctx.setLineDash([12 * S, 10 * S]);
    ctx.beginPath(); ctx.moveTo(x - dx * len / 2, y - dy * len / 2); ctx.lineTo(x + dx * len / 2, y + dy * len / 2); ctx.stroke();
    ctx.setLineDash([]);
    drawHand(ctx, x + dx * len * (k - 0.5), y + dy * len * (k - 0.5) + 6 * S, S);
  } else if (type === 'flick') {
    const k = (t * 1.4) % 1;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 7 * S;
    ctx.beginPath();
    ctx.moveTo(x, y + 30 * S); ctx.lineTo(x, y - 42 * S);
    ctx.moveTo(x - 16 * S, y - 22 * S); ctx.lineTo(x, y - 42 * S); ctx.lineTo(x + 16 * S, y - 22 * S);
    ctx.stroke();
    drawHand(ctx, x + 4 * S, y + 40 * S - k * 70 * S, S);
  }
  ctx.restore();
}

/* ---------------- kitchen furniture ---------------- */
function drawKitchenBG(ctx, mode = 'counter') {
  const { W, H, S } = App;
  const wall = mode === 'chill' ? '#e3f2fb' : '#fdf1dc';
  ctx.fillStyle = wall; ctx.fillRect(0, 0, W, H);
  /* soft dots wallpaper */
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 14; i++) {
    const px = (n1(i * 3 + 1) * 1.2 - 0.1) * W, py = n1(i * 7 + 2) * H * 0.5;
    circle(ctx, px, py, (10 + n1(i) * 16) * S, mode === 'chill' ? '#cfe8f7' : '#fbe3c6');
  }
  ctx.globalAlpha = 1;
  /* counter */
  const cy = H * 0.62;
  ctx.fillStyle = mode === 'chill' ? '#bcd9ec' : '#e9b87d';
  ctx.fillRect(0, cy, W, H - cy);
  ctx.fillStyle = mode === 'chill' ? '#cfe5f4' : '#f2cd97';
  ctx.fillRect(0, cy, W, 14 * S);
  ctx.strokeStyle = 'rgba(120,70,20,0.12)';
  ctx.lineWidth = 2 * S;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(0, cy + (H - cy) * i / 4); ctx.lineTo(W, cy + (H - cy) * i / 4); ctx.stroke();
  }
}

function drawBowl(ctx, x, y, r, color = '#8ecbe8') {
  /* bowl seen slightly from above; content should be drawn after with bowlClip */
  ell(ctx, x, y + r * 0.18, r * 1.04, r * 0.8, mixc(color, '#000000', 0.18));
  ell(ctx, x, y + r * 0.13, r, r * 0.76, color);
  ell(ctx, x, y, r * 0.88, r * 0.6, mixc(color, '#000000', 0.28));
}
function bowlInner(x, y, r) { return { x, y, rx: r * 0.84, ry: r * 0.56 }; }
function bowlClip(ctx, x, y, r) {
  const b = bowlInner(x, y, r);
  ctx.beginPath(); ctx.ellipse(b.x, b.y, b.rx, b.ry, 0, 0, TAU); ctx.clip();
}

function drawStoveTop(ctx, x, y, r) {
  ell(ctx, x, y, r * 1.35, r * 1.0, '#d7d2c8');
  ell(ctx, x, y, r * 1.22, r * 0.9, '#4a4a52');
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + App.time * 0.4;
    ell(ctx, x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.44, r * 0.1, r * 0.07, '#e88f45');
  }
}
function drawPan(ctx, x, y, r) {
  ell(ctx, x, y, r * 1.06, r * 0.82, '#33333b');
  ell(ctx, x, y - r * 0.02, r, r * 0.76, '#4c4c56');
  ell(ctx, x, y, r * 0.9, r * 0.66, '#5f5f6b');
  ctx.fillStyle = '#33333b';
  rr(ctx, x + r * 0.96, y - 12 * App.S, r * 0.75, 24 * App.S, 12 * App.S); ctx.fill();
  return { x, y, rx: r * 0.88, ry: r * 0.64 };
}

function drawOven(ctx, x, y, w, h, openT, drawInner) {
  const S = App.S;
  ctx.fillStyle = '#e88a68';
  rr(ctx, x - w / 2, y - h / 2, w, h, 26 * S); ctx.fill();
  ctx.fillStyle = '#f7b394';
  rr(ctx, x - w / 2, y - h / 2, w, h * 0.16, 26 * S); ctx.fill();
  circle(ctx, x - w * 0.32, y - h * 0.42, 8 * S, '#fff2e3');
  circle(ctx, x - w * 0.18, y - h * 0.42, 8 * S, '#fff2e3');
  /* window */
  const wx = x - w * 0.38, wy = y - h * 0.26, ww = w * 0.76, wh = h * 0.62;
  ctx.save();
  rr(ctx, wx, wy, ww, wh, 18 * S); ctx.clip();
  const g = ctx.createLinearGradient(0, wy, 0, wy + wh);
  g.addColorStop(0, '#3a2417'); g.addColorStop(1, '#6b3d1c');
  ctx.fillStyle = g; ctx.fillRect(wx, wy, ww, wh);
  /* warm glow */
  const gl = ctx.createRadialGradient(x, wy + wh, wh * 0.1, x, wy + wh, wh * 1.1);
  gl.addColorStop(0, 'rgba(255,160,60,0.55)'); gl.addColorStop(1, 'rgba(255,160,60,0)');
  ctx.fillStyle = gl; ctx.fillRect(wx, wy, ww, wh);
  if (drawInner) drawInner(wx + ww / 2, wy + wh * 0.72, ww, wh);
  /* glass shine */
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(wx + ww * 0.1, wy + wh); ctx.lineTo(wx + ww * 0.4, wy); ctx.lineTo(wx + ww * 0.58, wy); ctx.lineTo(wx + ww * 0.28, wy + wh); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.strokeStyle = '#c9633f'; ctx.lineWidth = 6 * S;
  rr(ctx, wx, wy, ww, wh, 18 * S); ctx.stroke();
  /* handle */
  ctx.fillStyle = '#c9633f';
  rr(ctx, wx + ww * 0.1, wy - 16 * S, ww * 0.8, 10 * S, 5 * S); ctx.fill();
}

function drawPitcher(ctx, x, y, s, tilt, color = '#fefefe', liquid = '#fdfdf6') {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(tilt);
  ctx.fillStyle = color;
  rr(ctx, -30 * s, -40 * s, 60 * s, 78 * s, 14 * s); ctx.fill();
  ctx.fillStyle = mixc(color, '#88aacc', 0.25);
  rr(ctx, -30 * s, -40 * s, 60 * s, 16 * s, 8 * s); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-30 * s, -36 * s); ctx.lineTo(-48 * s, -28 * s); ctx.lineTo(-30 * s, -16 * s);
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  ctx.fillStyle = liquid;
  rr(ctx, -22 * s, -18 * s, 44 * s, 48 * s, 10 * s); ctx.fill();
  ctx.strokeStyle = mixc(color, '#557799', 0.35); ctx.lineWidth = 4 * s;
  ctx.beginPath(); ctx.arc(38 * s, 0, 26 * s, -1.2, 1.2); ctx.stroke();
  ctx.restore();
}

/* liquid stream from (x0,y0) to (x1,y1) */
function drawStream(ctx, x0, y0, x1, y1, w, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.15, y0 + (y1 - y0) * 0.6, x1, y1);
  ctx.stroke();
}

function drawWhisk(ctx, x, y, s, ang = 0) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = '#e88aa8';
  rr(ctx, -7 * s, -78 * s, 14 * s, 42 * s, 7 * s); ctx.fill();
  ctx.strokeStyle = '#c8ccd8'; ctx.lineWidth = 3.4 * s;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(0, -38 * s);
    ctx.quadraticCurveTo(i * 13 * s, -6 * s, 0, 16 * s);
    ctx.stroke();
  }
  ctx.restore();
}
function drawSpoon(ctx, x, y, s, ang = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = '#e8b04f';
  rr(ctx, -6 * s, -80 * s, 12 * s, 62 * s, 6 * s); ctx.fill();
  ell(ctx, 0, 0, 20 * s, 26 * s, '#f2c26b');
  ell(ctx, 0, -2 * s, 13 * s, 18 * s, '#d89a3e');
  ctx.restore();
}
function drawLadle(ctx, x, y, s) {
  ctx.fillStyle = '#c8ccd8';
  rr(ctx, x - 5 * s, y - 90 * s, 10 * s, 70 * s, 5 * s); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, 26 * s, -0.15, Math.PI + 0.15); ctx.closePath();
  ctx.fillStyle = '#aab0c0'; ctx.fill();
}
function drawMasher(ctx, x, y, s) {
  ctx.fillStyle = '#e88aa8';
  rr(ctx, x - 7 * s, y - 92 * s, 14 * s, 58 * s, 7 * s); ctx.fill();
  ctx.fillStyle = '#c8ccd8';
  rr(ctx, x - 30 * s, y - 36 * s, 60 * s, 34 * s, 10 * s); ctx.fill();
  ctx.strokeStyle = '#9aa2b5'; ctx.lineWidth = 4 * s;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath(); ctx.moveTo(x + i * 16 * s, y - 32 * s); ctx.lineTo(x + i * 16 * s, y - 8 * s); ctx.stroke();
  }
}
function drawRollingPin(ctx, x, y, s) {
  ctx.fillStyle = '#d9a468';
  rr(ctx, x - 95 * s, y - 20 * s, 190 * s, 40 * s, 20 * s); ctx.fill();
  ctx.fillStyle = '#b9834a';
  rr(ctx, x - 130 * s, y - 9 * s, 38 * s, 18 * s, 9 * s); ctx.fill();
  rr(ctx, x + 92 * s, y - 9 * s, 38 * s, 18 * s, 9 * s); ctx.fill();
  ctx.globalAlpha = 0.25; ctx.fillStyle = '#fff';
  rr(ctx, x - 95 * s, y - 16 * s, 190 * s, 9 * s, 5 * s); ctx.fill();
  ctx.globalAlpha = 1;
}

function drawEggItem(ctx, x, y, s, crack = 0) {
  ell(ctx, x, y, 26 * s, 33 * s, '#faeed6');
  ell(ctx, x - 8 * s, y - 10 * s, 8 * s, 11 * s, 'rgba(255,255,255,0.75)');
  if (crack > 0) {
    ctx.strokeStyle = '#c9a86a'; ctx.lineWidth = 2.5 * s;
    ctx.beginPath();
    ctx.moveTo(x - 18 * s, y - 4 * s);
    for (let i = 0; i < 2 + crack * 2; i++) {
      ctx.lineTo(x - 14 * s + i * 9 * s, y + (i % 2 ? -9 : 2) * s);
    }
    ctx.stroke();
  }
}
function drawStrawberry(ctx, x, y, s) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#e8465c';
  ctx.beginPath();
  ctx.moveTo(0, 22 * s);
  ctx.bezierCurveTo(-24 * s, 8 * s, -20 * s, -16 * s, 0, -14 * s);
  ctx.bezierCurveTo(20 * s, -16 * s, 24 * s, 8 * s, 0, 22 * s);
  ctx.fill();
  ctx.fillStyle = '#7cc25e';
  for (let i = -1; i <= 1; i++) {
    ell(ctx, i * 9 * s, -15 * s, 6 * s, 9 * s);
  }
  ctx.fillStyle = '#ffdfe6';
  for (let i = 0; i < 6; i++) {
    ell(ctx, (n1(i * 5) - 0.5) * 26 * s, (n1(i * 9 + 3) - 0.3) * 22 * s, 1.7 * s, 2.6 * s);
  }
  ctx.restore();
}
function drawButterCube(ctx, x, y, s, melt = 0) {
  const h = lerp(34, 12, melt) * s, w = lerp(40, 52, melt) * s;
  ctx.fillStyle = '#f7d878';
  rr(ctx, x - w / 2, y - h / 2, w, h, 7 * s); ctx.fill();
  ctx.fillStyle = '#fbe9a8';
  rr(ctx, x - w / 2, y - h / 2, w, h * 0.4, 7 * s); ctx.fill();
}
function drawPlate(ctx, x, y, r) {
  ell(ctx, x, y + 6 * App.S, r * 1.03, r * 0.66, 'rgba(90,60,20,0.15)');
  ell(ctx, x, y, r, r * 0.62, '#ffffff');
  ell(ctx, x, y, r * 0.8, r * 0.48, '#f2f0ec');
}

/* ---------------- effects ---------------- */
function sparkleBurst(parts, x, y, color = '#ffd94f', n = 8) {
  for (let i = 0; i < n; i++) {
    const a = rnd(TAU);
    parts.add({
      x, y, kind: 'spark', color,
      vx: Math.cos(a) * rnd(40, 160) * App.S, vy: Math.sin(a) * rnd(40, 160) * App.S,
      r: rnd(4, 9) * App.S, life: rnd(0.4, 0.8), g: 60 * App.S
    });
  }
}
function confettiBurst(parts) {
  const cols = ['#ff8fb2', '#ffd94f', '#8ecbe8', '#9fd98a', '#c9a2e8'];
  for (let i = 0; i < 60; i++) {
    parts.add({
      x: rnd(App.W), y: rnd(-App.H * 0.3, 0), kind: 'confetti',
      color: cols[i % cols.length],
      vx: rnd(-40, 40) * App.S, vy: rnd(80, 220) * App.S,
      r: rnd(4, 8) * App.S, life: rnd(1.6, 2.8), vr: rnd(-6, 6)
    });
  }
}
function steamPuff(parts, x, y, n = 1) {
  for (let i = 0; i < n; i++) {
    parts.add({
      x: x + rnd(-14, 14) * App.S, y, kind: 'steam', color: '#ffffff',
      vy: -rnd(50, 90) * App.S, vx: rnd(-12, 12) * App.S,
      r: rnd(8, 14) * App.S, grow: 18 * App.S, life: rnd(0.9, 1.5), alpha: 0.8
    });
  }
}

/* ---------------- shared UI ---------------- */
function homeBtnPos() { return { x: 54 * App.S, y: 54 * App.S, r: 34 * App.S }; }
function arrowBtnPos() { return { x: App.W - 76 * App.S, y: App.H - 76 * App.S, r: 52 * App.S }; }
function hitCircle(p, c) { return dist(p.x, p.y, c.x, c.y) < c.r * 1.25; }

function drawHomeBtn(ctx) {
  const b = homeBtnPos(), S = App.S;
  ctx.globalAlpha = 0.92;
  circle(ctx, b.x, b.y, b.r, '#ffffff');
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ff8fb2';
  ctx.beginPath();
  ctx.moveTo(b.x, b.y - 17 * S);
  ctx.lineTo(b.x + 17 * S, b.y - 1 * S);
  ctx.lineTo(b.x - 17 * S, b.y - 1 * S);
  ctx.closePath(); ctx.fill();
  rr(ctx, b.x - 11 * S, b.y - 2 * S, 22 * S, 15 * S, 4 * S); ctx.fill();
}
function drawArrowBtn(ctx) {
  const b = arrowBtnPos(), S = App.S;
  const k = 1 + 0.07 * Math.sin(App.time * 5);
  ctx.save();
  ctx.translate(b.x, b.y); ctx.scale(k, k);
  circle(ctx, 0, 4 * S, b.r, 'rgba(180,90,40,0.25)');
  circle(ctx, 0, 0, b.r, '#ff8fb2');
  circle(ctx, 0, -b.r * 0.25, b.r * 0.86, '#ffa8c4');
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(-13 * S, -20 * S); ctx.lineTo(19 * S, 0); ctx.lineTo(-13 * S, 20 * S);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* end-of-dish buttons: replay + home */
function endBtns() {
  const S = App.S;
  return {
    replay: { x: App.W / 2 - 70 * S, y: App.H - 84 * S, r: 44 * S },
    home: { x: App.W / 2 + 70 * S, y: App.H - 84 * S, r: 44 * S }
  };
}
function drawEndBtns(ctx) {
  const { replay, home } = endBtns(), S = App.S;
  circle(ctx, replay.x, replay.y + 4 * S, replay.r, 'rgba(180,90,40,0.2)');
  circle(ctx, replay.x, replay.y, replay.r, '#9fd98a');
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 7 * S;
  ctx.beginPath(); ctx.arc(replay.x, replay.y, 19 * S, 0.6, TAU - 0.7); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.save();
  ctx.translate(replay.x + Math.cos(0.6) * 19 * S, replay.y + Math.sin(0.6) * 19 * S);
  ctx.rotate(0.6 + Math.PI / 2);
  ctx.beginPath(); ctx.moveTo(-9 * S, 0); ctx.lineTo(9 * S, 0); ctx.lineTo(0, 13 * S); ctx.closePath(); ctx.fill();
  ctx.restore();
  circle(ctx, home.x, home.y + 4 * S, home.r, 'rgba(180,90,40,0.2)');
  circle(ctx, home.x, home.y, home.r, '#8ecbe8');
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(home.x, home.y - 18 * S);
  ctx.lineTo(home.x + 18 * S, home.y - 1 * S);
  ctx.lineTo(home.x - 18 * S, home.y - 1 * S);
  ctx.closePath(); ctx.fill();
  rr(ctx, home.x - 12 * S, home.y - 2 * S, 24 * S, 16 * S, 4 * S); ctx.fill();
}
/* returns true if a button consumed the tap */
function handleEndBtns(sc, p) {
  const { replay, home } = endBtns();
  if (hitCircle(p, replay)) { Snd.pop(); App.setScene(new DishScene(sc.def)); return true; }
  if (hitCircle(p, home)) { Snd.pop(); App.setScene(new Home()); return true; }
  return false;
}

/* ---------------- dish scene framework ---------------- */
class DishScene {
  constructor(def) {
    this.def = def;
    this.food = {};
    this.parts = new Particles();
    this.stepI = 0;
    this.steps = def.steps(this);
    this.step = this.steps[0];
    this.wipe = 0;
    this.lastAct = App.time;
    if (this.step.enter) this.step.enter();
  }
  act() { this.lastAct = App.time; }
  next() {
    Snd.setSizzle(0);
    if (this.stepI < this.steps.length - 1) {
      this.stepI++;
      this.step = this.steps[this.stepI];
      this.wipe = 1;
      this.lastAct = App.time;
      Snd.whoosh();
      if (this.step.enter) this.step.enter();
    }
  }
  update(dt) {
    this.wipe = Math.max(0, this.wipe - dt * 2.4);
    if (this.step.update) this.step.update(dt);
    this.parts.update(dt);
  }
  draw(ctx) {
    drawKitchenBG(ctx, this.step.bgMode || 'counter');
    this.step.draw(ctx);
    this.parts.draw(ctx);
    const isDone = this.step.done && this.step.done();
    if (this.step.hint && App.time - this.lastAct > 2.2 && !isDone) {
      const at = this.step.hintAt ? this.step.hintAt() : { x: App.W / 2, y: App.H * 0.5 };
      drawHint(ctx, this.step.hint, at.x, at.y, this.step.hintOpt || {});
    }
    if (isDone) drawArrowBtn(ctx);
    drawHomeBtn(ctx);
    if (this.wipe > 0) {
      ctx.fillStyle = `rgba(255,250,240,${this.wipe})`;
      ctx.fillRect(0, 0, App.W, App.H);
    }
  }
  onDown(p) {
    if (hitCircle(p, homeBtnPos())) { Snd.pop(); App.setScene(new Home()); return; }
    if (this.step.done && this.step.done() && hitCircle(p, arrowBtnPos())) { this.next(); return; }
    this.act();
    if (this.step.down) this.step.down(p);
  }
  onMove(p) { this.act(); if (this.step.move) this.step.move(p); }
  onUp(p, tap) { if (this.step.up) this.step.up(p, tap); }
}

/* ---------------- home scene ---------------- */
class Home {
  constructor() { this.t = 0; this.pressI = -1; this.pressT = 0; }
  tiles() {
    const { W, H, S } = App;
    const portrait = H > W;
    const cols = portrait ? 2 : 3, rows = portrait ? 3 : 2;
    const top = H * (portrait ? 0.2 : 0.26), bottom = H * 0.96;
    const list = [];
    const cw = W / cols, ch = (bottom - top) / rows;
    const r = Math.min(cw, ch) * 0.36;
    for (let i = 0; i < DISHES.length; i++) {
      const cx = cw * (i % cols) + cw / 2;
      const cy = top + ch * Math.floor(i / cols) + ch / 2;
      list.push({ x: cx, y: cy, r, def: DISHES[i] });
    }
    return list;
  }
  update(dt) {
    this.t += dt;
    if (this.pressI >= 0) {
      this.pressT += dt;
      if (this.pressT > 0.18) {
        const d = DISHES[this.pressI];
        this.pressI = -1;
        App.setScene(new DishScene(d));
      }
    }
  }
  draw(ctx) {
    const { W, H, S } = App;
    drawKitchenBG(ctx);
    /* title */
    const ty = H * (H > W ? 0.1 : 0.13);
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const fs = Math.min(W / 11, 64 * S);
    ctx.font = `bold ${fs}px 'Hiragino Maru Gothic ProN','ヒラギノ丸ゴ ProN','Zen Maru Gothic',system-ui,sans-serif`;
    ctx.lineWidth = fs * 0.28; ctx.strokeStyle = '#fff'; ctx.lineJoin = 'round';
    const wob = Math.sin(this.t * 2) * 0.02;
    ctx.translate(W / 2, ty); ctx.rotate(wob);
    ctx.strokeText('まぜまぜ！', 0, -fs * 0.62);
    ctx.strokeText('へんしんキッチン', 0, fs * 0.62);
    ctx.fillStyle = '#ff8fb2';
    ctx.fillText('まぜまぜ！', 0, -fs * 0.62);
    ctx.fillStyle = '#e8a13f';
    ctx.fillText('へんしんキッチン', 0, fs * 0.62);
    ctx.restore();
    /* sparkles around title */
    for (let i = 0; i < 5; i++) {
      const a = this.t * 0.8 + i * TAU / 5;
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(this.t * 3 + i * 2);
      ctx.fillStyle = '#ffd94f';
      starPath(ctx, W / 2 + Math.cos(a) * W * 0.34, ty + Math.sin(a * 1.3) * 40 * S, 8 * S, 4, 0.45);
      ctx.fill();
      ctx.restore();
    }
    /* dish tiles */
    const tiles = this.tiles();
    tiles.forEach((tl, i) => {
      const press = this.pressI === i ? 1 - this.pressT * 3 : 1;
      const bob = 1 + 0.02 * Math.sin(this.t * 2 + i * 1.4);
      const rr2 = tl.r * bob * (this.pressI === i ? 0.9 : 1);
      ctx.save();
      circle(ctx, tl.x, tl.y + 6 * S, rr2 * 1.05, 'rgba(160,90,30,0.16)');
      circle(ctx, tl.x, tl.y, rr2 * 1.05, '#ffffff');
      circle(ctx, tl.x, tl.y, rr2 * 0.98, tl.def.color);
      ctx.translate(tl.x, tl.y);
      tl.def.icon(ctx, rr2 * 0.62);
      ctx.restore();
    });
  }
  onDown(p) {
    const tiles = this.tiles();
    for (let i = 0; i < tiles.length; i++) {
      if (dist(p.x, p.y, tiles[i].x, tiles[i].y) < tiles[i].r * 1.1) {
        this.pressI = i; this.pressT = 0;
        Snd.pop();
        return;
      }
    }
  }
}
