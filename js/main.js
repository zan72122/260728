// js/main.js — Agent F
// 状態機械 + ゲームループ + 全モジュールの結線。
// SPEC.md に書かれた export 名・シグネチャだけを信頼して結線する。

import { DoughModel } from './dough/model.js';
import { renderDough } from './dough/render.js';
import { GestureController } from './input/gestures.js';
import { FermentStage, CookStage } from './game/stages.js';
import { Sound } from './audio/sound.js';
import { BREADS, getBread } from './game/breads.js';
import { Forest } from './game/forest.js';
import { HUD } from './ui/hud.js';

// ---------------------------------------------------------------------
// 状態
// ---------------------------------------------------------------------

let canvas, ctx;
let W = window.innerWidth, H = window.innerHeight, dpr = 1;
let R0 = Math.min(W, H) * 0.26;
let originalCenter = { x: W / 2, y: H * 0.45 };

let hud = null;
let gestures = null;
let forest = null;

let dough = null;
let currentBreadId = 'shokupan';

/** mode: 'play' | 'forest' */
let mode = 'play';
/** stage: 'shape' | 'ferment' | 'cook' | 'done' */
let stage = 'shape';
/** tool: 'hand' | 'piping' | 'pattern' */
let tool = 'hand';

let fermentStage = null;
let fermentElapsed = 0;
let cookStage = null;

let currentFillingIndex = 0;
let hasRounded = false;

let grabbing = false;
let dragOrigin = { x: 0, y: 0 };
let draggingFromDough = false;
let holePressActive = false;
let holePressX = 0, holePressY = 0;

let forestAutoReturn = false;
let forestTimer = 0;

let soundInited = false;

let lastTime = 0;
let rafId = 0;
let running = true;

const lastSfxAt = Object.create(null);

// ---------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------

function dist(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// 連打制限つきの効果音再生（同種音は最短80ms間隔）。
function sfx(name, opts) {
  const now = performance.now();
  const last = lastSfxAt[name] || 0;
  if (now - last < 80) return;
  lastSfxAt[name] = now;
  try { Sound.sfx(name, opts || {}); } catch (e) { /* 無音でも続行 */ }
}

function sfxTap() {
  sfx('tap', { gain: 0.4 });
}

function currentBread() {
  return getBread(currentBreadId) || BREADS[0];
}

function ensureSoundInit() {
  if (soundInited) return;
  soundInited = true;
  try { Sound.init(); } catch (e) { /* 失敗しても続行 */ }
}

// ---------------------------------------------------------------------
// 生地のライフサイクル
// ---------------------------------------------------------------------

function selectBread(breadId) {
  const bread = getBread(breadId) || BREADS[0];
  currentBreadId = bread.id;

  dough = new DoughModel(bread.presetId);
  dough.center.x = originalCenter.x;
  dough.center.y = originalCenter.y;

  stage = 'shape';
  tool = 'hand';
  currentFillingIndex = 0;
  hasRounded = false;
  grabbing = false;
  draggingFromDough = false;
  holePressActive = false;

  fermentStage = null;
  fermentElapsed = 0;
  cookStage = null;

  if (hud) {
    hud.setCurrentBread(currentBreadId);
    hud.setStage('shape');
    hud.setTool('hand');
    hud.setToppingReady(false);
    hud.showHint(bread.hint || '');
  }
}

function startCooking(method) {
  try { cookStage = new CookStage(dough, method); } catch (e) { cookStage = null; return; }
  stage = 'cook';
  grabbing = false;
  if (hud) hud.setStage('cook');
}

function finishCooking() {
  stage = 'done';
  cookStage = null;
  if (hud) hud.setStage('done');
  sfx('sparkle', { gain: 0.5 });
  if (hud) hud.celebrate();
}

function onCoverPressed() {
  sfxTap();
  if (stage === 'shape') {
    try { fermentStage = new FermentStage(dough); } catch (e) { fermentStage = null; return; }
    fermentElapsed = 0;
    stage = 'ferment';
    if (hud) { hud.setStage('ferment'); hud.coverOn(); }
  } else if (stage === 'ferment') {
    endFerment();
  }
}

function endFerment() {
  if (fermentStage) {
    try { fermentStage.finish(); } catch (e) { /* noop */ }
  }
  fermentStage = null;
  stage = 'shape';
  if (hud) { hud.setStage('shape'); hud.coverOff(); }
  sfx('airout', { gain: 0.3 });
}

function onToppingPressed() {
  if (!dough || dough.topping) return;
  sfxTap();
  try { dough.applyTopping(); } catch (e) { return; }
  if (hud) {
    hud.setToppingReady(false);
    tool = 'pattern';
    hud.setTool('pattern');
    hud.showHint('もようを かこう');
  }
}

function placeToForest() {
  if (!dough) return;
  let snap = null;
  try { snap = dough.snapshot(); } catch (e) { snap = null; }
  if (snap && forest) {
    try { forest.place(currentBreadId, snap); } catch (e) { /* noop */ }
    try { forest.save(); } catch (e) { /* noop */ }
  }
  sfx('place', { gain: 0.6 });
  mode = 'forest';
  forestAutoReturn = true;
  forestTimer = 2.5;
  if (gestures) gestures.setEnabled(false);
  if (hud) hud.setMode('forest');
}

function returnToPlay() {
  mode = 'play';
  if (gestures) gestures.setEnabled(true);
  if (hud) hud.setMode('play');
}

function returnToPlayWithNewDough() {
  returnToPlay();
  selectBread(currentBreadId);
}

function enterForestManual() {
  sfxTap();
  mode = 'forest';
  forestAutoReturn = false;
  if (gestures) gestures.setEnabled(false);
  if (hud) hud.setMode('forest');
}

function backToPlayManual() {
  sfxTap();
  returnToPlay();
}

function onSelectTool(newTool) {
  sfxTap();
  const bread = currentBread();
  if (newTool === tool && newTool === 'piping' && bread.fillings && bread.fillings.length > 1) {
    currentFillingIndex = (currentFillingIndex + 1) % bread.fillings.length;
    if (hud) hud.setPipingFilling(bread.fillings[currentFillingIndex]);
    return;
  }
  tool = newTool;
  if (hud) hud.setTool(tool);
  if (tool === 'piping') {
    currentFillingIndex = 0;
    if (hud) hud.setPipingFilling((bread.fillings && bread.fillings[0]) || null);
  }
}

// ---------------------------------------------------------------------
// ジェスチャ結線
// ---------------------------------------------------------------------

function onGesture(evt) {
  ensureSoundInit();
  if (mode !== 'play' || !dough) return;
  const bread = currentBread();

  switch (evt.type) {
    case 'press': {
      if (stage === 'shape' || stage === 'done') {
        try { dough.poke(evt.x, evt.y, stage === 'done' ? 0.35 : 0.6); } catch (e) {}
        sfx('squish', { gain: 0.5 });
      }
      if (stage === 'shape') {
        dragOrigin.x = evt.x; dragOrigin.y = evt.y;
        draggingFromDough = tool === 'hand' && dist(evt.x, evt.y, dough.center.x, dough.center.y) <= R0 * 1.3;
        if (tool === 'hand' && bread.presetId === 'donut' &&
            dist(evt.x, evt.y, dough.center.x, dough.center.y) < R0 * 0.35) {
          holePressActive = true;
          holePressX = evt.x; holePressY = evt.y;
        } else {
          holePressActive = false;
        }
      }
      break;
    }
    case 'pressHold': {
      if (stage === 'shape' && tool === 'piping' && bread.fillings && bread.fillings.length) {
        const type = bread.fillings[currentFillingIndex] || bread.fillings[0];
        try { dough.addFilling(type, evt.x, evt.y, 0.09); } catch (e) {}
        sfx('pop', { gain: 0.4 });
      }
      if (stage === 'shape' && holePressActive) {
        try { dough.pokeHole(holePressX, holePressY); } catch (e) {}
      }
      break;
    }
    case 'move': {
      if (stage === 'shape' && draggingFromDough && !cookStage) {
        const oz = hud ? hud.getOvenZone() : null;
        if (oz && oz.w > 0 && evt.x >= oz.x && evt.x <= oz.x + oz.w &&
            evt.y >= oz.y && evt.y <= oz.y + oz.h) {
          draggingFromDough = false;
          startCooking(bread.method);
        }
      }
      break;
    }
    case 'stretch': {
      if (stage !== 'shape') break;
      if (!grabbing) {
        try { dough.grabStart(evt.x, evt.y); } catch (e) {}
        grabbing = true;
      }
      try { dough.grabMove(evt.x, evt.y, evt.dx, evt.dy); } catch (e) {}
      const speed = Math.hypot(evt.dx, evt.dy);
      const rate = clamp(0.85 + speed * 0.015, 0.7, 1.7);
      sfx('stretchy', { rate });
      break;
    }
    case 'knead': {
      if (stage !== 'shape') break;
      try { dough.knead(evt.x, evt.y, evt.intensity); } catch (e) {}
      sfx('squish', { gain: 0.6 });
      break;
    }
    case 'fold': {
      if (stage !== 'shape') break;
      try { dough.fold(evt.angle); } catch (e) {}
      sfx('squish', { gain: 0.4 });
      break;
    }
    case 'round': {
      if (stage !== 'shape') break;
      try { dough.roundUp(evt.quality); } catch (e) {}
      if (!hasRounded) {
        hasRounded = true;
        if (hud && bread.toppingable && !dough.topping) hud.setToppingReady(true);
      }
      break;
    }
    case 'elongate': {
      if (stage !== 'shape') break;
      try { dough.elongate(evt.angle, evt.length); } catch (e) {}
      break;
    }
    case 'twist': {
      if (stage !== 'shape') break;
      try { dough.twist(evt.delta); } catch (e) {}
      break;
    }
    case 'stroke': {
      if (stage !== 'shape') break;
      if (tool === 'pattern' || (bread.toppingable && dough.topping)) {
        try { dough.addPattern(evt.points); } catch (e) {}
      }
      break;
    }
    case 'release': {
      if (stage === 'shape' && grabbing) {
        try { dough.grabEnd(); } catch (e) {}
        grabbing = false;
        sfx('stretchy', { rate: 1.0 });
      }
      holePressActive = false;
      break;
    }
    default:
      break;
  }
}

function onCanvasPointerDown() {
  ensureSoundInit();
  if (mode !== 'forest') return;
  if (forestAutoReturn) {
    returnToPlayWithNewDough();
  } else {
    returnToPlay();
  }
}

// ---------------------------------------------------------------------
// 更新
// ---------------------------------------------------------------------

function update(dt) {
  if (mode === 'play') {
    if (dough) {
      try { dough.update(dt); } catch (e) { /* 1フレームの失敗でループを止めない */ }

      let target = originalCenter;
      if (stage === 'cook' && hud) {
        const oz = hud.getOvenZone();
        if (oz && oz.w > 0) target = { x: oz.x + oz.w / 2, y: oz.y + oz.h / 2 };
      }
      const lerp = Math.min(1, dt * 3.2);
      dough.center.x += (target.x - dough.center.x) * lerp;
      dough.center.y += (target.y - dough.center.y) * lerp;
    }

    if (stage === 'ferment' && fermentStage) {
      try { fermentStage.update(dt); } catch (e) {}
      fermentElapsed += dt;
      if (fermentElapsed >= 20) {
        endFerment();
      }
    }

    if (stage === 'cook' && cookStage) {
      try { cookStage.update(dt); } catch (e) {}
      if (cookStage.done) {
        finishCooking();
      }
    }
  } else if (mode === 'forest') {
    if (forestAutoReturn) {
      forestTimer -= dt;
      if (forestTimer <= 0) {
        returnToPlayWithNewDough();
      }
    }
  }
}

// ---------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------

function drawOvenWindow(t) {
  if (!hud) return;
  const oz = hud.getOvenZone();
  if (!oz || oz.w <= 0) return;
  const cx = oz.x + oz.w / 2;
  const cy = oz.y + oz.h / 2;
  const r = Math.max(oz.w, oz.h) * 1.4;
  const g = ctx.createRadialGradient(cx, cy, r * 0.08, cx, cy, r);
  g.addColorStop(0, 'rgba(255,176,90,0.32)');
  g.addColorStop(1, 'rgba(255,176,90,0)');
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function render(t) {
  ctx.clearRect(0, 0, W, H);

  if (mode === 'forest') {
    try { forest.render(ctx, W, H, t); } catch (e) {}
    return;
  }

  try { forest.renderBackdrop(ctx, W, H, t); } catch (e) {}

  if (stage === 'cook') {
    try { drawOvenWindow(t); } catch (e) {}
  }

  if (dough) {
    const method = currentBread().method;
    try {
      renderDough(ctx, dough, t, {
        frying: stage === 'cook' && method === 'fry',
        steaming: stage === 'cook' && method === 'steam',
        inOven: stage === 'cook' && method === 'bake',
      });
    } catch (e) { /* 描画失敗でもループは止めない */ }
  }
}

// ---------------------------------------------------------------------
// ループ / リサイズ / 可視性
// ---------------------------------------------------------------------

function loop(now) {
  if (!running) return;
  rafId = requestAnimationFrame(loop);
  try {
    const dt = Math.min((now - lastTime) / 1000, 0.033);
    lastTime = now;
    update(dt);
    render(now / 1000);
  } catch (e) {
    // 1フレームの例外でループを止めない
    // eslint-disable-next-line no-console
    console.error(e);
  }
}

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  dpr = window.devicePixelRatio || 1;
  R0 = Math.min(W, H) * 0.26;
  originalCenter = { x: W / 2, y: H * 0.45 };

  canvas.width = Math.max(1, Math.round(W * dpr));
  canvas.height = Math.max(1, Math.round(H * dpr));
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (dough && stage !== 'cook') {
    dough.center.x = originalCenter.x;
    dough.center.y = originalCenter.y;
  }
}

function onVisibilityChange() {
  if (document.hidden) {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
  } else if (!running) {
    running = true;
    lastTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }
}

// ---------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------

function boot() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');

  forest = new Forest();
  try { forest.load(); } catch (e) { /* 初回は何もない */ }

  hud = new HUD(document.getElementById('hud'), {
    onSelectBread: (breadId) => { sfxTap(); selectBread(breadId); },
    onSelectTool,
    onCover: onCoverPressed,
    onToForest: enterForestManual,
    onBackToPlay: backToPlayManual,
    onNewDough: () => { sfxTap(); selectBread(currentBreadId); },
    onTopping: onToppingPressed,
    onPlaceToForest: placeToForest,
  });
  hud.setBreads(BREADS);

  resize();

  gestures = new GestureController(canvas, onGesture);
  canvas.addEventListener('pointerdown', onCanvasPointerDown);

  selectBread('shokupan');

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  document.addEventListener('visibilitychange', onVisibilityChange);

  lastTime = performance.now();
  running = true;
  rafId = requestAnimationFrame(loop);
}

boot();
