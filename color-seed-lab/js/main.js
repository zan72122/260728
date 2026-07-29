// いろのたね ラボ — エントリポイント
// 種を置く → 領域がじわっと広がる → 隣とぶつかって境目ができる → 種を動かすと境目も動く

import { COLORS, TOOLS, SEED } from './config.js';
import { Field } from './field.js';
import { SeedBox } from './seeds.js';
import { Particles } from './particles.js';
import { Decor } from './decor.js';
import { Sound } from './sound.js';
import { UI } from './ui.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

const field = new Field();
const seedBox = new SeedBox();
const particles = new Particles();
const decor = new Decor();
const sound = new Sound();

const state = {
  w: 0, h: 0,
  tool: TOOLS.SEED,
  colorIdx: 0,
  globalJiggle: 0,     // 泡ボタンの後の全体ぷるぷる
  lastContactSound: 0, // チャイムの鳴らしすぎ防止
  lastPourAt: 0,       // 水・泡ドラッグの間引き
  pointerId: null,
  dragSeed: null,
  downPos: null,
  downSeed: null,
  moved: false,
  placedOnce: false,   // 最初のヒント表示用
};

const ui = new UI({
  onColor: (idx) => { state.colorIdx = idx; state.tool = TOOLS.SEED; sound.ensure(); },
  onTool: (tool) => { state.tool = tool; sound.ensure(); },
  onReset: () => {
    sound.ensure();
    if (seedBox.seeds.length > 0) {
      sound.reset();
      seedBox.beginShrink();
      decor.clear();
    }
  },
  onMute: (muted) => { sound.ensure(); sound.setMuted(muted); },
});

// ---- 画面サイズ ----

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const prevW = state.w, prevH = state.h;
  state.w = Math.max(1, rect.width);
  state.h = Math.max(1, rect.height);
  canvas.width = Math.round(state.w * dpr);
  canvas.height = Math.round(state.h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 種の位置を新しい画面に合わせてスケール
  if (prevW > 0 && prevH > 0) {
    for (const s of seedBox.seeds) {
      s.x *= state.w / prevW;
      s.y *= state.h / prevH;
    }
  }
  field.resize(state.w, state.h);
  seedBox.setStageSize(state.w, state.h);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));

// ---- 入力（すべて直接操作） ----

function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.min(state.w, Math.max(0, e.clientX - rect.left)),
    y: Math.min(state.h, Math.max(0, e.clientY - rect.top)),
  };
}

function placeSeed(x, y) {
  const { seed, popped } = seedBox.add(x, y, state.colorIdx);
  if (popped) {
    particles.burst(popped.x, popped.y, COLORS[popped.colorIdx].hex, 14, 110);
    sound.pop();
  }
  particles.burst(x, y, COLORS[seed.colorIdx].hex, 10, 70);
  particles.ring(x, y, COLORS[seed.colorIdx].hex, 60);
  sound.place();
  state.placedOnce = true;
  return seed;
}

function pourWater(x, y) {
  for (let i = 0; i < 12; i++) particles.drop(x, y);
  particles.ring(x, y, 'rgba(190,235,255,0.8)', 70);
  const watered = seedBox.water(x, y);
  for (const s of watered) {
    particles.ring(s.x, s.y, COLORS[s.colorIdx].hex, s.r * 0.5 + 30);
  }
  sound.water();
}

function blowBubbles(x, y) {
  for (let i = 0; i < 10; i++) {
    particles.bubble(x + (Math.random() - 0.5) * 90, y + (Math.random() - 0.5) * 70, Math.random() < 0.4);
  }
  // 近くの境目からも泡が立つ
  for (let i = 0; i < 8; i++) {
    const c = field.randomBoundaryCell();
    if (c && Math.hypot(c.x - x, c.y - y) < state.w * 0.4) particles.bubble(c.x, c.y, true);
  }
  state.globalJiggle = 1;
  seedBox.jiggleAll(0.8);
  sound.bubbles();
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (state.pointerId !== null) return; // 最初の指だけ使う
  state.pointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  sound.ensure();

  const p = canvasPos(e);
  state.downPos = p;
  state.moved = false;
  state.dragSeed = null;
  state.downSeed = null;

  if (state.tool === TOOLS.SEED) {
    const near = seedBox.findNear(p.x, p.y);
    if (near) {
      state.dragSeed = near;
      state.downSeed = near;
      near.dragging = true;
      near.jiggle = 1;
      sound.grab();
    } else if (!seedBox.shrinking) {
      state.dragSeed = placeSeed(p.x, p.y); // 置いてそのまま動かせる
      state.dragSeed.dragging = true;
    }
  } else if (state.tool === TOOLS.WATER) {
    pourWater(p.x, p.y);
    state.lastPourAt = performance.now();
  } else if (state.tool === TOOLS.BUBBLE) {
    blowBubbles(p.x, p.y);
    state.lastPourAt = performance.now();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== state.pointerId) return;
  const p = canvasPos(e);
  if (state.downPos && Math.hypot(p.x - state.downPos.x, p.y - state.downPos.y) > 9) {
    state.moved = true;
  }
  if (state.dragSeed) {
    state.dragSeed.x = p.x;
    state.dragSeed.y = p.y;
  } else if (state.tool === TOOLS.WATER && performance.now() - state.lastPourAt > 240) {
    pourWater(p.x, p.y);
    state.lastPourAt = performance.now();
  } else if (state.tool === TOOLS.BUBBLE && performance.now() - state.lastPourAt > 300) {
    blowBubbles(p.x, p.y);
    state.lastPourAt = performance.now();
  }
});

function endPointer(e) {
  if (e.pointerId !== state.pointerId) return;
  state.pointerId = null;
  if (state.dragSeed) state.dragSeed.dragging = false;

  // 種をちょんと触った（動かさなかった）→ 選んでいる色に変身
  if (state.downSeed && !state.moved && state.downSeed.colorIdx !== state.colorIdx) {
    state.downSeed.colorIdx = state.colorIdx;
    state.downSeed.jiggle = 1;
    particles.burst(state.downSeed.x, state.downSeed.y, COLORS[state.colorIdx].hex, 12, 80);
    sound.recolor();
  }
  state.dragSeed = null;
  state.downSeed = null;
  state.downPos = null;
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
window.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- メインループ ----

let lastT = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const t = now / 1000;

  seedBox.update(dt);
  state.globalJiggle = Math.max(0, state.globalJiggle - dt * 0.5);

  field.compute(seedBox.seeds, t, state.globalJiggle);

  // 領域同士が新しくぶつかった → キラキラ＋チャイム
  for (const ev of field.contactEvents) {
    particles.burst(ev.x, ev.y, '#ffffff', 8, 60);
    particles.ring(ev.x, ev.y, 'rgba(255,255,255,0.9)', 52);
    for (let i = 0; i < 5; i++) particles.sparkle(ev.x, ev.y, '#fffbe0');
    if (t - state.lastContactSound > 0.3) {
      sound.contact(ev.aColor, ev.bColor);
      state.lastContactSound = t;
    }
  }

  // 境目は いつも少しキラキラ
  if (field.boundaryCount > 0 && Math.random() < Math.min(0.5, field.boundaryCount / 260)) {
    const c = field.randomBoundaryCell();
    if (c) particles.sparkle(c.x, c.y, '#ffffff');
  }

  decor.update(dt, field, seedBox.seeds, particles);
  particles.update(dt);

  // ---- 描画 ----
  ctx.clearRect(0, 0, state.w, state.h);
  ctx.imageSmoothingEnabled = true;
  // 低解像度グリッドのカクつきを軽いブラーで溶かして、ゼリーらしい縁にする
  ctx.filter = 'blur(2.5px)';
  ctx.drawImage(field.canvas, -3, -3, state.w + 6, state.h + 6);
  ctx.filter = 'none';
  decor.draw(ctx, t);
  seedBox.draw(ctx, t);
  particles.draw(ctx);
  if (!state.placedOnce && seedBox.seeds.length === 0) drawHint(t);

  requestAnimationFrame(frame);
}

// 最初のヒント: 画面のまんなかで「ここを ちょん」と誘う指マーク
function drawHint(t) {
  const x = state.w / 2;
  const y = state.h * 0.42;
  const pulse = (t % 1.6) / 1.6;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 0.55 * (1 - pulse));
  ctx.strokeStyle = COLORS[state.colorIdx].hex;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(x, y, 18 + pulse * 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = COLORS[state.colorIdx].hex;
  ctx.beginPath();
  ctx.arc(x, y, SEED.DRAW_R * (1 + Math.sin(t * 3) * 0.1), 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '44px sans-serif';
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.9;
  ctx.fillText('👆', x, y + 84 + Math.sin(t * 3.2) * 7);
  ctx.restore();
}

resize();
requestAnimationFrame(frame);
