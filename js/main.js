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
import { GuideBar, Voice } from './ui/guide.js';
import { GhostHand } from './ui/ghosthand.js';

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
// バグ修正(監督QA バグ2): done 遷移直後は生地がまだオーブン付近で縮小表示中のため、
// 中央へ戻り等倍に近づくまで待ってからキャプチャする (秒。<=0 で無効)。
let captureSettleTimer = -1;
const CAPTURE_SETTLE_SEC = 1.0;

let hud = null;
let gestures = null;
let forest = null;

let dough = null;
let currentBreadId = 'shokupan';

// --- バグ修正(監督QA バグ2): 焼成中は生地をオーブン窓に収まるサイズへ縮小表示し、
// done 遷移で中央・等倍へふわりと戻す (dough.setScale を使用)。---
let doughScale = 1;
const OVEN_DISPLAY_SCALE = 0.5;

// --- ガイドシステム統合 (SPEC-GUIDE: Agent P=js/ui/guide.js, Agent Q=js/ui/ghosthand.js) ---
let guide = null;   // GuideBar
let ghost = null;   // GhostHand
const GHOST_PERIOD = { knead: 2.0, tap: 1.6, drag: 2.2, circle: 2.4, stretch: 2.2 };
const TUT_KEY = 'panmori-tut-v1';

let interactionScore = 0; // shape中のジェスチャ回数 (press=1点, knead=2点, その他=1点/1操作)
const gestureCounted = { knead: false, stretch: false, fold: false, round: false, elongate: false, twist: false };
let shapeElapsed = 0;          // 現在の生地が shape に入ってからの経過秒 (rest 20秒解禁の代替条件)
let restUnlocked = false;
let cookUnlocked = false;
let postRestShapeTouches = 0;  // rest解禁後、発酵をスキップして shape でさらに触れた回数

let idleTimer = 0;             // 最後の操作からの経過秒 (ゴーストハンド 8秒無操作判定)
let ghostCooldownTimer = 0;    // ゴーストハンドの休止時間 (2ループ再生後 15秒)
let ghostPlayType = '';
let ghostPlayElapsed = 0;

let tutorialActive = false;    // 初回チュートリアル未完了か (localStorage 'panmori-tut-v1')
let tutorialKneadPending = false;
let tutorialKneadTimer = 3;    // 起動3秒後に先行こねこね実演

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
// ガイドシステム (SPEC-GUIDE Agent R 統合)
// ---------------------------------------------------------------------

const UNLOCK_LINES = {
  rest: 'こねこね じょうず！ つぎは ぬのを かけて ねかせよう',
  cook: 'ふっくら してきた！ オーブンで やいてみよう',
  forest: 'やきたて できあがり！ もりに おいてあげよう',
};

const WIGGLE_LINES = {
  rest: 'もうすこし こねこね してみよう',
  cook: 'ぬのをかけて ねかせるか、もうすこし さわってみよう',
  forest: 'やけたら もりへ いこうね',
};

// 未解禁アイコンをタップされた時、生地がぷるんと震える軽いリアクション
function wiggleDough() {
  if (!dough) return;
  try { dough.poke(dough.center.x, dough.center.y, 0.1); } catch (e) { /* noop */ }
}

// ゴーストハンドの実演スクリプトを、現在の画面レイアウトから組み立てる
function ghostScriptFor(kind) {
  if (!dough) return null;
  if (kind === 'knead') {
    return { type: 'knead', x: dough.center.x, y: dough.center.y, r: R0 * 0.32 };
  }
  if (kind === 'tap-rest') {
    const r = guide ? guide.highlightRect('rest') : null;
    if (!r || !r.w) return null;
    return { type: 'tap', x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }
  if (kind === 'drag-cook') {
    const oz = hud ? hud.getOvenZone() : null;
    if (!oz || !oz.w) return null;
    return { type: 'drag', fromX: dough.center.x, fromY: dough.center.y, toX: oz.x + oz.w / 2, toY: oz.y + oz.h / 2 };
  }
  if (kind === 'tap-forest') {
    const r = hud ? hud.getPlaceButtonRect() : null;
    if (!r || !r.w) return null;
    return { type: 'tap', x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }
  return null;
}

// ゴーストハンドを再生し、ループ回数/クールダウン計測用の内部状態をリセットする
function playGhost(kind) {
  if (!ghost) return false;
  const script = ghostScriptFor(kind);
  if (!script) return false;
  try { ghost.play(script); } catch (e) { return false; }
  ghostPlayType = script.type;
  ghostPlayElapsed = 0;
  idleTimer = 0;
  ghostCooldownTimer = 0;
  return true;
}

// 進行条件が解禁された瞬間に1回だけ呼ばれる: 光る誘導 + 声かけ + (初回のみ)即ゴースト実演
function onGuideUnlock(step) {
  if (guide) { try { guide.setReady(step, true); } catch (e) {} }
  const line = UNLOCK_LINES[step];
  if (line) { try { Voice.say(line); } catch (e) {} }
  if (tutorialActive) {
    const kindMap = { rest: 'tap-rest', cook: 'drag-cook', forest: 'tap-forest' };
    if (kindMap[step]) playGhost(kindMap[step]);
  }
}

// GuideBar のアイコンタップ (タップ代替経路 + 未解禁時のぷるぷる拒否)
function onGuideStepTap(stepId) {
  if (!guide || !dough) return;
  if (stepId === 'knead') return; // 常に触れられる段階なので特別な処理は無い
  if (stepId === 'rest') {
    if (stage === 'shape' && restUnlocked) {
      onCoverPressed();
    } else if (stage === 'ferment') {
      onCoverPressed(); // 布ボタンと同じ: もう一度タップで発酵終了
    } else {
      guide.wiggle('rest'); try { Voice.say(WIGGLE_LINES.rest); } catch (e) {} wiggleDough();
    }
    return;
  }
  if (stepId === 'cook') {
    if ((stage === 'shape' || stage === 'ferment') && cookUnlocked) {
      flyToOven();
    } else {
      guide.wiggle('cook'); try { Voice.say(WIGGLE_LINES.cook); } catch (e) {} wiggleDough();
    }
    return;
  }
  if (stepId === 'forest') {
    if (stage === 'done') {
      placeToForest();
    } else {
      guide.wiggle('forest'); try { Voice.say(WIGGLE_LINES.forest); } catch (e) {} wiggleDough();
    }
    return;
  }
}

// 🔥/🍳/♨️ タップ代替経路: 生地がふわりとオーブンへ飛んで焼成開始。
// 実際の移動アニメーションは update() の center/scale lerp (bug2 修正) がそのまま
// 「ふわり」としたイージング移動を担う。
function flyToOven() {
  sfxTap();
  const bread = currentBread();
  if (fermentStage) {
    try { fermentStage.finish(); } catch (e) { /* noop */ }
    fermentStage = null;
  }
  startCooking(bread.method);
}

// ゴーストハンドの無操作トリガー + 初回チュートリアル先行実演
function updateGhostIdle(dt) {
  if (!ghost) return;

  if (tutorialKneadPending) {
    tutorialKneadTimer -= dt;
    if (tutorialKneadTimer <= 0) {
      tutorialKneadPending = false;
      if (mode === 'play' && dough) {
        if (playGhost('knead')) { try { Voice.say('ゆびで こねこね してみよう'); } catch (e) {} }
      }
    }
  }

  try { ghost.update(dt); } catch (e) { /* ゴーストハンド失敗でもゲームは続行 */ }

  if (ghost.active) {
    ghostPlayElapsed += dt;
    const per = GHOST_PERIOD[ghostPlayType] || 2.0;
    if (ghostPlayElapsed >= per * 2) {
      try { ghost.stop(); } catch (e) {}
      ghostCooldownTimer = 15; // 2ループ再生したら15秒休む (うるさくしない)
    }
    return;
  }

  if (ghostCooldownTimer > 0) {
    ghostCooldownTimer -= dt;
    return;
  }

  if (mode !== 'play' || !dough) return;

  idleTimer += dt;
  if (idleTimer < 8) return;

  let kind = null;
  if (stage === 'shape') {
    if (cookUnlocked) kind = 'drag-cook';
    else if (restUnlocked) kind = 'tap-rest';
    else if (interactionScore < 4) kind = 'knead';
  } else if (stage === 'done') {
    kind = 'tap-forest';
  }
  if (kind) playGhost(kind);
}

// 進行条件の判定 (SPEC-GUIDE: 軽い条件付き進行)。stage/fermentElapsed 更新後に呼ぶ。
function updateGuideProgress(dt) {
  if (stage === 'shape') {
    shapeElapsed += dt;
    if (!restUnlocked && (interactionScore >= 4 || shapeElapsed >= 20)) {
      restUnlocked = true;
      onGuideUnlock('rest');
    }
    if (!cookUnlocked && restUnlocked && postRestShapeTouches >= 2) {
      cookUnlocked = true;
      onGuideUnlock('cook');
    }
  } else if (stage === 'ferment') {
    // 発酵の20秒待ちは長いので、発酵開始6秒後から cook を解禁する
    if (!cookUnlocked && fermentElapsed >= 6) {
      cookUnlocked = true;
      onGuideUnlock('cook');
    }
  }
}

// 森ビュー中は進行バーを隠す (ガイドは「もりへ」到達をもって役目を終える。
// GuideBar は destroy() 以外に表示切替 API を持たないため、自前要素を直接トグルする)。
function setGuideVisible(visible) {
  if (guide && guide.el) guide.el.style.display = visible ? '' : 'none';
}

// 画面のどこかに触れた瞬間: ゴーストハンドは即座に消え、無操作タイマーもリセットする
function onAnyPointerDownForGuide() {
  idleTimer = 0;
  if (ghost && ghost.active) {
    try { ghost.stop(); } catch (e) { /* noop */ }
  }
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
  captureSettleTimer = -1;
  doughScale = 1;

  // ガイド進行状態のリセット (SPEC-GUIDE: 新しい生地は毎回「こねる」からやり直し)
  interactionScore = 0;
  gestureCounted.knead = gestureCounted.stretch = gestureCounted.fold = false;
  gestureCounted.round = gestureCounted.elongate = gestureCounted.twist = false;
  shapeElapsed = 0;
  restUnlocked = false;
  cookUnlocked = false;
  postRestShapeTouches = 0;

  if (hud) {
    hud.setCurrentBread(currentBreadId);
    hud.setStage('shape');
    hud.setTool('hand');
    hud.setToppingReady(false);
    hud.showHint(bread.hint || '');
  }
  if (guide) {
    guide.setMethod(bread.method);
    guide.setReady('rest', false);
    guide.setReady('cook', false);
    guide.setReady('forest', false);
    guide.setCurrent('knead');
  }
}

function startCooking(method) {
  try { cookStage = new CookStage(dough, method); } catch (e) { cookStage = null; return; }
  stage = 'cook';
  grabbing = false;
  if (hud) {
    hud.setStage('cook');
    // バグ修正(監督QA 結線バグ1): 🔥タップ経路(flyToOven)は endFerment() を経由せず
    // fermentStage を直接終わらせるため、そこでしか呼ばれない hud.coverOff() が
    // 呼ばれず布が画面に残り続けていた。焼成開始時は経路によらずここで必ず布を
    // 閉じる(coverOff は布が既に隠れていても安全に呼べる)。
    hud.coverOff();
  }
  if (guide) guide.setCurrent('cook');
  // バグ修正(監督QA 結線バグ3・軽微): 焼成が始まったらゴーストハンドの実演(cook解禁の
  // drag実演など)を止める。焼成中は演出を出さない。
  if (ghost && ghost.active) {
    try { ghost.stop(); } catch (e) { /* noop */ }
  }
}

function finishCooking() {
  stage = 'done';
  cookStage = null;
  if (hud) hud.setStage('done');
  sfx('sparkle', { gain: 0.5 });
  if (hud) hud.celebrate();
  if (guide) guide.setCurrent('forest');
  onGuideUnlock('forest');
  // 焼成完了フレームでは生地がまだオーブン付近で縮小表示中(バグ修正: 中央へ戻り等倍に
  // 近づくまで待ってから captureRegion する。SPEC-GL 3 のキャプチャ自体は render() が行う)。
  // フォールバック(2D)時は image 無しのまま従来動作。
  bakedSnapshotImage = null;
  captureOnNextRender = false;
  captureSettleTimer = glEnabled ? CAPTURE_SETTLE_SEC : -1;
}

function onCoverPressed() {
  sfxTap();
  if (stage === 'shape') {
    try { fermentStage = new FermentStage(dough); } catch (e) { fermentStage = null; return; }
    fermentElapsed = 0;
    stage = 'ferment';
    if (hud) { hud.setStage('ferment'); hud.coverOn(); }
    if (guide) guide.setCurrent('rest');
    // バグ修正(監督QA 結線バグ3・軽微): 発酵中はゴーストハンドの実演を出さない。
    if (ghost && ghost.active) {
      try { ghost.stop(); } catch (e) { /* noop */ }
    }
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
  if (guide) guide.setCurrent('knead');
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
  setGuideVisible(false);

  // 初回チュートリアル完了 (SPEC-GUIDE: 初めて森に置いたら完了とする)
  if (tutorialActive) {
    tutorialActive = false;
    try { localStorage.setItem(TUT_KEY, 'done'); } catch (e) { /* 保存できなくても続行 */ }
  }
}

function returnToPlay() {
  mode = 'play';
  if (gestures) gestures.setEnabled(true);
  if (hud) hud.setMode('play');
  setGuideVisible(true);
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
  setGuideVisible(false);
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
        // ガイド進行条件 (SPEC-GUIDE): 1回の press で 1点、同一操作中の他ジェスチャ種別は
        // 各1回だけ加点する (continuous に発火する stretch/round/twist/knead の連打で
        // 点数が際限なく膨らまないようにする)。
        gestureCounted.knead = gestureCounted.stretch = gestureCounted.fold = false;
        gestureCounted.round = gestureCounted.elongate = gestureCounted.twist = false;
        interactionScore += 1;
        if (restUnlocked && !cookUnlocked) postRestShapeTouches += 1;
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
      // バグ修正(監督QA バグ1): オーブンへ「運ぶ」ための長距離ドラッグ(生地中心付近から
      // つまんでオーブンゾーンまで移動)でも stretch イベントは並行して連続発火し続けるため、
      // 何もしなければ運んでいる最中に生地が grabMove で際限なく伸ばされて巨大化してしまう。
      // dragOrigin からの移動量が「その場での整形」を超えて大きい場合は変形量を強く減衰し、
      // 近距離の通常のストレッチ演出(既存のこね・整形ゲームプレイ)には影響しないようにする。
      const travel = dist(evt.x, evt.y, dragOrigin.x, dragOrigin.y);
      const carryDamp = draggingFromDough
        ? clamp(1 - (travel - R0 * 1.1) / (R0 * 1.6), 0.12, 1)
        : 1;
      try { dough.grabMove(evt.x, evt.y, evt.dx * carryDamp, evt.dy * carryDamp); } catch (e) {}
      const speed = Math.hypot(evt.dx, evt.dy);
      const rate = clamp(0.85 + speed * 0.015, 0.7, 1.7);
      sfx('stretchy', { rate });
      if (!gestureCounted.stretch) { gestureCounted.stretch = true; interactionScore += 1; }
      break;
    }
    case 'knead': {
      if (stage !== 'shape') break;
      try { dough.knead(evt.x, evt.y, evt.intensity); } catch (e) {}
      sfx('squish', { gain: 0.6 });
      emitFx('flour', evt.x, evt.y);
      if (!gestureCounted.knead) { gestureCounted.knead = true; interactionScore += 2; }
      break;
    }
    case 'fold': {
      if (stage !== 'shape') break;
      try { dough.fold(evt.angle); } catch (e) {}
      sfx('squish', { gain: 0.4 });
      if (!gestureCounted.fold) { gestureCounted.fold = true; interactionScore += 1; }
      break;
    }
    case 'round': {
      if (stage !== 'shape') break;
      try { dough.roundUp(evt.quality); } catch (e) {}
      if (!hasRounded) {
        hasRounded = true;
        if (hud && bread.toppingable && !dough.topping) hud.setToppingReady(true);
      }
      if (!gestureCounted.round) { gestureCounted.round = true; interactionScore += 1; }
      break;
    }
    case 'elongate': {
      if (stage !== 'shape') break;
      try { dough.elongate(evt.angle, evt.length); } catch (e) {}
      if (!gestureCounted.elongate) { gestureCounted.elongate = true; interactionScore += 1; }
      break;
    }
    case 'twist': {
      if (stage !== 'shape') break;
      try { dough.twist(evt.delta); } catch (e) {}
      if (!gestureCounted.twist) { gestureCounted.twist = true; interactionScore += 1; }
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

      // バグ修正(監督QA バグ2): 焼成中はオーブン窓に収まるサイズへ縮小表示し、
      // done 遷移(またはそれ以外の全ステージ)では中央・等倍へふわりと戻す。
      const scaleTarget = stage === 'cook' ? OVEN_DISPLAY_SCALE : 1;
      const scaleLerp = Math.min(1, dt * 3.0);
      doughScale += (scaleTarget - doughScale) * scaleLerp;
      try { dough.setScale(doughScale); } catch (e) { /* noop */ }
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

    // 焼成完了後、生地が中央・等倍に戻るのを待ってから森用スナップショットをキャプチャする
    // (バグ修正: 監督QA バグ2/オーブン付近に張り付いたままキャプチャされる問題への対処)。
    if (captureSettleTimer > 0) {
      captureSettleTimer -= dt;
      if (captureSettleTimer <= 0) {
        captureSettleTimer = -1;
        captureOnNextRender = true;
      }
    }

    updateGuideProgress(dt);
    updateGhostIdle(dt);

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
    // ゴーストハンドはパーティクルより上に描く (SPEC-GUIDE Agent Q)
    if (ghost) {
      try { ghost.render(fxCtx); } catch (e) { /* 描画失敗でもループは止めない */ }
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

  // ガイドシステム (SPEC-GUIDE Agent R 統合): GuideBar/GhostHand を生成する。
  // GuideBar は position:fixed の自前要素なので、HUD (innerHTML を丸ごと差し替える)
  // とは独立に document.body 直下へ置く。
  try { guide = new GuideBar(document.body, { onStepTap: onGuideStepTap }); } catch (e) { guide = null; }
  try { ghost = new GhostHand(); } catch (e) { ghost = null; }
  try {
    tutorialActive = localStorage.getItem(TUT_KEY) !== 'done';
  } catch (e) {
    tutorialActive = false; // localStorage 不可環境では毎回ねだらないよう控えめに倒す
  }
  tutorialKneadPending = tutorialActive;
  tutorialKneadTimer = 3;
  try { Voice.setMuted(!!Sound.muted); } catch (e) { /* noop */ } // Sound.muted と連動 (SPEC-GUIDE)

  // GestureController は最前面の #fx へ接続する (SPEC-GL: pointer はここに落ちる)。
  gestures = new GestureController(fxCanvas, onGesture);
  fxCanvas.addEventListener('pointerdown', onCanvasPointerDown);
  // HUDボタン等、canvas以外への最初のタップでも音を初期化できるようにする
  // （SPEC: 「最初のユーザー操作で呼ばれる」。1度発火したら自動で外れる）。
  document.addEventListener('pointerdown', ensureSoundInit, { once: true, capture: true });
  // ゴーストハンドはユーザーが画面のどこに触れても即座に消える。無操作タイマーも同時にリセットする。
  document.addEventListener('pointerdown', onAnyPointerDownForGuide, { capture: true });

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
    // SPEC-GUIDE: ガイドシステムのテスト用フック
    guide: {
      get bar() { return guide; },
      get ghost() { return ghost; },
      get interactionScore() { return interactionScore; },
      get restUnlocked() { return restUnlocked; },
      get cookUnlocked() { return cookUnlocked; },
      get tutorialActive() { return tutorialActive; },
    },
  };
}

boot();
