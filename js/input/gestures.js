// js/input/gestures.js — Agent C
//
// 一本指ジェスチャ認識コントローラ。Pointer Events (touch/mouse両対応) を使い、
// 4歳児のふにゃふにゃな指の動きから「押す/こねる/丸める/伸ばす/ねじる…」の
// 意図をゆるく汲み取って handler(evt) へ通知する。
//
// 方針（寛容さの原則）:
//   - 正確なジェスチャーを要求しない。閾値はすべて緩め。
//   - move は毎 pointermove で必ず発火（生ドラッグ）。stretch も speed が
//     緩い閾値未満なら常に併発してよい。判定不能でも move が保証されるので
//     「無反応」にはならない。
//   - 複数の解釈が同時に成り立つ場合は同時に複数イベントを出す
//     （例: こね中も move/stretch は出続ける）。
//
// メモリ方針:
//   - イベントオブジェクト自体は毎回 plain object を新規に渡してよい。
//   - 分類のための「履歴バッファ」(位置サンプル・速度サンプル・反転タイムスタンプ等)
//     は TypedArray によるリングバッファで使い回し、フレーム毎の新規配列/オブジェクト
//     割り当てを避ける。

// ------------------------------------------------------------
// 調整可能な閾値（すべて「緩め」を意識）
// ------------------------------------------------------------

const POINT_RING_CAPACITY = 128;      // 位置サンプル履歴（round/twist/knead 分類用）
const VELOCITY_SAMPLES = 5;           // 速度の移動平均サンプル数
const KNEAD_REVERSAL_CAPACITY = 24;   // こね判定: 方向反転タイムスタンプ履歴
const TWIST_RING_CAPACITY = 16;       // ねじり判定: 角度差分の履歴

const HOLD_INTERVAL = 250;            // pressHold 発火間隔 (ms)
const HOLD_MOVE_THRESHOLD = 10;       // pressHold: これ未満の移動なら「静止」とみなす (px)

const STRETCH_SPEED_THRESHOLD = 900;  // stretch: これ未満の速度なら「ゆっくりドラッグ」(px/s)

const KNEAD_WINDOW = 1200;            // knead: 判定ウィンドウ (ms)
const KNEAD_MIN_REVERSALS = 3;        // knead: ウィンドウ内で必要な反転回数
const KNEAD_REVERSAL_MIN_DELTA = 4;   // knead: ノイズ除去用の最小移動量 (px)

const FOLD_MIN_STROKE_RATIO = 0.8;    // fold: 「長いストローク」とみなす距離 (* R0)
const FOLD_RETURN_RATIO = 0.15;       // fold: 戻りとみなす最小距離 (* R0)
const FOLD_BACK_DOT_MAX = -0.12;      // fold: 逆方向判定の内積しきい値（緩め）

const ROUND_WINDOW = 900;             // round: 判定ウィンドウ (ms)
const ROUND_MIN_ANGLE = 3.2;          // round: 累積角度のしきい値 (rad, 約183度)
const ROUND_MIN_RADIUS = 10;          // round: これ未満の半径はジッターとみなし無視 (px)
const ROUND_MIN_SAMPLES = 6;          // round: 判定に必要な最小サンプル数

const ELONGATE_MIN_LENGTH_RATIO = 1.1; // elongate: 直線とみなす最小距離 (* R0)
const ELONGATE_STRAIGHTNESS = 0.6;     // elongate: 直線度 chord/pathLength のしきい値（緩め）

const TWIST_CENTER_RATIO = 0.6;       // twist: 開始点が中心からこの比率以遠 (* R0)
const TWIST_PERSIST_WINDOW = 400;     // twist: 回転の持続を見るウィンドウ (ms)
const TWIST_MIN_SUM = 0.04;           // twist: ウィンドウ内の累積回転角しきい値 (rad, 緩め)

// ------------------------------------------------------------
// ユーティリティ
// ------------------------------------------------------------

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function now() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

// 位置サンプル用リングバッファ（TypedArrayで割り当てを抑える）
class SampleRing {
  constructor(capacity) {
    this.capacity = capacity;
    this.xs = new Float64Array(capacity);
    this.ys = new Float64Array(capacity);
    this.ts = new Float64Array(capacity);
    this.count = 0;
    this.next = 0;
  }
  clear() {
    this.count = 0;
    this.next = 0;
  }
  push(x, y, t) {
    this.xs[this.next] = x;
    this.ys[this.next] = y;
    this.ts[this.next] = t;
    this.next = (this.next + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
  // age=0 が最新。物理スロット index を返す。
  slotForAge(age) {
    return (this.next - 1 - age + this.capacity * 2) % this.capacity;
  }
}

// タイムスタンプのみのリングバッファ（knead の反転検出用）
class TimeRing {
  constructor(capacity) {
    this.capacity = capacity;
    this.ts = new Float64Array(capacity);
    this.count = 0;
    this.next = 0;
  }
  clear() {
    this.count = 0;
    this.next = 0;
  }
  push(t) {
    this.ts[this.next] = t;
    this.next = (this.next + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
  countWithin(nowMs, windowMs) {
    let c = 0;
    for (let i = 0; i < this.count; i++) {
      if (nowMs - this.ts[i] <= windowMs) c++;
    }
    return c;
  }
}

// 値+タイムスタンプのリングバッファ（twist の角度差分の持続判定用）
class ValueTimeRing {
  constructor(capacity) {
    this.capacity = capacity;
    this.vals = new Float64Array(capacity);
    this.ts = new Float64Array(capacity);
    this.count = 0;
    this.next = 0;
  }
  clear() {
    this.count = 0;
    this.next = 0;
  }
  push(v, t) {
    this.vals[this.next] = v;
    this.ts[this.next] = t;
    this.next = (this.next + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
  sumWithin(nowMs, windowMs) {
    let s = 0;
    for (let i = 0; i < this.count; i++) {
      if (nowMs - this.ts[i] <= windowMs) s += this.vals[i];
    }
    return s;
  }
}

// ------------------------------------------------------------
// GestureController
// ------------------------------------------------------------

export class GestureController {
  /**
   * @param {EventTarget} canvas  addEventListener を持つ要素（本物のcanvasでもモックでも可）
   * @param {(evt:object)=>void} handler
   */
  constructor(canvas, handler) {
    this.canvas = canvas;
    this.handler = typeof handler === 'function' ? handler : () => {};
    this.enabled = true;

    // アクティブな一本指の pointerId（null = 触れていない）
    this._pointerId = null;

    // このストローク用の状態
    this._downTime = 0;
    this._downX = 0;
    this._downY = 0;
    this._lastX = 0;
    this._lastY = 0;
    this._lastT = 0;
    this._pathLength = 0;
    this._strokePoints = [];

    this._holdAnchorX = 0;
    this._holdAnchorY = 0;
    this._holdTimer = null;

    this._foldStartX = 0;
    this._foldStartY = 0;
    this._foldPeakDist = 0;
    this._foldPeakAngle = 0;
    this._foldPeakX = 0;
    this._foldPeakY = 0;

    this._prevDirX = 0;
    this._prevDirY = 0;
    this._hasPrevDir = false;

    this._prevAngle = 0;
    this._twistEligible = false;

    this._R0 = 100;
    this._centerX = 0;
    this._centerY = 0;

    // リングバッファ（割り当て抑制のため使い回す）
    this._ring = new SampleRing(POINT_RING_CAPACITY);
    this._reversals = new TimeRing(KNEAD_REVERSAL_CAPACITY);
    this._twistRing = new ValueTimeRing(TWIST_RING_CAPACITY);
    this._velSamples = new Float64Array(VELOCITY_SAMPLES);
    this._velCount = 0;
    this._velIndex = 0;

    // ハンドラを一度だけ bind（add/removeEventListener の対称性のため）
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerCancel = this._onPointerCancel.bind(this);
    this._onTouchPreventDefault = this._onTouchPreventDefault.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);
    this._onGesturePreventDefault = this._onGesturePreventDefault.bind(this);
    this._onDragPreventDefault = this._onDragPreventDefault.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);

    this._attach();
  }

  // ---------------- 公開 API ----------------

  setEnabled(v) {
    this.enabled = !!v;
    if (!this.enabled) {
      this._resetOnInterrupt();
    }
  }

  destroy() {
    this._clearHoldTimer();
    const c = this.canvas;
    if (c && typeof c.removeEventListener === 'function') {
      c.removeEventListener('pointerdown', this._onPointerDown);
      c.removeEventListener('pointermove', this._onPointerMove);
      c.removeEventListener('pointerup', this._onPointerUp);
      c.removeEventListener('pointercancel', this._onPointerCancel);
      c.removeEventListener('touchstart', this._onTouchPreventDefault);
      c.removeEventListener('touchmove', this._onTouchPreventDefault);
      c.removeEventListener('touchend', this._onTouchPreventDefault);
      c.removeEventListener('touchcancel', this._onTouchPreventDefault);
      c.removeEventListener('contextmenu', this._onContextMenu);
      c.removeEventListener('gesturestart', this._onGesturePreventDefault);
      c.removeEventListener('gesturechange', this._onGesturePreventDefault);
      c.removeEventListener('gestureend', this._onGesturePreventDefault);
      c.removeEventListener('dragstart', this._onDragPreventDefault);
    }
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
    }
    this._pointerId = null;
    this.enabled = false;
  }

  // ---------------- 内部: セットアップ ----------------

  _attach() {
    const c = this.canvas;
    if (!c || typeof c.addEventListener !== 'function') return;

    // Pointer Events（本命）。iOS Safari のスクロール/ズームを止めるため passive:false 必須。
    c.addEventListener('pointerdown', this._onPointerDown, { passive: false });
    c.addEventListener('pointermove', this._onPointerMove, { passive: false });
    c.addEventListener('pointerup', this._onPointerUp, { passive: false });
    c.addEventListener('pointercancel', this._onPointerCancel, { passive: false });

    // iOS Safari 対策の保険: touch イベント側でも preventDefault
    // （ダブルタップズーム・長押し選択・スクロールの完全抑止）
    c.addEventListener('touchstart', this._onTouchPreventDefault, { passive: false });
    c.addEventListener('touchmove', this._onTouchPreventDefault, { passive: false });
    c.addEventListener('touchend', this._onTouchPreventDefault, { passive: false });
    c.addEventListener('touchcancel', this._onTouchPreventDefault, { passive: false });

    // 長押しメニュー・pinchズーム・ドラッグゴーストの抑止
    c.addEventListener('contextmenu', this._onContextMenu, { passive: false });
    c.addEventListener('gesturestart', this._onGesturePreventDefault, { passive: false });
    c.addEventListener('gesturechange', this._onGesturePreventDefault, { passive: false });
    c.addEventListener('gestureend', this._onGesturePreventDefault, { passive: false });
    c.addEventListener('dragstart', this._onDragPreventDefault, { passive: false });

    if (c.style) {
      try {
        c.style.touchAction = 'none';
        c.style.webkitUserSelect = 'none';
        c.style.userSelect = 'none';
      } catch (err) {
        /* スタイル未対応環境では無視 */
      }
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    }
  }

  // ---------------- 内部: 座標・画面サイズ ----------------

  _getLocalXY(e) {
    let left = 0;
    let top = 0;
    if (this.canvas && typeof this.canvas.getBoundingClientRect === 'function') {
      const r = this.canvas.getBoundingClientRect();
      if (r) {
        left = r.left || 0;
        top = r.top || 0;
      }
    }
    const cx = typeof e.clientX === 'number' ? e.clientX : 0;
    const cy = typeof e.clientY === 'number' ? e.clientY : 0;
    return { x: cx - left, y: cy - top };
  }

  _getScreenSize() {
    if (this.canvas && typeof this.canvas.getBoundingClientRect === 'function') {
      const r = this.canvas.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        return { w: r.width, h: r.height };
      }
    }
    if (typeof window !== 'undefined' && window.innerWidth && window.innerHeight) {
      return { w: window.innerWidth, h: window.innerHeight };
    }
    return { w: 800, h: 600 };
  }

  // ---------------- 内部: イベント発火 ----------------

  _emit(evt) {
    try {
      this.handler(evt);
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[gestures] handler がエラーを投げましたが継続します', err);
      }
    }
  }

  // ---------------- 内部: 速度移動平均 ----------------

  _pushVelSample(v) {
    this._velSamples[this._velIndex] = v;
    this._velIndex = (this._velIndex + 1) % VELOCITY_SAMPLES;
    if (this._velCount < VELOCITY_SAMPLES) this._velCount++;
  }

  _avgVelSample() {
    let sum = 0;
    for (let i = 0; i < this._velCount; i++) sum += this._velSamples[i];
    return this._velCount > 0 ? sum / this._velCount : 0;
  }

  // ---------------- 内部: pointer down/move/up/cancel ----------------

  _preventDefaultSafe(e) {
    if (e && typeof e.preventDefault === 'function') {
      try {
        e.preventDefault();
      } catch (err) {
        /* 一部ブラウザで preventDefault が例外を投げても無視 */
      }
    }
  }

  _onTouchPreventDefault(e) {
    this._preventDefaultSafe(e);
  }
  _onContextMenu(e) {
    this._preventDefaultSafe(e);
  }
  _onGesturePreventDefault(e) {
    this._preventDefaultSafe(e);
  }
  _onDragPreventDefault(e) {
    this._preventDefaultSafe(e);
  }

  _onVisibilityChange() {
    if (typeof document !== 'undefined' && document.hidden) {
      this._resetOnInterrupt();
    }
  }

  _resetOnInterrupt() {
    this._clearHoldTimer();
    if (this._pointerId !== null) {
      this._emit({ type: 'release', x: this._lastX, y: this._lastY });
      try {
        if (this.canvas && typeof this.canvas.releasePointerCapture === 'function') {
          this.canvas.releasePointerCapture(this._pointerId);
        }
      } catch (err) {
        /* すでに解放済み等は無視 */
      }
      this._pointerId = null;
    }
  }

  _onPointerDown(e) {
    this._preventDefaultSafe(e);
    if (!this.enabled) return;
    if (e.isPrimary === false) return; // 2本目以降（primaryでない）は無視
    if (this._pointerId !== null) return; // すでに一本指を追跡中なら無視
    if (e.pointerType === 'mouse' && typeof e.button === 'number' && e.button !== 0) return;

    this._pointerId = e.pointerId;
    try {
      if (this.canvas && typeof this.canvas.setPointerCapture === 'function') {
        this.canvas.setPointerCapture(e.pointerId);
      }
    } catch (err) {
      /* capture できなくても通常のイベント配送で継続動作可能 */
    }

    const { x, y } = this._getLocalXY(e);
    const t = now();
    const screen = this._getScreenSize();

    this._R0 = Math.min(screen.w, screen.h) * 0.26;
    this._centerX = screen.w / 2;
    this._centerY = screen.h * 0.45;

    this._downTime = t;
    this._downX = x;
    this._downY = y;
    this._lastX = x;
    this._lastY = y;
    this._lastT = t;

    this._holdAnchorX = x;
    this._holdAnchorY = y;

    this._pathLength = 0;

    this._foldStartX = x;
    this._foldStartY = y;
    this._foldPeakDist = 0;
    this._foldPeakAngle = 0;
    this._foldPeakX = x;
    this._foldPeakY = y;

    this._prevDirX = 0;
    this._prevDirY = 0;
    this._hasPrevDir = false;

    this._prevAngle = Math.atan2(y - this._centerY, x - this._centerX);
    const startDistFromCenter = Math.hypot(x - this._centerX, y - this._centerY);
    this._twistEligible = startDistFromCenter > this._R0 * TWIST_CENTER_RATIO;

    this._ring.clear();
    this._ring.push(x, y, t);
    this._reversals.clear();
    this._twistRing.clear();
    this._velCount = 0;
    this._velIndex = 0;

    this._strokePoints = [{ x, y }];

    this._startHoldTimer();

    this._emit({ type: 'press', x, y });
  }

  _onPointerMove(e) {
    this._preventDefaultSafe(e);
    if (this._pointerId === null || e.pointerId !== this._pointerId) return;
    if (!this.enabled) return;

    const { x, y } = this._getLocalXY(e);
    const t = now();
    let dt = t - this._lastT;
    if (dt <= 0) dt = 1;

    const dx = x - this._lastX;
    const dy = y - this._lastY;
    const dist = Math.hypot(dx, dy);

    const instSpeed = (dist / dt) * 1000;
    this._pushVelSample(instSpeed);
    const speed = this._avgVelSample();

    this._pathLength += dist;
    this._ring.push(x, y, t);
    this._strokePoints.push({ x, y });

    // move は常に発火（生ドラッグ。分類とは独立）
    this._emit({ type: 'move', x, y, dx, dy, speed });

    // stretch: ゆっくりドラッグ中は連続発火
    if (speed < STRETCH_SPEED_THRESHOLD) {
      this._emit({ type: 'stretch', x, y, dx, dy });
    }

    this._updateKnead(x, y, dx, dy, dist, t);
    this._updateFold(x, y, t);
    this._updateRound(t);
    this._updateTwist(x, y, t);

    this._lastX = x;
    this._lastY = y;
    this._lastT = t;
  }

  _onPointerUp(e) {
    this._preventDefaultSafe(e);
    if (this._pointerId === null || e.pointerId !== this._pointerId) return;
    const { x, y } = this._getLocalXY(e);
    this._finalizeStroke(x, y);
  }

  _onPointerCancel(e) {
    this._preventDefaultSafe(e);
    if (this._pointerId === null || e.pointerId !== this._pointerId) return;
    // cancel 時は最後にわかっている座標を使う
    this._finalizeStroke(this._lastX, this._lastY);
  }

  _finalizeStroke(x, y) {
    if (this.enabled) {
      // elongate: ほぼ直線の長いストロークを離した時に1回
      const chord = Math.hypot(x - this._downX, y - this._downY);
      if (this._pathLength > 0 && chord > this._R0 * ELONGATE_MIN_LENGTH_RATIO) {
        const straightness = chord / this._pathLength;
        if (straightness > ELONGATE_STRAIGHTNESS) {
          const angle = Math.atan2(y - this._downY, x - this._downX);
          this._emit({ type: 'elongate', angle, length: chord });
        }
      }

      // stroke: 指を離した時、そのストローク全点列を必ず1回
      this._emit({ type: 'stroke', points: this._strokePoints });

      // release
      this._emit({ type: 'release', x, y });
    }

    this._clearHoldTimer();
    try {
      if (this.canvas && typeof this.canvas.releasePointerCapture === 'function' && this._pointerId !== null) {
        this.canvas.releasePointerCapture(this._pointerId);
      }
    } catch (err) {
      /* 無視 */
    }
    this._pointerId = null;
  }

  // ---------------- 内部: pressHold タイマー ----------------

  _startHoldTimer() {
    this._clearHoldTimer();
    this._holdTimer = setInterval(() => {
      if (this._pointerId === null || !this.enabled) return;
      const t = now();
      const distFromAnchor = Math.hypot(this._lastX - this._holdAnchorX, this._lastY - this._holdAnchorY);
      if (distFromAnchor < HOLD_MOVE_THRESHOLD) {
        const duration = t - this._downTime;
        this._emit({ type: 'pressHold', x: this._lastX, y: this._lastY, duration });
      } else {
        // 大きく動いた＝もう「静止」ではないのでアンカーを更新（動きが止まればまた発火再開）
        this._holdAnchorX = this._lastX;
        this._holdAnchorY = this._lastY;
      }
    }, HOLD_INTERVAL);
  }

  _clearHoldTimer() {
    if (this._holdTimer !== null) {
      clearInterval(this._holdTimer);
      this._holdTimer = null;
    }
  }

  // ---------------- 内部: 各ジェスチャ分類 ----------------

  // knead: 直近 KNEAD_WINDOW 内に方向反転が KNEAD_MIN_REVERSALS 回以上
  _updateKnead(x, y, dx, dy, dist, t) {
    if (dist >= KNEAD_REVERSAL_MIN_DELTA) {
      const dirX = dx / dist;
      const dirY = dy / dist;
      if (this._hasPrevDir) {
        const dot = dirX * this._prevDirX + dirY * this._prevDirY;
        if (dot < 0) {
          this._reversals.push(t);
        }
      }
      this._prevDirX = dirX;
      this._prevDirY = dirY;
      this._hasPrevDir = true;
    }

    const count = this._reversals.countWithin(t, KNEAD_WINDOW);
    if (count >= KNEAD_MIN_REVERSALS) {
      const freq = count / (KNEAD_WINDOW / 1000); // 反転/秒
      const intensity = clamp(freq / 6, 0, 1);
      this._emit({ type: 'knead', x, y, intensity });
    }
  }

  // fold: R0*0.8 以上伸ばした後、逆方向へ戻した瞬間に1回
  _updateFold(x, y, _t) {
    const dist = Math.hypot(x - this._foldStartX, y - this._foldStartY);
    if (dist >= this._foldPeakDist) {
      this._foldPeakDist = dist;
      this._foldPeakAngle = Math.atan2(y - this._foldStartY, x - this._foldStartX);
      this._foldPeakX = x;
      this._foldPeakY = y;
      return; // まだ伸びている最中
    }

    if (this._foldPeakDist > this._R0 * FOLD_MIN_STROKE_RATIO) {
      const returnDist = Math.hypot(x - this._foldPeakX, y - this._foldPeakY);
      if (returnDist > this._R0 * FOLD_RETURN_RATIO) {
        const outX = this._foldPeakX - this._foldStartX;
        const outY = this._foldPeakY - this._foldStartY;
        const backX = x - this._foldPeakX;
        const backY = y - this._foldPeakY;
        const outLen = Math.hypot(outX, outY) || 1;
        const backLen = Math.hypot(backX, backY) || 1;
        const dot = (outX * backX + outY * backY) / (outLen * backLen);
        if (dot < FOLD_BACK_DOT_MAX) {
          this._emit({ type: 'fold', angle: this._foldPeakAngle });
          // 次の折り畳みに備えてこの地点から再スタート
          this._foldStartX = x;
          this._foldStartY = y;
          this._foldPeakDist = 0;
          this._foldPeakX = x;
          this._foldPeakY = y;
        }
      }
    }
  }

  // round: 直近 ROUND_WINDOW 内の点群が円を描いているか（緩め判定）
  _updateRound(t) {
    const ring = this._ring;
    const n = ring.count;
    if (n < ROUND_MIN_SAMPLES) return;

    // ウィンドウ内のサンプル数を数える（age=0が最新、古いほど age が増える）
    let num = 0;
    let sumX = 0;
    let sumY = 0;
    for (let age = 0; age < n; age++) {
      const slot = ring.slotForAge(age);
      if (t - ring.ts[slot] > ROUND_WINDOW) break;
      sumX += ring.xs[slot];
      sumY += ring.ys[slot];
      num++;
    }
    if (num < ROUND_MIN_SAMPLES) return;

    const cx = sumX / num;
    const cy = sumY / num;

    let sumR = 0;
    for (let age = 0; age < num; age++) {
      const slot = ring.slotForAge(age);
      sumR += Math.hypot(ring.xs[slot] - cx, ring.ys[slot] - cy);
    }
    const meanR = sumR / num;
    if (meanR < ROUND_MIN_RADIUS) return;

    let varR = 0;
    for (let age = 0; age < num; age++) {
      const slot = ring.slotForAge(age);
      const r = Math.hypot(ring.xs[slot] - cx, ring.ys[slot] - cy);
      varR += (r - meanR) * (r - meanR);
    }
    const stdR = Math.sqrt(varR / num);

    // 累積角度（時系列順: 古い→新しい）
    let totalAngle = 0;
    let prevA = null;
    for (let age = num - 1; age >= 0; age--) {
      const slot = ring.slotForAge(age);
      const a = Math.atan2(ring.ys[slot] - cy, ring.xs[slot] - cx);
      if (prevA !== null) {
        totalAngle += Math.abs(normalizeAngle(a - prevA));
      }
      prevA = a;
    }
    if (totalAngle < ROUND_MIN_ANGLE) return;

    const quality = clamp(1 - (stdR / meanR) * 0.8, 0, 1);
    this._emit({ type: 'round', cx, cy, quality });
  }

  // twist: 開始点が中心から遠く、かつ中心周りの回転が持続している間
  _updateTwist(x, y, t) {
    if (!this._twistEligible) return;
    const angleNow = Math.atan2(y - this._centerY, x - this._centerX);
    const delta = normalizeAngle(angleNow - this._prevAngle);
    this._prevAngle = angleNow;
    this._twistRing.push(delta, t);

    const sum = this._twistRing.sumWithin(t, TWIST_PERSIST_WINDOW);
    if (Math.abs(sum) > TWIST_MIN_SUM) {
      this._emit({ type: 'twist', delta });
    }
  }
}
