// js/main.js — Agent L (WebGL 2.5D 描画刷新の統合。元 Agent F の状態機械を維持)
// 状態機械 + ゲームループ + 全モジュールの結線。
// SPEC.md / SPEC-GL.md に書かれた export 名・シグネチャだけを信頼して結線する。
//
// canvas 3枚構成 (SPEC-GL): #bg(2D遠景/オーブン暖色/森) → #game(WebGL生地。失敗時2Dフォールバック) → #fx(2Dパーティクル、最前面。GestureController接続)。
// js/gl/mesh.js・js/gl/glrenderer.js・js/fx/particles.js は他エージェントが並行実装中のため
// 動的 import + try/catch で結線し、無い/失敗する場合は従来の 2D 単一パイプライン (renderDough) へ
// フォールバックする。URLパラメータ ?force2d=1 で強制的に2Dフォールバックにできる。

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

// canvas 3枚 (#bg / #game / #fx) とそれぞれの 2D コンテキスト。
// #game は WebGL 有効時は gameCtx を使わず glr/mesh 経由で描く。
let bgCanvas, bgCtx;
let gameCanvas, gameCtx; // gameCtx は 2D フォールバック時のみ使用
let fxCanvas, fxCtx;

let W = window.innerWidth, H = window.innerHeight, dpr = 1;
let R0 = Math.min(W, H) * 0.26;
let originalCenter = { x: W / 2, y: H * 0.45 };

// --- WebGL パイプライン (Agent J: mesh.js / Agent K: glrenderer.js) ---
let glEnabled = false; // GL 初期化に成功したか (__game.gl で公開)
let glr = null;        // GLDoughRenderer インスタンス
let mesh = null;       // DoughMesh インスタンス
const FORCE_2D = (() => {
  try {
    return new URLSearchParams(window.location.search).get('force2d') === '1';
  } catch (e) {
    return false;
  }
})();

// --- FX パーティクル (Agent M: js/fx/particles.js) ---
let fx = null;
let fxEmitTimer = 0; // steam/oilbubble の間欠発生タイマー

// 焼成完了フレームでの生地キャプチャ (森へ運ぶ画像)
let captureOnNextRender = false;
let bakedSnapshotImage = null; // { url, w, h } | null

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

// FxSystem (Agent M, js/fx/particles.js) への発火。未実装/失敗時は何もしない。
function emitFx(name, x, y, opts) {
  if (!fx) return;
  try { fx.emit(name, x, y, opts || {}); } catch (e) { /* FX 失敗でもゲームは続行 */ }
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

  // 新しい生地に切り替えたら、前の生地の焼成キャプチャ待ちは破棄する
  captureOnNextRender = false;
  bakedSnapshotImage = null;

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
  // 焼成完了フレームで glr.render 直後に captureRegion する (SPEC-GL 3)。
  // フォールバック(2D)時は image 無しのまま従来動作。
  bakedSnapshotImage = null;
  captureOnNextRender = glEnabled;
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
  if (snap && bakedSnapshotImage && bakedSnapshotImage.url) {
    // 焼成完了フレームで捕えた GL レンダリング画像を森のスナップショットへ添付する。
    snap.image = bakedSnapshotImage.url;
    snap.imageW = bakedSnapshotImage.w;
    snap.imageH = bakedSnapshotImage.h;
  }
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
        emitFx('poff', evt.x, evt.y);
      }
      if (stage === 'shape') {
        dragOrigin.x = evt.x; dragOrigin.y = evt.y;
        // バグ修正(機能QA): tool が piping/pattern でもオーブンへのドラッグ判定に到達できるよう、
        // ツール種別に関わらず「生地中心付近から掴んだか」だけで判定する。
        // (絞り器のpressHold注入・模様描きの stroke とは別チャンネルの判定なので共存できる)
        draggingFromDough = dist(evt.x, evt.y, dough.center.x, dough.center.y) <= R0 * 1.3;
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
      emitFx('flour', evt.x, evt.y);
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

    // FX 結線: steaming→steam / frying→oilbubble (SPEC-GL 3)。
    // stages.js の dough.bubbles は 2D フォールバック(renderDough)が既に描くため、
    // 二重演出を避けて GL 有効時のみ FX パーティクルで補う。
    if (fx && glEnabled && stage === 'cook' && dough) {
      const method = currentBread().method;
      if (method === 'steam' || method === 'fry') {
        fxEmitTimer -= dt;
        if (fxEmitTimer <= 0) {
          if (method === 'steam') {
            emitFx('steam', dough.center.x, dough.center.y - R0 * 0.55);
            fxEmitTimer = 0.22 + Math.random() * 0.18;
          } else {
            const ang = Math.random() * Math.PI * 2;
            const ex = dough.center.x + Math.cos(ang) * R0 * 0.85;
            const ey = dough.center.y + Math.sin(ang) * R0 * 0.5;
            emitFx('oilbubble', ex, ey);
            fxEmitTimer = 0.09 + Math.random() * 0.08;
          }
        }
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

  if (fx) {
    try { fx.update(dt); } catch (e) { /* FX 失敗でもゲームは続行 */ }
  }
}

// ---------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------

// オーブン暖色ビネットは #bg (2D) 側に描く (SPEC-GL: 「#bg … オーブン暖色ビネット」)。
function drawOvenWindow(t) {
  if (!hud) return;
  const oz = hud.getOvenZone();
  if (!oz || oz.w <= 0) return;
  const cx = oz.x + oz.w / 2;
  const cy = oz.y + oz.h / 2;
  const r = Math.max(oz.w, oz.h) * 1.4;
  const g = bgCtx.createRadialGradient(cx, cy, r * 0.08, cx, cy, r);
  g.addColorStop(0, 'rgba(255,176,90,0.32)');
  g.addColorStop(1, 'rgba(255,176,90,0)');
  bgCtx.save();
  bgCtx.fillStyle = g;
  bgCtx.fillRect(0, 0, W, H);
  bgCtx.restore();
}

// 生地の輪郭バウンディングボックス (+ 余白20%) を CSS px で計算。captureRegion 用。
function computeDoughCaptureBox(d) {
  let maxR = (d && d.R0) || R0 || 100;
  if (d && Array.isArray(d.points)) {
    for (let i = 0; i < d.points.length; i++) {
      const pt = d.points[i];
      if (!pt) continue;
      const rr = Math.hypot((pt.x || 0) - d.center.x, (pt.y || 0) - d.center.y);
      if (rr > maxR) maxR = rr;
    }
  }
  const size = Math.max(4, maxR * 2 * 1.2); // 余白20%
  return { cx: d.center.x, cy: d.center.y, w: size, h: size };
}

function render(t) {
  if (mode === 'forest') {
    // 森ビュー: bg に forest.render。GL/フォールバックの生地canvasは非表示にする。
    if (gameCanvas) gameCanvas.style.visibility = 'hidden';
    if (fxCtx) fxCtx.clearRect(0, 0, W, H);
    bgCtx.clearRect(0, 0, W, H);
    try { forest.render(bgCtx, W, H, t); } catch (e) {}
    return;
  }
  if (gameCanvas) gameCanvas.style.visibility = 'visible';

  bgCtx.clearRect(0, 0, W, H);
  try { forest.renderBackdrop(bgCtx, W, H, t); } catch (e) {}

  if (stage === 'cook') {
    try { drawOvenWindow(t); } catch (e) {}
  }

  if (dough) {
    const method = currentBread().method;
    const opts = {
      frying: stage === 'cook' && method === 'fry',
      steaming: stage === 'cook' && method === 'steam',
      inOven: stage === 'cook' && method === 'bake',
    };

    if (glEnabled && glr && mesh) {
      try {
        mesh.update(dough, t);
        glr.render(dough, mesh, t, opts);

        // 焼成完了フレーム: glr.render 直後に同期でキャプチャする (SPEC-GL 3)。
        if (captureOnNextRender) {
          captureOnNextRender = false;
          try {
            const box = computeDoughCaptureBox(dough);
            const cap = glr.captureRegion(box.cx, box.cy, box.w, box.h);
            if (cap && cap.url) {
              // 実寸(CSS px)で保存し、森側では scale だけで縮小する (render.js の方式に合わせる)。
              bakedSnapshotImage = { url: cap.url, w: box.w, h: box.h };
            }
          } catch (e) { /* キャプチャ失敗時は image 無しの従来動作にフォールバック */ }
        }
      } catch (e) {
        // GL 描画が実行時に破綻した場合も、以後は 2D フォールバックへ切り替えてゲームを止めない。
        glEnabled = false;
        try { gameCtx = gameCanvas.getContext('2d'); } catch (e2) { gameCtx = null; }
        if (gameCtx) sizeCanvas2D(gameCanvas, gameCtx, W, H, dpr);
      }
    } else if (gameCtx) {
      try { renderDough(gameCtx, dough, t, opts); } catch (e) { /* 描画失敗でもループは止めない */ }
    }
  }

  if (fxCtx) {
    fxCtx.clearRect(0, 0, W, H);
    if (fx) {
      try { fx.render(fxCtx); } catch (e) { /* FX 描画失敗でもループは止めない */ }
    }
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

// CSS ピクセル座標で統一するため dpr 分だけ setTransform した 2D canvas を張り直す。
function sizeCanvas2D(cv, cctx, w, h, ratio) {
  if (!cv) return;
  cv.width = Math.max(1, Math.round(w * ratio));
  cv.height = Math.max(1, Math.round(h * ratio));
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  if (cctx) cctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  dpr = window.devicePixelRatio || 1;
  R0 = Math.min(W, H) * 0.26;
  originalCenter = { x: W / 2, y: H * 0.45 };

  sizeCanvas2D(bgCanvas, bgCtx, W, H, dpr);
  sizeCanvas2D(fxCanvas, fxCtx, W, H, dpr);

  if (glEnabled && glr) {
    try { glr.resize(W, H, dpr); } catch (e) { /* リサイズ失敗はフレーム描画側の try/catch で吸収 */ }
  } else {
    sizeCanvas2D(gameCanvas, gameCtx, W, H, dpr);
  }

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
// GL / FX 初期化 (並行実装モジュール。無い/失敗する場合は必ずフォールバックする)
// ---------------------------------------------------------------------

// GL 初期化: js/gl/mesh.js + js/gl/glrenderer.js を動的 import。
// ファイルが存在しない・import が失敗する・コンストラクタが throw する、
// いずれの場合も 2D フォールバック (gameCtx) へ切り替える。
async function initRenderer() {
  if (!FORCE_2D) {
    try {
      const [meshMod, glMod] = await Promise.all([
        import('./gl/mesh.js'),
        import('./gl/glrenderer.js'),
      ]);
      const DoughMesh = meshMod && meshMod.DoughMesh;
      const GLDoughRenderer = glMod && glMod.GLDoughRenderer;
      if (typeof DoughMesh !== 'function' || typeof GLDoughRenderer !== 'function') {
        throw new Error('gl module missing expected export');
      }
      glr = new GLDoughRenderer(gameCanvas);
      mesh = new DoughMesh(26, 64);
      glEnabled = true;
    } catch (e) {
      glr = null;
      mesh = null;
      glEnabled = false;
    }
  }
  if (!glEnabled) {
    try { gameCtx = gameCanvas.getContext('2d'); } catch (e) { gameCtx = null; }
  }
}

// FX パーティクル: js/fx/particles.js を動的 import。無くても遊べる (演出が無いだけ)。
async function initFx() {
  try {
    const fxMod = await import('./fx/particles.js');
    const FxSystem = fxMod && fxMod.FxSystem;
    if (typeof FxSystem !== 'function') throw new Error('fx module missing expected export');
    fx = new FxSystem();
  } catch (e) {
    fx = null;
  }
}

// ---------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------

async function boot() {
  bgCanvas = document.getElementById('bg');
  gameCanvas = document.getElementById('game');
  fxCanvas = document.getElementById('fx');

  bgCtx = bgCanvas.getContext('2d');
  fxCtx = fxCanvas.getContext('2d');
  // gameCtx は initRenderer() が GL 失敗時にのみ生成する
  // (先に 2d コンテキストを確定させると同一 canvas から webgl が取得できなくなるため)。

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

  // GestureController は最前面の #fx へ接続する (SPEC-GL: pointer はここに落ちる)。
  gestures = new GestureController(fxCanvas, onGesture);
  fxCanvas.addEventListener('pointerdown', onCanvasPointerDown);
  // HUDボタン等、canvas以外への最初のタップでも音を初期化できるようにする
  // （SPEC: 「最初のユーザー操作で呼ばれる」。1度発火したら自動で外れる）。
  document.addEventListener('pointerdown', ensureSoundInit, { once: true, capture: true });

  // GL/FX の初期化を待ってから最初のリサイズ/描画を行う。ローカル同一オリジンの
  // 動的 import は高速なため、「起動から1秒以内に触れる」目標には影響しない。
  try { await initRenderer(); } catch (e) { glEnabled = false; }
  try { await initFx(); } catch (e) { fx = null; }

  resize();

  selectBread('shokupan');

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  document.addEventListener('visibilitychange', onVisibilityChange);

  lastTime = performance.now();
  running = true;
  rafId = requestAnimationFrame(loop);

  // デバッグ/統合テスト用フック（本番挙動には影響しない）
  window.__game = {
    get dough() { return dough; },
    get mode() { return mode; },
    get stage() { return stage; },
    get tool() { return tool; },
    get currentBreadId() { return currentBreadId; },
    get forest() { return forest; },
    get hud() { return hud; },
    get gl() { return glEnabled; },
  };
}

boot();
