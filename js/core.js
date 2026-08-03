'use strict';
/* ==========================================================
   まぜまぜ！へんしんキッチン — core engine
   - single pointer input, gesture trackers
   - scene / step framework, particles, procedural drawing
   - "clay" material rendering: gradients + gloss + soft shadows
   - cached background & noise textures for 60fps
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
const easeOutBack = t => { const c = 1.70158; t = clamp(t, 0, 1) - 1; return 1 + (c + 1) * t * t * t + c * t * t; };

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
function rgba(c, a) { const v = hexc(c); return `rgba(${v[0]},${v[1]},${v[2]},${a})`; }
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

/* ---------------- cached textures ---------------- */
const Tex = {
  grain: null, pat: null,
  init(ctx) {
    const g = document.createElement('canvas');
    g.width = g.height = 192;
    const c = g.getContext('2d');
    const img = c.createImageData(192, 192);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 110 + Math.random() * 90;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 26;
    }
    c.putImageData(img, 0, 0);
    this.grain = g;
    try { this.pat = ctx.createPattern(g, 'repeat'); } catch (e) { }
  }
};
/* sprinkle grain inside an already-clipped region */
function grainRect(ctx, x, y, w, h, alpha = 0.5) {
  if (!Tex.pat) return;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = Tex.pat;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/* ---------------- App ---------------- */
const App = {
  canvas: null, ctx: null, W: 0, H: 0, S: 1, time: 0,
  scene: null, nextScene: null, fadeT: 0,
  fx: null, _glowT: 0,
  pointer: { down: false, id: null, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, downX: 0, downY: 0, downT: 0, moved: 0, lastT: 0 },

  init() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.fx = new Particles();
    Tex.init(this.ctx);
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
    /* warm sparkle trail under the finger — everywhere */
    if (this.pointer.down) {
      this._glowT -= dt;
      if (this._glowT <= 0) {
        this._glowT = 0.05;
        this.fx.add({
          x: this.pointer.x + rnd(-8, 8) * this.S, y: this.pointer.y + rnd(-8, 8) * this.S,
          kind: 'glow', color: '#ffca4f', r: rnd(9, 16) * this.S,
          vy: -rnd(15, 40) * this.S, vx: rnd(-14, 14) * this.S,
          life: rnd(0.35, 0.55), alpha: 0.5
        });
      }
    }
    this.fx.update(dt);
    this.fx.draw(this.ctx);
    Ouch.draw(this.ctx);
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
  ouch() { this.blip(1250, 0.07, 'square', 0.11, 850); setTimeout(() => this.blip(1500, 0.09, 'square', 0.09, 1050), 80); },
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
      alpha: 1, grow: 0, kind: 'dot', rot: rnd(TAU), vr: 0, wob: 0, seed: rnd(10)
    }, o));
    if (this.l.length > 420) this.l.splice(0, this.l.length - 420);
  }
  update(dt) {
    for (const p of this.l) {
      p.age += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.wob) p.x += Math.sin(p.age * 4 + p.seed * 7) * p.wob * dt;
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
      if (p.kind === 'dot') {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      } else if (p.kind === 'steam') {
        /* soft layered puff */
        ctx.globalAlpha = clamp(p.alpha * k * 0.35, 0, 1);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(p.x - p.r * 0.45, p.y + p.r * 0.25, p.r * 0.7, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(p.x + p.r * 0.45, p.y + p.r * 0.2, p.r * 0.62, 0, TAU); ctx.fill();
      } else if (p.kind === 'glow') {
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, rgba(p.color, clamp(0.5 * p.alpha * k, 0, 1)));
        g.addColorStop(1, rgba(p.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      } else if (p.kind === 'spark') {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        starPath(ctx, 0, 0, p.r, 4, 0.42); ctx.fill();
        ctx.globalAlpha = clamp(p.alpha * k * 0.6, 0, 1);
        ctx.fillStyle = '#ffffff';
        starPath(ctx, 0, 0, p.r * 0.45, 4, 0.42); ctx.fill();
      } else if (p.kind === 'flour') {
        ctx.globalAlpha = clamp(p.alpha * k * (0.5 + 0.5 * Math.sin(p.age * 12 + p.seed * 9)), 0, 1);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      } else if (p.kind === 'confetti') {
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        const sq = 0.4 + 0.6 * Math.abs(Math.sin(p.age * 6 + p.seed));
        ctx.fillRect(-p.r, -p.r * 0.6 * sq, p.r * 2, p.r * 1.2 * sq);
      } else if (p.kind === 'ring') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 3 * App.S * k;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
  }
}

/* ---------------- gesture trackers ---------------- */
class Stir {
  constructor() { this.pa = null; this.speed = 0; this.revs = 0; }
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

/* ---------------- path helpers ---------------- */
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
/* oblique (2.5D) blob: same shape squashed vertically by ysc */
function blobPathO(ctx, x, y, r, irr = 0.1, seed = 0, ysc = 0.74) {
  ctx.beginPath();
  const N = 26;
  for (let i = 0; i <= N; i++) {
    const a = i / N * TAU;
    const w = Math.sin(a * 5 + seed) * 0.55 + Math.sin(a * 3 + seed * 2.7) * 0.45;
    const rr2 = r * (1 + irr * w);
    const px = x + Math.cos(a) * rr2, py = y + Math.sin(a) * rr2 * ysc;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}
/* extruded oblique blob: visible side wall + top. topDraw(makeTopPath) paints the top */
function extrudeBlob(ctx, x, y, r, irr, seed, ysc, h, sideTop, sideBot, topDraw) {
  const steps = Math.max(3, Math.round(h / (4 * App.S)));
  for (let i = steps; i >= 1; i--) {
    const t = i / steps;
    blobPathO(ctx, x, y + h * t, r, irr, seed, ysc);
    ctx.fillStyle = mixc(sideTop, sideBot, t);
    ctx.fill();
  }
  topDraw(() => blobPathO(ctx, x, y, r, irr, seed, ysc));
}

/* ---------------- clay material ---------------- */
/* soft blurred drop shadow (fake blur with radial gradient) */
function softShadow(ctx, x, y, rx, ry, a = 0.22) {
  const g = ctx.createRadialGradient(0, 0, rx * 0.1, 0, 0, rx);
  g.addColorStop(0, `rgba(120,62,20,${a})`);
  g.addColorStop(0.65, `rgba(120,62,20,${a * 0.55})`);
  g.addColorStop(1, 'rgba(120,62,20,0)');
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
  ctx.restore();
}

/* fill an arbitrary path with clay shading.
   makePath must (re)build the path each call.
   o = {x,y,r, base, top?, bot?, gloss?, glossX?, glossY?, sheen?, grain?} */
function clay(ctx, makePath, o) {
  const r = o.r;
  const top = o.top || mixc(o.base, '#ffffff', 0.22);
  const bot = o.bot || mixc(o.base, '#7a3c14', 0.28);
  const g = ctx.createLinearGradient(0, o.y - r, 0, o.y + r);
  g.addColorStop(0, top);
  g.addColorStop(0.52, o.base);
  g.addColorStop(1, bot);
  makePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  makePath();
  ctx.clip();
  /* inner bottom occlusion */
  const s = ctx.createRadialGradient(o.x, o.y + r * 1.05, r * 0.25, o.x, o.y + r * 1.05, r * 1.35);
  s.addColorStop(0, 'rgba(90,42,12,0.20)');
  s.addColorStop(1, 'rgba(90,42,12,0)');
  ctx.fillStyle = s;
  ctx.fillRect(o.x - r * 1.6, o.y - r * 1.6, r * 3.2, r * 3.2);
  /* top sheen band */
  if (o.sheen !== 0) {
    const h = ctx.createLinearGradient(0, o.y - r, 0, o.y - r * 0.1);
    h.addColorStop(0, `rgba(255,255,255,${0.30 * (o.sheen === undefined ? 1 : o.sheen)})`);
    h.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = h;
    ctx.fillRect(o.x - r * 1.6, o.y - r * 1.6, r * 3.2, r * 1.6);
  }
  /* gloss blob */
  if (o.gloss !== 0) {
    const gx = o.glossX !== undefined ? o.glossX : o.x - r * 0.34;
    const gy = o.glossY !== undefined ? o.glossY : o.y - r * 0.42;
    const k = o.gloss === undefined ? 1 : o.gloss;
    ctx.globalAlpha = 0.34 * k;
    ell(ctx, gx, gy, r * 0.30, r * 0.18, '#ffffff');
    ctx.globalAlpha = 0.75 * k;
    ell(ctx, gx - r * 0.08, gy - r * 0.05, r * 0.08, r * 0.05, '#ffffff');
    ctx.globalAlpha = 1;
  }
  if (o.grain) grainRect(ctx, o.x - r * 1.3, o.y - r * 1.3, r * 2.6, r * 2.6, o.grain);
  ctx.restore();
}
function clayEll(ctx, x, y, rx, ry, base, opts = {}) {
  clay(ctx, () => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); },
    Object.assign({ x, y, r: Math.max(rx, ry) }, opts, { base }));
}
function clayBlob(ctx, x, y, r, irr, seed, base, opts = {}) {
  clay(ctx, () => blobPath(ctx, x, y, r, irr, seed),
    Object.assign({ x, y, r: r * (1 + irr) }, opts, { base }));
}

/* baked food surface: radial browning + blotches + sheen + grain.
   makePath rebuilds the shape; t = doneness */
function bakeSurface(ctx, makePath, x, y, r, t, seed, opts = {}) {
  t = clamp(t, 0, 1.15);
  makePath();
  const g = ctx.createRadialGradient(x, y - r * 0.15, r * 0.15, x, y, r);
  g.addColorStop(0, bakeColor(clamp(t * 0.8, 0, 1)));
  g.addColorStop(0.75, bakeColor(clamp(t, 0, 1)));
  g.addColorStop(1, bakeColor(clamp(t * 1.2, 0, 1)));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  makePath();
  ctx.clip();
  /* browning blotches */
  const nb = opts.blotches === undefined ? 7 : opts.blotches;
  const ba = clamp(t, 0, 1) * 0.22;
  if (ba > 0.015) {
    ctx.fillStyle = bakeColor(clamp(t * 1.3, 0, 1));
    for (let i = 0; i < nb; i++) {
      const a = n1(seed + i * 3.7) * TAU;
      const rd = (0.25 + n1(seed + i * 7.1) * 0.6) * r;
      const br = (0.12 + n1(seed + i * 1.9) * 0.14) * r;
      ctx.globalAlpha = ba * (0.5 + n1(seed + i) * 0.5);
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * rd, y + Math.sin(a) * rd, br, 0, TAU); ctx.fill();
      ctx.globalAlpha = ba * 0.6;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * rd, y + Math.sin(a) * rd, br * 1.6, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  /* raw = wet gloss, baked = dry sheen */
  const wet = clamp(1 - t * 2.2, 0, 1);
  if (wet > 0.02) {
    ctx.globalAlpha = 0.4 * wet;
    ell(ctx, x - r * 0.32, y - r * 0.35, r * 0.3, r * 0.16, '#ffffff');
    ctx.globalAlpha = 1;
  }
  if (t > 0.25) {
    ctx.globalAlpha = clamp((t - 0.25) * 0.5, 0, 0.3);
    ell(ctx, x - r * 0.3, y - r * 0.38, r * 0.34, r * 0.14, '#fff2d8');
    ctx.globalAlpha = 1;
  }
  grainRect(ctx, x - r, y - r, r * 2, r * 2, 0.4);
  /* darker rim */
  makePath();
  ctx.strokeStyle = rgba(bakeColor(clamp(t * 1.25, 0, 1)), 0.5);
  ctx.lineWidth = r * 0.07;
  ctx.stroke();
  ctx.restore();
}

/* pointing hand pictogram (for hints) */
function drawHand(ctx, x, y, s, ang = 0) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  softShadow(ctx, 2 * s, 26 * s, 26 * s, 12 * s, 0.18);
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

/* ---------------- kitchen background (cached) ---------------- */
const BG = { cv: null, key: '' };

function paintBG(mode) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = App.W, H = App.H, S = App.S;
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const c = cv.getContext('2d');
  c.scale(dpr, dpr);
  const chill = mode === 'chill', stove = mode === 'stove';

  /* wall */
  let g = c.createLinearGradient(0, 0, 0, H);
  if (chill) { g.addColorStop(0, '#ecf6fd'); g.addColorStop(1, '#d5e9f6'); }
  else if (stove) { g.addColorStop(0, '#fdf2df'); g.addColorStop(1, '#f6d9b2'); }
  else { g.addColorStop(0, '#fff8ec'); g.addColorStop(1, '#fbe6c6'); }
  c.fillStyle = g; c.fillRect(0, 0, W, H);

  /* soft sunlight from upper-left */
  if (!chill) {
    c.save();
    c.globalAlpha = 0.35;
    const sg = c.createRadialGradient(W * 0.12, -H * 0.05, 10, W * 0.12, -H * 0.05, H * 0.9);
    sg.addColorStop(0, 'rgba(255,246,214,0.9)');
    sg.addColorStop(1, 'rgba(255,246,214,0)');
    c.fillStyle = sg; c.fillRect(0, 0, W, H);
    c.restore();
  }

  const counterY = H * 0.62;

  /* window with sky (left) */
  {
    const wx = W * 0.24, wy = H * 0.16, ww = Math.min(W * 0.3, 170 * S), wh = ww * 1.15;
    c.save();
    c.globalAlpha = chill ? 0.55 : 0.9;
    c.fillStyle = chill ? '#c8dcec' : '#fff';
    rr(c, wx - ww / 2 - 9 * S, wy - wh / 2 - 9 * S, ww + 18 * S, wh + 18 * S, 16 * S); c.fill();
    rr(c, wx - ww / 2, wy - wh / 2, ww, wh, 10 * S);
    c.save();
    c.clip();
    const sky = c.createLinearGradient(0, wy - wh / 2, 0, wy + wh / 2);
    if (chill) { sky.addColorStop(0, '#a8c8e0'); sky.addColorStop(1, '#cfe3f2'); }
    else { sky.addColorStop(0, '#a2d8f4'); sky.addColorStop(1, '#dff2fc'); }
    c.fillStyle = sky; c.fillRect(wx - ww / 2, wy - wh / 2, ww, wh);
    if (!chill) {
      c.fillStyle = '#fff3b8';
      c.beginPath(); c.arc(wx + ww * 0.28, wy - wh * 0.26, ww * 0.13, 0, TAU); c.fill();
    }
    c.fillStyle = 'rgba(255,255,255,0.92)';
    for (const [ox, oy, sc] of [[-0.2, -0.05, 1], [0.12, 0.22, 0.8]]) {
      const bx = wx + ox * ww, by = wy + oy * wh;
      c.beginPath();
      c.arc(bx, by, ww * 0.11 * sc, 0, TAU);
      c.arc(bx + ww * 0.1 * sc, by - ww * 0.05 * sc, ww * 0.09 * sc, 0, TAU);
      c.arc(bx + ww * 0.2 * sc, by, ww * 0.08 * sc, 0, TAU);
      c.fill();
    }
    c.restore();
    c.strokeStyle = chill ? '#b0c8da' : '#e8cba0';
    c.lineWidth = 5 * S;
    c.beginPath();
    c.moveTo(wx, wy - wh / 2); c.lineTo(wx, wy + wh / 2);
    c.moveTo(wx - ww / 2, wy); c.lineTo(wx + ww / 2, wy);
    c.stroke();
    c.restore();
  }

  /* shelf with jars (right) */
  {
    const sx = W * 0.78, sy = H * 0.18, sw = Math.min(W * 0.32, 190 * S);
    c.save();
    c.globalAlpha = chill ? 0.4 : 0.85;
    c.fillStyle = '#d9a468';
    rr(c, sx - sw / 2, sy, sw, 12 * S, 6 * S); c.fill();
    c.fillStyle = '#c08948';
    rr(c, sx - sw / 2, sy + 10 * S, sw, 5 * S, 2 * S); c.fill();
    /* honey jar */
    c.fillStyle = '#eda93f';
    rr(c, sx - sw * 0.36, sy - 34 * S, 26 * S, 34 * S, 7 * S); c.fill();
    c.fillStyle = '#c9863a';
    rr(c, sx - sw * 0.36 + 3 * S, sy - 42 * S, 20 * S, 10 * S, 4 * S); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.4)';
    rr(c, sx - sw * 0.36 + 3 * S, sy - 30 * S, 6 * S, 24 * S, 3 * S); c.fill();
    /* milk bottle */
    c.fillStyle = '#f4f8fb';
    rr(c, sx - sw * 0.05, sy - 46 * S, 20 * S, 46 * S, 8 * S); c.fill();
    c.fillStyle = '#9cc8e8';
    rr(c, sx - sw * 0.05, sy - 46 * S, 20 * S, 12 * S, 6 * S); c.fill();
    /* plant */
    c.fillStyle = '#e08a5a';
    rr(c, sx + sw * 0.2, sy - 22 * S, 26 * S, 22 * S, 6 * S); c.fill();
    c.fillStyle = '#8fc879';
    for (const [lx, ly, la] of [[0, -30, 0], [-9, -26, -0.5], [9, -26, 0.5]]) {
      c.save();
      c.translate(sx + sw * 0.2 + 13 * S + lx * S, sy + ly * S);
      c.rotate(la);
      c.beginPath(); c.ellipse(0, 0, 6 * S, 14 * S, 0, 0, TAU); c.fill();
      c.restore();
    }
    c.restore();
  }

  /* tile band above the counter */
  {
    const ty0 = counterY - H * 0.13;
    const tile = 46 * S;
    c.save();
    c.beginPath(); c.rect(0, ty0, W, counterY - ty0); c.clip();
    c.fillStyle = chill ? '#ddeaf4' : '#fdeef0';
    c.fillRect(0, ty0, W, counterY - ty0);
    c.strokeStyle = chill ? '#c2d6e6' : '#f2d8d2';
    c.lineWidth = 3 * S;
    for (let yy = ty0; yy < counterY; yy += tile) {
      c.beginPath(); c.moveTo(0, yy); c.lineTo(W, yy); c.stroke();
      const off = (Math.floor((yy - ty0) / tile) % 2) * tile / 2;
      for (let xx = -off; xx < W; xx += tile) {
        c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx, yy + tile); c.stroke();
      }
      /* tile sheen */
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(0, yy + 2 * S, W, 4 * S);
      c.fillStyle = chill ? '#c2d6e6' : '#f2d8d2';
    }
    c.restore();
  }

  /* counter: top surface + wooden front */
  {
    /* top surface */
    let tg = c.createLinearGradient(0, counterY, 0, counterY + 30 * S);
    tg.addColorStop(0, chill ? '#dcedf8' : '#f7dcae');
    tg.addColorStop(1, chill ? '#c4dcec' : '#eec488');
    c.fillStyle = tg;
    c.fillRect(0, counterY, W, 30 * S);
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillRect(0, counterY, W, 5 * S);
    /* front */
    let fg = c.createLinearGradient(0, counterY + 30 * S, 0, H);
    fg.addColorStop(0, chill ? '#b4cfe2' : '#dfa768');
    fg.addColorStop(1, chill ? '#9cbcd4' : '#c2874a');
    c.fillStyle = fg;
    c.fillRect(0, counterY + 30 * S, W, H - counterY);
    /* planks + grain */
    c.save();
    c.beginPath(); c.rect(0, counterY + 30 * S, W, H); c.clip();
    const plank = Math.max(W / 5, 120 * S);
    for (let px = 0; px < W + plank; px += plank) {
      c.strokeStyle = 'rgba(90,50,15,0.18)';
      c.lineWidth = 3 * S;
      c.beginPath(); c.moveTo(px, counterY); c.lineTo(px, H); c.stroke();
      c.strokeStyle = 'rgba(255,235,200,0.14)';
      c.beginPath(); c.moveTo(px + 3 * S, counterY); c.lineTo(px + 3 * S, H); c.stroke();
    }
    c.strokeStyle = 'rgba(100,55,18,0.10)';
    c.lineWidth = 2.5 * S;
    for (let i = 0; i < 9; i++) {
      const gy = counterY + 40 * S + n1(i * 3.3) * (H - counterY);
      const gx = n1(i * 7.7) * W;
      c.beginPath();
      c.ellipse(gx, gy, (30 + n1(i) * 60) * S, (5 + n1(i * 2) * 7) * S, 0, 0.4, Math.PI - 0.4);
      c.stroke();
      if (n1(i * 5) > 0.55) {
        c.fillStyle = 'rgba(100,55,18,0.13)';
        c.beginPath(); c.ellipse(gx, gy, 6 * S, 8 * S, 0, 0, TAU); c.fill();
      }
    }
    c.restore();
    if (Tex.grain) {
      c.save();
      c.globalCompositeOperation = 'overlay';
      c.globalAlpha = 0.4;
      const pat = c.createPattern(Tex.grain, 'repeat');
      c.fillStyle = pat;
      c.fillRect(0, counterY, W, H - counterY);
      c.restore();
    }
  }

  /* mode lighting + vignette */
  if (stove) {
    const wg = c.createRadialGradient(W / 2, H * 0.55, 20 * S, W / 2, H * 0.55, W * 0.7);
    wg.addColorStop(0, 'rgba(255,150,60,0.14)');
    wg.addColorStop(1, 'rgba(255,150,60,0)');
    c.fillStyle = wg; c.fillRect(0, 0, W, H);
  }
  const vg = c.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, chill ? 'rgba(40,70,110,0.15)' : 'rgba(120,60,20,0.16)');
  c.fillStyle = vg; c.fillRect(0, 0, W, H);

  return cv;
}

function drawKitchenBG(ctx, mode = 'counter') {
  const key = mode + '|' + App.W + 'x' + App.H;
  if (BG.key !== key) { BG.key = key; BG.cv = paintBG(mode); }
  ctx.drawImage(BG.cv, 0, 0, App.W, App.H);
}

/* ---------------- kitchen furniture ---------------- */
function drawBowl(ctx, x, y, r, color = '#8ecbe8') {
  softShadow(ctx, x + r * 0.06, y + r * 0.86, r * 1.18, r * 0.4, 0.28);
  /* deep body seen from ~30° above */
  clay(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(x - r * 1.0, y + r * 0.04);
    ctx.bezierCurveTo(x - r * 1.02, y + r * 0.75, x - r * 0.55, y + r * 1.0, x, y + r * 1.0);
    ctx.bezierCurveTo(x + r * 0.55, y + r * 1.0, x + r * 1.02, y + r * 0.75, x + r * 1.0, y + r * 0.04);
    ctx.closePath();
  }, { x, y: y + r * 0.5, r: r * 0.9, base: color, gloss: 0 });
  /* stripe + side gloss */
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - r * 1.0, y + r * 0.04);
  ctx.bezierCurveTo(x - r * 1.02, y + r * 0.75, x - r * 0.55, y + r * 1.0, x, y + r * 1.0);
  ctx.bezierCurveTo(x + r * 0.55, y + r * 1.0, x + r * 1.02, y + r * 0.75, x + r * 1.0, y + r * 0.04);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x - r, y + r * 0.5, r * 2, r * 0.15);
  ctx.globalAlpha = 0.28;
  ell(ctx, x - r * 0.58, y + r * 0.34, r * 0.1, r * 0.24, '#ffffff');
  ctx.globalAlpha = 1;
  ctx.restore();
  /* rim with thickness */
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.0, r * 0.68, 0, 0, TAU);
  ctx.fillStyle = mixc(color, '#ffffff', 0.4);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.015, r * 0.92, r * 0.62, 0, 0, TAU);
  ctx.fillStyle = mixc(color, '#ffffff', 0.12);
  ctx.fill();
  /* inside: back wall visible at the top, floor lighter at the bottom */
  const ig = ctx.createLinearGradient(0, y - r * 0.6, 0, y + r * 0.55);
  ig.addColorStop(0, mixc(color, '#122430', 0.55));
  ig.addColorStop(0.45, mixc(color, '#122430', 0.3));
  ig.addColorStop(1, mixc(color, '#ffffff', 0.05));
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.02, r * 0.88, r * 0.6, 0, 0, TAU);
  ctx.fillStyle = ig;
  ctx.fill();
  /* soft occlusion under the back rim */
  ctx.save();
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.02, r * 0.88, r * 0.6, 0, 0, TAU); ctx.clip();
  ctx.globalAlpha = 0.35;
  ctx.beginPath(); ctx.ellipse(x, y - r * 0.34, r * 0.82, r * 0.26, 0, 0, TAU);
  ctx.fillStyle = '#0c1820'; ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}
function bowlInner(x, y, r) { return { x, y, rx: r * 0.84, ry: r * 0.56 }; }
function bowlClip(ctx, x, y, r) {
  const b = bowlInner(x, y, r);
  ctx.beginPath(); ctx.ellipse(b.x, b.y, b.rx, b.ry, 0, 0, TAU); ctx.clip();
}
/* front inner lip drawn OVER the bowl content for depth */
function bowlFront(ctx, x, y, r, color = '#8ecbe8') {
  ctx.save();
  ctx.strokeStyle = rgba(mixc(color, '#ffffff', 0.45), 0.9);
  ctx.lineWidth = r * 0.06;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.9, r * 0.62, 0, Math.PI * 0.12, Math.PI * 0.88);
  ctx.stroke();
  ctx.restore();
}

function drawStoveTop(ctx, x, y, r) {
  /* base */
  clayEll(ctx, x, y + 6 * App.S, r * 1.42, r * 1.06, '#e3ded4', { gloss: 0, sheen: 0.5 });
  ell(ctx, x, y, r * 1.32, r * 0.97, '#3c3c44');
  const ig = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 1.2);
  ig.addColorStop(0, '#57575f');
  ig.addColorStop(1, '#33333b');
  ctx.fillStyle = ig;
  ctx.beginPath(); ctx.ellipse(x, y, r * 1.24, r * 0.9, 0, 0, TAU); ctx.fill();
  /* grate */
  ctx.strokeStyle = '#23232a'; ctx.lineWidth = 7 * App.S; ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU + Math.PI / 8;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.35, y + Math.sin(a) * r * 0.26);
    ctx.lineTo(x + Math.cos(a) * r * 1.05, y + Math.sin(a) * r * 0.78);
    ctx.stroke();
  }
  /* flames — lick out from under the pan edge */
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU + App.time * 0.5;
    const fl = 0.7 + 0.3 * Math.sin(App.time * 13 + i * 2.1);
    const fx = x + Math.cos(a) * r * 1.14, fy = y + Math.sin(a) * r * 0.85;
    const fr = r * 0.14 * fl;
    const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
    fg.addColorStop(0, 'rgba(255,200,90,0.9)');
    fg.addColorStop(0.5, 'rgba(255,130,45,0.5)');
    fg.addColorStop(1, 'rgba(255,130,45,0)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(fx, fy, fr, 0, TAU); ctx.fill();
    /* small blue core at the base */
    ctx.fillStyle = 'rgba(120,180,255,0.25)';
    ctx.beginPath(); ctx.arc(fx, fy + fr * 0.35, fr * 0.35, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawPan(ctx, x, y, r) {
  const S = App.S;
  softShadow(ctx, x, y + r * 0.55, r * 1.15, r * 0.45, 0.3);
  /* handle */
  const hg = ctx.createLinearGradient(0, y - 13 * S, 0, y + 13 * S);
  hg.addColorStop(0, '#4a4a52'); hg.addColorStop(0.4, '#2e2e36'); hg.addColorStop(1, '#1e1e24');
  ctx.fillStyle = hg;
  rr(ctx, x + r * 0.94, y - 13 * S, r * 0.8, 26 * S, 13 * S); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  rr(ctx, x + r * 0.98, y - 9 * S, r * 0.7, 7 * S, 4 * S); ctx.fill();
  circle(ctx, x + r * 1.06, y, 4 * S, '#8a8a94');
  /* outer wall with height (2.5D): rim sits higher than the floor */
  const wallH = r * 0.14;
  const bg = ctx.createLinearGradient(0, y - r * 0.82, 0, y + r * 0.82 + wallH);
  bg.addColorStop(0, '#5a5a64'); bg.addColorStop(0.5, '#33333b'); bg.addColorStop(1, '#17171d');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.ellipse(x, y + wallH, r * 1.06, r * 0.82, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x, y, r * 1.06, r * 0.82, 0, 0, TAU); ctx.fill();
  /* rim top surface */
  ctx.beginPath(); ctx.ellipse(x, y, r * 1.0, r * 0.78, 0, 0, TAU);
  ctx.fillStyle = '#4a4a54'; ctx.fill();
  /* inner wall drops down to the floor */
  const iw = ctx.createLinearGradient(0, y - r * 0.76, 0, y + r * 0.5);
  iw.addColorStop(0, '#101014');
  iw.addColorStop(1, '#2c2c34');
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.01, r * 0.95, r * 0.72, 0, 0, TAU);
  ctx.fillStyle = iw; ctx.fill();
  /* cooking floor: brushed metal, sunken */
  const fy = y + r * 0.06;
  const sg = ctx.createRadialGradient(x - r * 0.2, fy - r * 0.15, r * 0.1, x, fy, r * 0.95);
  sg.addColorStop(0, '#6b6b78');
  sg.addColorStop(0.7, '#54545e');
  sg.addColorStop(1, '#3d3d46');
  ctx.fillStyle = sg;
  ctx.beginPath(); ctx.ellipse(x, fy, r * 0.88, r * 0.62, 0, 0, TAU); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.ellipse(x, fy, r * 0.88, r * 0.62, 0, 0, TAU); ctx.clip();
  /* occlusion at the back wall */
  ctx.globalAlpha = 0.4;
  ctx.beginPath(); ctx.ellipse(x, fy - r * 0.36, r * 0.84, r * 0.26, 0, 0, TAU);
  ctx.fillStyle = '#0c0c10'; ctx.fill();
  ctx.globalAlpha = 1;
  /* brushed arcs */
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 2.5 * S;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath(); ctx.ellipse(x, fy, r * 0.15 * i, r * 0.1 * i, 0, 0, TAU); ctx.stroke();
  }
  /* oil sheen */
  ctx.globalAlpha = 0.13;
  ell(ctx, x - r * 0.3, fy - r * 0.2, r * 0.34, r * 0.14, '#ffffff');
  ell(ctx, x + r * 0.25, fy + r * 0.16, r * 0.22, r * 0.09, '#ffffff');
  ctx.globalAlpha = 1;
  ctx.restore();
  /* front rim highlight over the floor */
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = r * 0.03;
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.01, r * 0.95, r * 0.72, 0, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  return { x, y: fy, rx: r * 0.86, ry: r * 0.6 };
}

function drawOven(ctx, x, y, w, h, openT, drawInner) {
  const S = App.S;
  softShadow(ctx, x, y + h * 0.52, w * 0.6, h * 0.12, 0.3);
  clay(ctx, () => rr(ctx, x - w / 2, y - h / 2, w, h, 26 * S),
    { x, y, r: h * 0.6, base: '#e8875f', gloss: 0, sheen: 0.6 });
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  rr(ctx, x - w / 2, y - h / 2, w, h * 0.16, 26 * S); ctx.fill();
  for (const bx of [-0.32, -0.18]) {
    circle(ctx, x + bx * w, y - h * 0.42, 9 * S, '#c9633f');
    circle(ctx, x + bx * w, y - h * 0.43, 7.5 * S, '#fff2e3');
  }
  /* window */
  const wx = x - w * 0.38, wy = y - h * 0.26, ww = w * 0.76, wh = h * 0.62;
  ctx.save();
  rr(ctx, wx, wy, ww, wh, 18 * S); ctx.clip();
  const g = ctx.createLinearGradient(0, wy, 0, wy + wh);
  g.addColorStop(0, '#2e1b0f'); g.addColorStop(1, '#6b3d1c');
  ctx.fillStyle = g; ctx.fillRect(wx, wy, ww, wh);
  const gl = ctx.createRadialGradient(x, wy + wh, wh * 0.1, x, wy + wh, wh * 1.15);
  gl.addColorStop(0, 'rgba(255,160,60,0.6)'); gl.addColorStop(1, 'rgba(255,160,60,0)');
  ctx.fillStyle = gl; ctx.fillRect(wx, wy, ww, wh);
  if (drawInner) drawInner(wx + ww / 2, wy + wh * 0.72, ww, wh);
  /* heat shimmer */
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.12 + 0.05 * Math.sin(App.time * 5);
  ell(ctx, x, wy + wh * 0.9, ww * 0.4, wh * 0.16, '#ff9c4a');
  ctx.restore();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(wx + ww * 0.1, wy + wh); ctx.lineTo(wx + ww * 0.4, wy); ctx.lineTo(wx + ww * 0.58, wy); ctx.lineTo(wx + ww * 0.28, wy + wh); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.strokeStyle = '#c9633f'; ctx.lineWidth = 6 * S;
  rr(ctx, wx, wy, ww, wh, 18 * S); ctx.stroke();
  const hg = ctx.createLinearGradient(0, wy - 16 * S, 0, wy - 6 * S);
  hg.addColorStop(0, '#e0774f'); hg.addColorStop(1, '#b05436');
  ctx.fillStyle = hg;
  rr(ctx, wx + ww * 0.1, wy - 16 * S, ww * 0.8, 10 * S, 5 * S); ctx.fill();
}

function drawPitcher(ctx, x, y, s, tilt, color = '#fefefe', liquid = '#fdfdf6') {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(tilt);
  softShadow(ctx, 0, 46 * s, 40 * s, 12 * s, 0.2);
  clay(ctx, () => rr(ctx, -30 * s, -40 * s, 60 * s, 78 * s, 14 * s),
    { x: 0, y: 0, r: 45 * s, base: color, bot: mixc(color, '#7288a8', 0.3), gloss: 0 });
  ctx.fillStyle = mixc(color, '#88aacc', 0.3);
  rr(ctx, -30 * s, -40 * s, 60 * s, 16 * s, 8 * s); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-30 * s, -36 * s); ctx.lineTo(-48 * s, -28 * s); ctx.lineTo(-30 * s, -16 * s);
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  /* liquid visible inside */
  const lg = ctx.createLinearGradient(0, -18 * s, 0, 30 * s);
  lg.addColorStop(0, mixc(liquid, '#ffffff', 0.3));
  lg.addColorStop(1, liquid);
  ctx.fillStyle = lg;
  rr(ctx, -22 * s, -18 * s, 44 * s, 48 * s, 10 * s); ctx.fill();
  ctx.globalAlpha = 0.5;
  ell(ctx, 0, -16 * s, 19 * s, 4.5 * s, mixc(liquid, '#ffffff', 0.5));
  rr(ctx, -18 * s, -12 * s, 7 * s, 36 * s, 4 * s);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = mixc(color, '#557799', 0.35); ctx.lineWidth = 4 * s;
  ctx.beginPath(); ctx.arc(38 * s, 0, 26 * s, -1.2, 1.2); ctx.stroke();
  ctx.restore();
}

/* liquid stream with sag, taper, highlight and landing ripple */
function drawStream(ctx, x0, y0, x1, y1, w, color) {
  ctx.save();
  ctx.lineCap = 'round';
  const mx = x0 + (x1 - x0) * 0.18, my = y0 + (y1 - y0) * 0.68;
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx, my, x1, y1);
  ctx.stroke();
  /* narrowing core + white shine */
  ctx.strokeStyle = rgba('#ffffff', 0.35);
  ctx.lineWidth = w * 0.35;
  ctx.beginPath();
  ctx.moveTo(x0 - w * 0.12, y0);
  ctx.quadraticCurveTo(mx - w * 0.12, my, x1 - w * 0.12, y1);
  ctx.stroke();
  /* landing puddle + ripple */
  ell(ctx, x1, y1, w * 1.5, w * 0.6, color);
  const rip = (App.time * 2.2) % 1;
  ctx.globalAlpha = (1 - rip) * 0.5;
  ctx.strokeStyle = rgba('#ffffff', 0.8);
  ctx.lineWidth = 2 * App.S;
  ctx.beginPath();
  ctx.ellipse(x1, y1, w * (1.2 + rip * 2.2), w * (0.5 + rip * 0.9), 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawWhisk(ctx, x, y, s, ang = 0) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  /* handle */
  clay(ctx, () => rr(ctx, -7 * s, -78 * s, 14 * s, 42 * s, 7 * s),
    { x: 0, y: -57 * s, r: 22 * s, base: '#ec8fae', gloss: 0.7, glossX: -3 * s, glossY: -70 * s });
  /* wires */
  ctx.strokeStyle = '#dfe3ec'; ctx.lineWidth = 3.6 * s;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(0, -38 * s);
    ctx.quadraticCurveTo(i * 13 * s, -6 * s, 0, 16 * s);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(120,130,150,0.55)'; ctx.lineWidth = 1.4 * s;
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
  clay(ctx, () => rr(ctx, -6 * s, -80 * s, 12 * s, 62 * s, 6 * s),
    { x: 0, y: -49 * s, r: 32 * s, base: '#e8b04f', gloss: 0 });
  clayEll(ctx, 0, 0, 20 * s, 26 * s, '#f2c26b', { gloss: 0.5 });
  ell(ctx, 0, -2 * s, 13 * s, 18 * s, '#d89a3e');
  ell(ctx, -4 * s, -8 * s, 4 * s, 6 * s, 'rgba(255,255,255,0.35)');
  ctx.restore();
}
function drawLadle(ctx, x, y, s) {
  const hg = ctx.createLinearGradient(x - 5 * s, 0, x + 5 * s, 0);
  hg.addColorStop(0, '#e8ecf4'); hg.addColorStop(0.5, '#b8bfce'); hg.addColorStop(1, '#8f97a8');
  ctx.fillStyle = hg;
  rr(ctx, x - 5 * s, y - 90 * s, 10 * s, 70 * s, 5 * s); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, 26 * s, -0.15, Math.PI + 0.15); ctx.closePath();
  const bg = ctx.createLinearGradient(0, y - 5 * s, 0, y + 26 * s);
  bg.addColorStop(0, '#c8cedb'); bg.addColorStop(1, '#8a92a4');
  ctx.fillStyle = bg; ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ell(ctx, x - 10 * s, y + 6 * s, 6 * s, 3 * s);
}
function drawMasher(ctx, x, y, s) {
  clay(ctx, () => rr(ctx, x - 7 * s, y - 92 * s, 14 * s, 58 * s, 7 * s),
    { x, y: y - 63 * s, r: 30 * s, base: '#ec8fae', gloss: 0.6, glossX: x - 3 * s, glossY: y - 82 * s });
  clay(ctx, () => rr(ctx, x - 30 * s, y - 36 * s, 60 * s, 34 * s, 10 * s),
    { x, y: y - 19 * s, r: 32 * s, base: '#c2c8d6', gloss: 0.4 });
  ctx.strokeStyle = '#9aa2b5'; ctx.lineWidth = 4 * s;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath(); ctx.moveTo(x + i * 16 * s, y - 32 * s); ctx.lineTo(x + i * 16 * s, y - 8 * s); ctx.stroke();
  }
}
function drawRollingPin(ctx, x, y, s) {
  softShadow(ctx, x, y + 24 * s, 95 * s, 14 * s, 0.2);
  clay(ctx, () => rr(ctx, x - 95 * s, y - 20 * s, 190 * s, 40 * s, 20 * s),
    { x, y, r: 42 * s, base: '#dda86c', gloss: 0, sheen: 1 });
  ctx.save();
  rr(ctx, x - 95 * s, y - 20 * s, 190 * s, 40 * s, 20 * s);
  ctx.clip();
  ctx.strokeStyle = 'rgba(120,70,25,0.15)'; ctx.lineWidth = 2 * s;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath(); ctx.moveTo(x - 95 * s, y + i * 6 * s); ctx.lineTo(x + 95 * s, y + i * 6 * s); ctx.stroke();
  }
  ctx.restore();
  clay(ctx, () => rr(ctx, x - 133 * s, y - 9 * s, 38 * s, 18 * s, 9 * s),
    { x: x - 114 * s, y, r: 20 * s, base: '#b9834a', gloss: 0 });
  clay(ctx, () => rr(ctx, x + 95 * s, y - 9 * s, 38 * s, 18 * s, 9 * s),
    { x: x + 114 * s, y, r: 20 * s, base: '#b9834a', gloss: 0 });
}

/* フライ返し — blade centered at (x,y), wooden handle to the upper right */
function drawTurner(ctx, x, y, s, ang = 0, scoop = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang - scoop * 0.9);
  /* handle */
  ctx.save();
  ctx.rotate(0.78);
  clay(ctx, () => rr(ctx, -8 * s, -108 * s, 16 * s, 62 * s, 8 * s),
    { x: 0, y: -77 * s, r: 34 * s, base: '#d9a468', gloss: 0.4, glossX: -3 * s, glossY: -96 * s });
  const ng = ctx.createLinearGradient(-5 * s, 0, 5 * s, 0);
  ng.addColorStop(0, '#dfe3ec'); ng.addColorStop(1, '#9aa2b5');
  ctx.fillStyle = ng;
  rr(ctx, -4 * s, -52 * s, 8 * s, 34 * s, 4 * s); ctx.fill();
  ctx.restore();
  /* blade: rounded trapezoid with slots */
  const bw = 60 * s, bh = 46 * s;
  const bg = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
  bg.addColorStop(0, '#e4e8f0'); bg.addColorStop(0.5, '#bcc3d2'); bg.addColorStop(1, '#8f97a8');
  ctx.beginPath();
  ctx.moveTo(-bw * 0.38, -bh * 0.5);
  ctx.lineTo(bw * 0.38, -bh * 0.5);
  ctx.quadraticCurveTo(bw * 0.56, -bh * 0.45, bw * 0.5, -bh * 0.1);
  ctx.lineTo(bw * 0.44, bh * 0.42);
  ctx.quadraticCurveTo(0, bh * 0.58, -bw * 0.44, bh * 0.42);
  ctx.lineTo(-bw * 0.5, -bh * 0.1);
  ctx.quadraticCurveTo(-bw * 0.56, -bh * 0.45, -bw * 0.38, -bh * 0.5);
  ctx.closePath();
  ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = 'rgba(90,100,120,0.5)'; ctx.lineWidth = 1.6 * s; ctx.stroke();
  /* slots */
  ctx.fillStyle = 'rgba(70,78,95,0.55)';
  for (let i = -1; i <= 1; i++) {
    rr(ctx, i * 14 * s - 3.5 * s, -bh * 0.28, 7 * s, bh * 0.6, 3.5 * s);
    ctx.fill();
  }
  ctx.globalAlpha = 0.5;
  ell(ctx, -bw * 0.26, -bh * 0.3, 8 * s, 3.5 * s, '#ffffff');
  ctx.globalAlpha = 1;
  ctx.restore();
}
/* wooden spatula */
function drawSpatula(ctx, x, y, s, ang = 0) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.save();
  ctx.rotate(0.7);
  clay(ctx, () => rr(ctx, -7 * s, -100 * s, 14 * s, 66 * s, 7 * s),
    { x: 0, y: -67 * s, r: 34 * s, base: '#d9a468', gloss: 0.4, glossX: -3 * s, glossY: -90 * s });
  ctx.restore();
  clayEll(ctx, 0, 0, 24 * s, 30 * s, '#e5b877', { bot: '#b98a4a', gloss: 0.5, glossX: -8 * s, glossY: -10 * s });
  ctx.strokeStyle = 'rgba(140,95,40,0.35)'; ctx.lineWidth = 2 * s;
  ctx.beginPath(); ctx.ellipse(0, 2 * s, 15 * s, 20 * s, 0, 0, TAU); ctx.stroke();
  ctx.restore();
}
/* oven mitt */
function drawMitt(ctx, x, y, s, ang = 0) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  softShadow(ctx, 2 * s, 30 * s, 26 * s, 9 * s, 0.18);
  /* thumb */
  clayEll(ctx, -20 * s, 2 * s, 12 * s, 17 * s, '#e8635a', { gloss: 0 });
  /* body */
  clay(ctx, () => rr(ctx, -14 * s, -26 * s, 34 * s, 46 * s, 15 * s),
    { x: 3 * s, y: -3 * s, r: 28 * s, base: '#f27a70', bot: '#c74a44', gloss: 0.5, glossX: -3 * s, glossY: -16 * s });
  /* cuff */
  clay(ctx, () => rr(ctx, -16 * s, 16 * s, 38 * s, 15 * s, 7 * s),
    { x: 3 * s, y: 23 * s, r: 16 * s, base: '#fdf6ea', gloss: 0 });
  /* stitches */
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.8 * s;
  ctx.setLineDash([3 * s, 3 * s]);
  rr(ctx, -10 * s, -22 * s, 26 * s, 38 * s, 12 * s);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}
/* "hot!" mark — wavering red heat lines */
function drawHeatMark(ctx, x, y, s) {
  ctx.save();
  ctx.strokeStyle = `rgba(255,90,40,${0.55 + 0.25 * Math.sin(App.time * 5)})`;
  ctx.lineWidth = 4 * s;
  ctx.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    const ph = App.time * 5 + i * 1.8;
    ctx.beginPath();
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const px = x + i * 13 * s + Math.sin(ph + t * 5) * 4.5 * s;
      const py = y + 15 * s - t * 30 * s;
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}
/* gentle "あちち!" reaction when a hot thing is poked bare-handed */
const Ouch = {
  at: -9, x: 0, y: 0,
  trigger(x, y) {
    if (App.time - this.at < 1) return;
    this.at = App.time; this.x = x; this.y = y;
    Snd.ouch();
    steamPuff(App.fx, x, y - 24 * App.S, 3);
    for (let i = 0; i < 4; i++) {
      App.fx.add({
        x: x + rnd(-14, 14) * App.S, y: y - rnd(0, 18) * App.S,
        kind: 'glow', color: '#ff5a3c', r: rnd(10, 16) * App.S,
        vy: -rnd(40, 90) * App.S, life: 0.5, alpha: 0.8
      });
    }
  },
  draw(ctx) {
    const k = (App.time - this.at) / 0.9;
    if (k < 0 || k > 1) return;
    const S = App.S;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    drawHeatMark(ctx, this.x, this.y - 34 * S, S * (1 + k * 0.4));
    /* the hand snaps back, shaking */
    drawHand(ctx, this.x + 22 * S, this.y + 34 * S + easeOutBack(k) * 80 * S, S, Math.sin(k * 34) * 0.18);
    ctx.restore();
  }
};

function drawEggItem(ctx, x, y, s, crack = 0) {
  softShadow(ctx, x, y + 30 * s, 26 * s, 9 * s, 0.2);
  clayEll(ctx, x, y, 26 * s, 33 * s, '#f7ecd2', { bot: '#e0c9a0', gloss: 0.9, glossX: x - 9 * s, glossY: y - 12 * s });
  ctx.fillStyle = 'rgba(220,185,130,0.35)';
  for (let i = 0; i < 4; i++) {
    circle(ctx, x + (n1(i * 3.3) - 0.5) * 34 * s, y + (n1(i * 7.1) - 0.4) * 44 * s, 1.6 * s);
  }
  if (crack > 0) {
    ctx.strokeStyle = '#b8935a'; ctx.lineWidth = 2.5 * s;
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
  softShadow(ctx, 0, 22 * s, 20 * s, 7 * s, 0.2);
  const makePath = () => {
    ctx.beginPath();
    ctx.moveTo(0, 22 * s);
    ctx.bezierCurveTo(-24 * s, 8 * s, -20 * s, -16 * s, 0, -14 * s);
    ctx.bezierCurveTo(20 * s, -16 * s, 24 * s, 8 * s, 0, 22 * s);
  };
  makePath();
  const g = ctx.createRadialGradient(-7 * s, -6 * s, 2 * s, 0, 4 * s, 26 * s);
  g.addColorStop(0, '#ff7a8c');
  g.addColorStop(0.55, '#e8465c');
  g.addColorStop(1, '#b82c42');
  ctx.fillStyle = g; ctx.fill();
  ctx.save();
  makePath(); ctx.clip();
  ctx.globalAlpha = 0.5;
  ell(ctx, -8 * s, -6 * s, 6 * s, 4 * s, '#ffffff');
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffdfe6';
  for (let i = 0; i < 7; i++) {
    ctx.save();
    ctx.translate((n1(i * 5) - 0.5) * 26 * s, (n1(i * 9 + 3) - 0.25) * 22 * s);
    ctx.rotate(0.4);
    ctx.beginPath(); ctx.ellipse(0, 0, 1.5 * s, 2.6 * s, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  /* leaves */
  for (const [lx, la] of [[-9, -0.5], [0, 0], [9, 0.5]]) {
    ctx.save();
    ctx.translate(lx * s, -15 * s);
    ctx.rotate(la);
    const lg = ctx.createLinearGradient(0, -9 * s, 0, 9 * s);
    lg.addColorStop(0, '#96d478'); lg.addColorStop(1, '#68a84e');
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.ellipse(0, 0, 6 * s, 9 * s, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
function drawButterCube(ctx, x, y, s, melt = 0) {
  const h = lerp(34, 12, melt) * s, w = lerp(40, 52, melt) * s;
  if (melt > 0.1) {
    ctx.globalAlpha = melt * 0.5;
    ell(ctx, x, y + h * 0.45, w * 0.85, h * 0.45, '#f9e194');
    ctx.globalAlpha = 1;
  }
  clay(ctx, () => rr(ctx, x - w / 2, y - h / 2, w, h, 7 * s),
    { x, y, r: Math.max(w, h) * 0.6, base: '#f5d36a', bot: '#dcae3e', gloss: 0.8, glossX: x - w * 0.22, glossY: y - h * 0.2 });
}
function drawPlate(ctx, x, y, r) {
  softShadow(ctx, x, y + 10 * App.S, r * 1.05, r * 0.6, 0.22);
  const g = ctx.createLinearGradient(0, y - r * 0.62, 0, y + r * 0.62);
  g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#e3ddd2');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.62, 0, 0, TAU); ctx.fill();
  /* pastel rim stripe */
  ctx.strokeStyle = 'rgba(160,200,230,0.55)';
  ctx.lineWidth = r * 0.035;
  ctx.beginPath(); ctx.ellipse(x, y, r * 0.9, r * 0.55, 0, 0, TAU); ctx.stroke();
  const ig = ctx.createLinearGradient(0, y - r * 0.48, 0, y + r * 0.48);
  ig.addColorStop(0, '#f2efe9'); ig.addColorStop(1, '#faf8f4');
  ctx.fillStyle = ig;
  ctx.beginPath(); ctx.ellipse(x, y, r * 0.78, r * 0.46, 0, 0, TAU); ctx.fill();
  /* specular arc */
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = r * 0.03;
  ctx.beginPath(); ctx.ellipse(x, y, r * 0.95, r * 0.58, 0, Math.PI * 1.15, Math.PI * 1.5); ctx.stroke();
}

/* ---------------- effects ---------------- */
function sparkleBurst(parts, x, y, color = '#ffd94f', n = 8) {
  for (let i = 0; i < n; i++) {
    const a = rnd(TAU);
    parts.add({
      x, y, kind: 'spark', color,
      vx: Math.cos(a) * rnd(40, 160) * App.S, vy: Math.sin(a) * rnd(40, 160) * App.S,
      r: rnd(4, 9) * App.S, life: rnd(0.4, 0.8), g: 60 * App.S, vr: rnd(-4, 4)
    });
  }
  parts.add({ x, y, kind: 'ring', color: '#ffffff', r: 6 * App.S, grow: 220 * App.S, life: 0.4, alpha: 0.8 });
}
function confettiBurst(parts) {
  const cols = ['#ff8fb2', '#ffd94f', '#8ecbe8', '#9fd98a', '#c9a2e8'];
  for (let i = 0; i < 60; i++) {
    parts.add({
      x: rnd(App.W), y: rnd(-App.H * 0.3, 0), kind: 'confetti',
      color: cols[i % cols.length],
      vx: rnd(-40, 40) * App.S, vy: rnd(80, 220) * App.S,
      r: rnd(4, 8) * App.S, life: rnd(1.6, 2.8), vr: rnd(-6, 6), wob: rnd(20, 60) * App.S
    });
  }
  for (let i = 0; i < 12; i++) {
    parts.add({
      x: rnd(App.W * 0.2, App.W * 0.8), y: rnd(App.H * 0.2, App.H * 0.6),
      kind: 'spark', color: '#ffd94f', r: rnd(6, 12) * App.S,
      vy: -rnd(20, 60) * App.S, life: rnd(0.6, 1.1), vr: rnd(-5, 5)
    });
  }
}
function steamPuff(parts, x, y, n = 1) {
  for (let i = 0; i < n; i++) {
    parts.add({
      x: x + rnd(-14, 14) * App.S, y, kind: 'steam', color: '#ffffff',
      vy: -rnd(50, 90) * App.S, vx: rnd(-10, 10) * App.S,
      r: rnd(8, 14) * App.S, grow: 20 * App.S, life: rnd(1.0, 1.7), alpha: 0.9,
      wob: rnd(25, 60) * App.S
    });
  }
}
function flourPuff(parts, x, y, n = 12) {
  for (let i = 0; i < n; i++) {
    parts.add({
      x: x + rnd(-60, 60) * App.S, y: y - rnd(0, 50) * App.S,
      kind: 'steam', color: '#fff', r: rnd(6, 12) * App.S,
      vy: -rnd(20, 60) * App.S, vx: rnd(-40, 40) * App.S,
      life: rnd(0.4, 0.9), grow: 12 * App.S, wob: rnd(20, 50) * App.S
    });
    parts.add({
      x: x + rnd(-70, 70) * App.S, y: y - rnd(-10, 60) * App.S,
      kind: 'flour', color: '#fffdf4', r: rnd(1.5, 3) * App.S,
      vy: rnd(10, 50) * App.S, vx: rnd(-30, 30) * App.S,
      life: rnd(0.8, 1.6)
    });
  }
}

/* ---------------- shared UI ---------------- */
function homeBtnPos() { return { x: 54 * App.S, y: 54 * App.S, r: 34 * App.S }; }
function arrowBtnPos() { return { x: App.W - 76 * App.S, y: App.H - 76 * App.S, r: 52 * App.S }; }
function hitCircle(p, c) { return dist(p.x, p.y, c.x, c.y) < c.r * 1.25; }

function clayButton(ctx, x, y, r, base, press = 0) {
  const dy = press * 5 * App.S;
  softShadow(ctx, x, y + r * 0.22 + 4 * App.S, r * 1.05, r * 0.5, 0.28 * (1 - press * 0.5));
  clay(ctx, () => { ctx.beginPath(); ctx.arc(x, y + dy, r, 0, TAU); },
    { x, y: y + dy, r, base, gloss: 0.9, glossX: x - r * 0.3, glossY: y + dy - r * 0.42 });
  return dy;
}
function drawHomeBtn(ctx) {
  const b = homeBtnPos(), S = App.S;
  clayButton(ctx, b.x, b.y, b.r, '#ffffff');
  ctx.fillStyle = '#ff8fb2';
  ctx.beginPath();
  ctx.moveTo(b.x, b.y - 17 * S);
  ctx.lineTo(b.x + 17 * S, b.y - 1 * S);
  ctx.lineTo(b.x - 17 * S, b.y - 1 * S);
  ctx.closePath(); ctx.fill();
  rr(ctx, b.x - 11 * S, b.y - 2 * S, 22 * S, 15 * S, 4 * S); ctx.fill();
  ctx.fillStyle = '#fff';
  rr(ctx, b.x - 3 * S, b.y + 4 * S, 6 * S, 9 * S, 2 * S); ctx.fill();
}
function drawArrowBtn(ctx) {
  const b = arrowBtnPos(), S = App.S;
  const k = 1 + 0.07 * Math.sin(App.time * 5);
  ctx.save();
  ctx.translate(b.x, b.y); ctx.scale(k, k);
  clayButton(ctx, 0, 0, b.r, '#ff8fb2');
  ctx.fillStyle = 'rgba(140,30,60,0.3)';
  ctx.beginPath();
  ctx.moveTo(-11 * S, -18 * S); ctx.lineTo(21 * S, 2 * S); ctx.lineTo(-11 * S, 22 * S);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(-13 * S, -20 * S); ctx.lineTo(19 * S, 0); ctx.lineTo(-13 * S, 20 * S);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  /* inviting sparkles */
  if (Math.sin(App.time * 2.4) > 0.6) {
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#fff';
    starPath(ctx, b.x + b.r * 0.7, b.y - b.r * 0.75, 6 * S, 4, 0.4);
    ctx.fill();
    ctx.restore();
  }
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
  clayButton(ctx, replay.x, replay.y, replay.r, '#9fd98a');
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 7 * S;
  ctx.beginPath(); ctx.arc(replay.x, replay.y, 19 * S, 0.6, TAU - 0.7); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.save();
  ctx.translate(replay.x + Math.cos(0.6) * 19 * S, replay.y + Math.sin(0.6) * 19 * S);
  ctx.rotate(0.6 + Math.PI / 2);
  ctx.beginPath(); ctx.moveTo(-9 * S, 0); ctx.lineTo(9 * S, 0); ctx.lineTo(0, 13 * S); ctx.closePath(); ctx.fill();
  ctx.restore();
  clayButton(ctx, home.x, home.y, home.r, '#8ecbe8');
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(home.x, home.y - 18 * S);
  ctx.lineTo(home.x + 18 * S, home.y - 1 * S);
  ctx.lineTo(home.x - 18 * S, home.y - 1 * S);
  ctx.closePath(); ctx.fill();
  rr(ctx, home.x - 12 * S, home.y - 2 * S, 24 * S, 16 * S, 4 * S); ctx.fill();
}
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
    this.pop = 1;
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
      this.pop = 0;
      this.lastAct = App.time;
      Snd.whoosh();
      if (this.step.enter) this.step.enter();
    }
  }
  update(dt) {
    this.wipe = Math.max(0, this.wipe - dt * 2.8);
    this.pop = Math.min(1, this.pop + dt * 2.2);
    if (this.step.update) this.step.update(dt);
    this.parts.update(dt);
  }
  draw(ctx) {
    drawKitchenBG(ctx, this.step.bgMode || 'counter');
    /* new step pops in with a springy scale */
    const k = 0.94 + 0.06 * easeOutBack(this.pop);
    ctx.save();
    ctx.translate(App.W / 2, App.H * 0.55);
    ctx.scale(k, k);
    ctx.translate(-App.W / 2, -App.H * 0.55);
    this.step.draw(ctx);
    this.parts.draw(ctx);
    ctx.restore();
    const isDone = this.step.done && this.step.done();
    if (this.step.hint && App.time - this.lastAct > 2.2 && !isDone) {
      const at = this.step.hintAt ? this.step.hintAt() : { x: App.W / 2, y: App.H * 0.5 };
      drawHint(ctx, this.step.hint, at.x, at.y, this.step.hintOpt || {});
    }
    if (isDone) drawArrowBtn(ctx);
    drawHomeBtn(ctx);
    if (this.wipe > 0.55) {
      ctx.fillStyle = `rgba(255,250,240,${(this.wipe - 0.55) / 0.45})`;
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
    /* title with depth */
    const ty = H * (H > W ? 0.1 : 0.13);
    const fs = Math.min(W / 11, 64 * S);
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${fs}px 'Hiragino Maru Gothic ProN','ヒラギノ丸ゴ ProN','Zen Maru Gothic',system-ui,sans-serif`;
    ctx.lineJoin = 'round';
    const wob = Math.sin(this.t * 2) * 0.018;
    const bounce = 1 + 0.015 * Math.sin(this.t * 2.6);
    ctx.translate(W / 2, ty);
    ctx.rotate(wob);
    ctx.scale(bounce, bounce);
    const line = (txt, yy, grad1, grad2) => {
      /* drop shadow */
      ctx.lineWidth = fs * 0.34; ctx.strokeStyle = 'rgba(160,90,30,0.25)';
      ctx.strokeText(txt, 0, yy + fs * 0.1);
      /* white outline */
      ctx.lineWidth = fs * 0.3; ctx.strokeStyle = '#fff';
      ctx.strokeText(txt, 0, yy);
      /* gradient fill */
      const g = ctx.createLinearGradient(0, yy - fs * 0.5, 0, yy + fs * 0.5);
      g.addColorStop(0, grad1); g.addColorStop(1, grad2);
      ctx.fillStyle = g;
      ctx.fillText(txt, 0, yy);
      /* top highlight */
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#fff';
      ctx.fillText(txt, 0, yy - fs * 0.045);
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillText(txt, 0, yy + fs * 0.01);
      ctx.restore();
    };
    line('まぜまぜ！', -fs * 0.62, '#ff9ec0', '#f26591');
    line('へんしんキッチン', fs * 0.62, '#ffc46b', '#e8912f');
    ctx.restore();
    /* sparkles around title */
    for (let i = 0; i < 6; i++) {
      const a = this.t * 0.8 + i * TAU / 6;
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(this.t * 3 + i * 2);
      ctx.fillStyle = i % 2 ? '#ffd94f' : '#ffb0c8';
      starPath(ctx, W / 2 + Math.cos(a) * W * 0.36, ty + Math.sin(a * 1.3) * 46 * S, (6 + (i % 3) * 3) * S, 4, 0.45);
      ctx.fill();
      ctx.restore();
    }
    /* dish tiles — clay badges */
    const tiles = this.tiles();
    tiles.forEach((tl, i) => {
      const bob = 1 + 0.02 * Math.sin(this.t * 2 + i * 1.4);
      const pr = this.pressI === i ? clamp(this.pressT * 8, 0, 1) : 0;
      const rr2 = tl.r * bob * (1 - pr * 0.07);
      const dy = pr * 6 * S;
      ctx.save();
      softShadow(ctx, tl.x, tl.y + rr2 * 0.55 + 8 * S, rr2 * 1.1, rr2 * 0.42, 0.24 * (1 - pr * 0.4));
      /* white ring */
      clay(ctx, () => { ctx.beginPath(); ctx.arc(tl.x, tl.y + dy, rr2 * 1.06, 0, TAU); },
        { x: tl.x, y: tl.y + dy, r: rr2 * 1.06, base: '#ffffff', bot: '#e0d2ba', gloss: 0 });
      /* pastel face */
      const fg = ctx.createRadialGradient(tl.x - rr2 * 0.3, tl.y + dy - rr2 * 0.35, rr2 * 0.1, tl.x, tl.y + dy, rr2);
      fg.addColorStop(0, mixc(tl.def.color, '#ffffff', 0.4));
      fg.addColorStop(1, tl.def.color);
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(tl.x, tl.y + dy, rr2 * 0.97, 0, TAU); ctx.fill();
      /* icon */
      ctx.translate(tl.x, tl.y + dy);
      tl.def.icon(ctx, rr2 * 0.62);
      ctx.translate(-tl.x, -(tl.y + dy));
      /* gloss arc */
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = rr2 * 0.09;
      ctx.beginPath(); ctx.arc(tl.x, tl.y + dy, rr2 * 0.82, Math.PI * 1.1, Math.PI * 1.48); ctx.stroke();
      ctx.globalAlpha = 1;
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
