// ゲーム本体：カメラ・状態遷移・あそびのルール。
//
// 設計の芯：
//  ・失敗も時間切れもない。まちがえた操作は「なにも起きない」だけ。
//  ・文字は飾りだけ。やることは かならず「光るリング」と「お手本の手」で示す。
//  ・指は一本だけ。二本目以降は input.js が捨てる。
import {
  TAU, PI, clamp, lerp, smoothstep, approach, dist, easeOutCubic, easeInOutCubic,
  easeOutBack, hash1, rand,
} from './util.js';
import * as A from './art.js';
import { Particles } from './particles.js';
import { SinglePointer } from './input.js';
import { Audio } from './audio.js';

const S = {
  TITLE: 'title',
  INTRO: 'intro',
  TOUCH: 'touch',
  PATCH: 'patch',
  PUMP: 'pump',
  SPIN: 'spin',
  READY: 'ready',
  DRIVE: 'drive',
  FINALE: 'finale',
};

const DRIVE_DURATION = 17;   // 試運転の長さ（秒）：受け入れ条件の 15〜20 秒
const CRUISE = 215;          // 巡航速度（ワールド単位/秒）
const RABBIT_SCALE = 1.15;
const NEED_STROKES = 3;      // ポンプの必要回数
const INFLATION_STEPS = [0.08, 0.42, 0.73, 1.0];

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.pointer = new SinglePointer(canvas);
    this.audio = new Audio();
    this.fx = new Particles();
    this.probe = document.getElementById('safe-probe');
    this.L = { w: 1, h: 1, dpr: 1, min: 1, portrait: true, safe: { t: 0, r: 0, b: 0, l: 0 } };
    this.cam = { x: 0, y: -160, zoom: 1, tx: 0, ty: -160, tzoom: 1, cx: 0, cy: 0, tcx: 0, tcy: 0, init: false };
    this.muted = false;
    this.ripples = [];
    this.reset();
    this.resize();
  }

  /* ------------------------------------------------------------- 初期化 */

  reset() {
    this.state = S.TITLE;
    this.st = 0;
    this.t = 0;
    this.trike = { x: 0 };
    this.wheel = {
      r: A.TRIKE.frontR,
      rot: 0,
      omega: 0,
      inflation: 0.08,
      targetInflation: 0.08,
      dents: [],
      hole: { a: -1.0, reveal: 0 },
      patch: null,
      valveA: 0.6,
      squash: 0,
    };
    this.rearRot = 0;
    this.rabbit = { mood: 'idle', blink: 0, blinkTimer: 1.5, riding: true, hopT: 1, cheer: 0 };
    this.touchCount = 0;
    this.leakTimer = 0;
    this.pump = { in: 0, handle: 0, grab: null, strokes: 0, armed: true, pulse: 0, shake: 0 };
    this.tray = { in: 0 };
    this.patches = A.PATCHES.map((p, i) => ({ ...p, i, x: 0, y: 0, hx: 0, hy: 0, s: 1, mode: 'tray', fly: 0, wobble: hash1(i * 3) * TAU }));
    this.drag = null;
    this.liveDent = null;
    this.pendingPump = 0;
    this.pumpDoneT = 0;
    this.holeRevealT = 0;
    this.flicked = false;
    this.spinIdle = 0;
    this.spinAmount = 0;
    this.rotTarget = null;
    this.driveT = 0;
    this.goalX = 3000;
    this.rideRough = 0;      // 走りのガタつき（0=なめらか）
    this.roughShown = 0;
    this.roughBuf = [];
    this.hint = 0;
    this.ripples.length = 0;
    this.fx.clear();
    this.medal = 0;
    this.confettiTimer = 0;
  }

  /**
   * 描画解像度を落とす（コマ落ちしたときだけ）。
   * 絵はベクタなので、解像度が下がっても輪郭が少し甘くなるだけ。
   */
  degradeQuality() {
    if (this.renderScale <= 1.02) return false;
    this.renderScale = Math.max(1, this.renderScale * 0.8);
    this.resize();
    return true;
  }

  resize() {
    if (!this.renderScale) this.renderScale = Math.min(window.devicePixelRatio || 1, 2);
    const dpr = Math.min(window.devicePixelRatio || 1, this.renderScale);
    const w = Math.max(1, Math.round(this.canvas.clientWidth || window.innerWidth));
    const h = Math.max(1, Math.round(this.canvas.clientHeight || window.innerHeight));
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    let safe = { t: 0, r: 0, b: 0, l: 0 };
    if (this.probe) {
      const cs = getComputedStyle(this.probe);
      safe = {
        t: parseFloat(cs.paddingTop) || 0,
        r: parseFloat(cs.paddingRight) || 0,
        b: parseFloat(cs.paddingBottom) || 0,
        l: parseFloat(cs.paddingLeft) || 0,
      };
    }
    this.L = {
      w, h, dpr, safe,
      min: Math.min(w, h),
      max: Math.max(w, h),
      portrait: h >= w,
    };
    // 画面サイズが変わったときだけカメラを即座に合わせ直す
    // （描画解像度を下げただけのときは、カメラを飛ばさない）
    if (this._lastW !== w || this._lastH !== h) {
      this._lastW = w;
      this._lastH = h;
      this.cam.init = false;
    }
  }

  /* --------------------------------------------------------- 画面レイアウト */

  /**
   * 道具置き場（ドック）は縦画面なら下、横画面なら右。
   * どちらでも「絵は広いほう、道具は指の届くところ」になる。
   */
  ui() {
    const L = this.L;
    const pumpH = clamp(L.min * 0.46, 150, 300);
    const thick = L.portrait ? pumpH * 1.26 : pumpH * 1.08;
    const dock = L.portrait
      ? { x: 0, y: L.h - L.safe.b - thick, w: L.w, h: thick }
      : { x: L.w - L.safe.r - thick, y: 0, w: thick, h: L.h };
    const cx = dock.x + dock.w / 2;
    const cy = dock.y + dock.h / 2;
    const slotR = L.portrait
      ? clamp(Math.min(dock.w * 0.125, dock.h * 0.3), 26, 62)
      : clamp(Math.min(dock.w * 0.3, dock.h * 0.11), 26, 62);
    const slots = [0, 1, 2].map((i) => (L.portrait
      ? { x: cx + (i - 1) * slotR * 2.6, y: dock.y + dock.h * 0.5 }
      : { x: cx, y: cy + (i - 1) * slotR * 2.6 }));
    const btn = clamp(L.min * 0.075, 26, 46);
    return {
      dock,
      thick,
      slotR,
      slots,
      pumpH,
      pumpX: cx,
      pumpY: L.portrait ? dock.y + dock.h - 22 : cy + pumpH * 0.52,
      dotX: L.portrait ? dock.x + dock.w * 0.19 : cx,
      dotY: L.portrait
        ? dock.y + dock.h * 0.46
        : dock.y + dock.h - L.safe.b - clamp(L.h * 0.1, 34, 70),
      btnR: btn,
      // 音ボタンは常に左上（右は横画面で道具置き場が来るため）
      muteX: L.safe.l + btn + 12,
      muteY: L.safe.t + btn + 12,
    };
  }

  /**
   * 「はじめる／しゅっぱつ／もういちど」の大きな丸ボタン。
   * 縦画面は下の中央、横画面は右下（絵の主役に重ならない場所）。
   */
  mainButton() {
    const L = this.L;
    const r = clamp(L.min * 0.115, 42, 84);
    return L.portrait
      ? { x: L.w / 2, y: L.h - L.safe.b - r - clamp(L.min * 0.05, 16, 44), r }
      : { x: L.w - L.safe.r - r - 26, y: L.h - L.safe.b - r - 18, r };
  }

  /** 道具置き場のせり出し具合（0〜1） */
  get dockIn() { return Math.max(this.tray.in, this.pump.in); }

  /** カメラが使える領域（道具置き場を避ける） */
  availRect() {
    const L = this.L;
    const u = this.ui();
    const k = this.dockIn;
    const top = L.safe.t + (this.state === S.DRIVE ? L.min * 0.09 : 0);
    const bottom = L.portrait ? u.thick * k : 0;
    const right = L.portrait ? 0 : u.thick * k;
    return {
      x: L.safe.l,
      y: top,
      w: Math.max(60, L.w - L.safe.l - L.safe.r - right),
      h: Math.max(60, L.h - top - L.safe.b - bottom),
    };
  }

  /**
   * 地面の線を画面の下寄り（groundFrac）に固定して構図を決める。
   * 縦長でも横長でも「空・のりもの・草」の割合が崩れない。
   */
  setView(fx, viewW, above, groundFrac) {
    const r = this.availRect();
    this.cam.tzoom = Math.max(0.05, Math.min(r.w / viewW, (r.h * groundFrac) / above));
    this.cam.tx = fx;
    this.cam.ty = 0;
    this.cam.tcx = r.x + r.w / 2;
    this.cam.tcy = r.y + r.h * groundFrac;
  }

  w2s(x, y) {
    const c = this.cam;
    return { x: (x - c.x) * c.zoom + c.cx, y: (y - c.y) * c.zoom + c.cy };
  }

  s2w(x, y) {
    const c = this.cam;
    return { x: (x - c.cx) / c.zoom + c.x, y: (y - c.cy) / c.zoom + c.y };
  }

  /* ------------------------------------------------- 三輪車のジオメトリ */

  get frontRadius() { return A.wheelRadiusAt(this.wheel, PI / 2); }

  /** 前輪が沈んだぶんの車体の傾き */
  get tilt() { return (A.TRIKE.frontR - this.frontRadius) / A.TRIKE.wheelbase; }

  /** 車体ローカル座標 → ワールド座標（後輪軸まわりに tilt 回転） */
  local2world(px, py) {
    const [rx, ry] = A.TRIKE.rearHub;
    const th = this.tilt;
    const dx = px - rx;
    const dy = py - ry;
    const c = Math.cos(th);
    const s = Math.sin(th);
    return { x: this.trike.x + rx + dx * c - dy * s, y: ry + dx * s + dy * c };
  }

  get axle() { return this.local2world(A.TRIKE.frontHub[0], A.TRIKE.frontHub[1]); }

  holePos() {
    const w = this.wheel;
    const ax = this.axle;
    const a = w.hole.a + w.rot;
    const r = A.wheelRadiusAt(w, a) * 0.9;
    return { x: ax.x + Math.cos(a) * r, y: ax.y + Math.sin(a) * r };
  }

  valvePos() {
    const w = this.wheel;
    const ax = this.axle;
    const a = w.valveA + w.rot;
    return { x: ax.x + Math.cos(a) * w.r * 0.74, y: ax.y + Math.sin(a) * w.r * 0.74 };
  }

  /* ------------------------------------------------------------- 更新 */

  update(dtRaw) {
    const dt = Math.min(dtRaw, 0.05);
    this.t += dt;
    this.st += dt;
    const p = this.pointer;
    p.update(dt);

    // ポンプの画面上の位置（出し入れのアニメを含む）
    const pu = this.ui();
    const pOff = (1 - this.pump.in) * pu.thick * 1.25;
    this.pumpDrawX = pu.pumpX + (this.L.portrait ? 0 : pOff);
    this.pumpDrawY = pu.pumpY + (this.L.portrait ? pOff : 0);

    if (p.pressed) {
      this.hint = 0;
      this.audio.unlock();
      this.ripples.push({ x: p.x, y: p.y, t: 0 });
    } else {
      this.hint += dt;
    }
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      this.ripples[i].t += dt * 1.7;
      if (this.ripples[i].t >= 1) this.ripples.splice(i, 1);
    }

    // 音の ON/OFF ボタン（どの場面でも押せる）
    const u = this.ui();
    if (p.pressed && dist(p.x, p.y, u.muteX, u.muteY) < u.btnR * 1.5) {
      this.muted = !this.muted;
      this.audio.setMuted(this.muted);
      if (!this.muted) this.audio.tap();
      this.uiConsumed = true;
    } else if (p.pressed) {
      this.uiConsumed = false;
    }

    this.updateBlink(dt);
    this.updateWheel(dt);

    switch (this.state) {
      case S.TITLE: this.upTitle(dt); break;
      case S.INTRO: this.upIntro(dt); break;
      case S.TOUCH: this.upTouch(dt); break;
      case S.PATCH: this.upPatch(dt); break;
      case S.PUMP: this.upPump(dt); break;
      case S.SPIN: this.upSpin(dt); break;
      case S.READY: this.upReady(dt); break;
      case S.DRIVE: this.upDrive(dt); break;
      case S.FINALE: this.upFinale(dt); break;
      default: break;
    }

    // 走っていない場面では揺れをおさめる
    if (this.state !== S.INTRO && this.state !== S.DRIVE) {
      this.rideRough = approach(this.rideRough, 0, 4, dt);
      this.roughShown = approach(this.roughShown, 0, 4, dt);
    }

    // 道具の出し入れ
    this.tray.in = approach(this.tray.in, this.state === S.PATCH ? 1 : 0, 7, dt);
    this.pump.in = approach(this.pump.in, this.state === S.PUMP ? 1 : 0, 6.5, dt);
    this.pump.shake = approach(this.pump.shake, 0, 8, dt);
    this.pump.pulse = this.pump.pulse > 0 ? Math.max(0, this.pump.pulse - dt * 2.4) : 0;

    // カメラ
    const close = this.state === S.TOUCH || this.state === S.PATCH
      || this.state === S.PUMP || this.state === S.SPIN
      || (this.state === S.INTRO && this.st > 3.5);
    const L = this.L;
    // うさぎが降りて横に立っているときは、その分だけ画面を右に寄せる
    const standing = this.rabbit.hopT < 0.5;
    const wideOff = this.state === S.FINALE ? 135 : (standing ? 100 : 20);
    // 画面が大きいほど寄りすぎないようにする（タブレットで車輪が巨大にならない）
    const closeW = clamp(L.min * 0.78, 290, 470);
    if (close) this.setView(this.trike.x + A.TRIKE.frontHub[0], closeW, 260, 0.8);
    else this.setView(this.trike.x + wideOff, L.portrait ? 440 : 800, 400, 0.82);

    const c = this.cam;
    if (!c.init) {
      c.x = c.tx; c.y = c.ty; c.zoom = c.tzoom; c.cx = c.tcx; c.cy = c.tcy;
      c.init = true;
    } else {
      const k = this.state === S.DRIVE ? 6 : 3.1;
      c.x = approach(c.x, c.tx, k, dt);
      c.y = approach(c.y, c.ty, 3.1, dt);
      c.zoom = approach(c.zoom, c.tzoom, 3.1, dt);
      c.cx = approach(c.cx, c.tcx, 4, dt);
      c.cy = approach(c.cy, c.tcy, 4, dt);
    }

    this.fx.update(dt);
    p.endFrame();
  }

  updateBlink(dt) {
    const r = this.rabbit;
    r.blinkTimer -= dt;
    if (r.blinkTimer <= 0) {
      r.blinkTimer = rand(2.2, 5.5);
      r.blink = 1;
    }
    r.blink = Math.max(0, r.blink - dt * 7);
    r.cheer = Math.max(0, r.cheer - dt);
  }

  updateWheel(dt) {
    const w = this.wheel;
    w.inflation = approach(w.inflation, w.targetInflation, 7, dt);
    w.squash = approach(w.squash, 0, 8, dt);
    for (let i = w.dents.length - 1; i >= 0; i--) {
      const d = w.dents[i];
      d.depth = approach(d.depth, d.live ? d.target : 0, d.live ? 16 : 1.6, dt);
      if (!d.live && d.depth < 0.005) w.dents.splice(i, 1);
    }
    if (w.patch && w.patch.scale < 1) {
      w.patch.t = Math.min(1, (w.patch.t || 0) + dt * 3.2);
      w.patch.scale = easeOutBack(w.patch.t, 2.2);
    }
  }

  /** 穴からのシューッ（パッチを貼るまで続く） */
  leak(dt, strength = 1) {
    this.leakTimer -= dt;
    if (this.leakTimer <= 0) {
      this.leakTimer = 0.34 / strength;
      const h = this.holePos();
      const ax = this.axle;
      const a = Math.atan2(h.y - ax.y, h.x - ax.x);
      this.fx.airPuff(h.x, h.y, Math.cos(a), Math.sin(a), 3, 'world');
    }
  }

  /* ------------------------------------------------------------ 各場面 */

  upTitle(dt) {
    this.rabbit.riding = false;
    this.rabbit.hopT = 0;
    this.rabbit.mood = 'idle';
    this.wheel.targetInflation = 0.08;
    if (this.wheel.hole.reveal > 0) this.wheel.hole.reveal = approach(this.wheel.hole.reveal, 0, 6, dt);
    const p = this.pointer;
    if (p.pressed && !this.uiConsumed) {
      this.audio.unlock();
      this.audio.bell();
      this.go(S.INTRO);
      this.trike.x = -540;
      this.rabbit.riding = true;
      this.rabbit.hopT = 1;
    }
  }

  upIntro(dt) {
    const T = 3.1;
    if (this.st < T) {
      const u = easeInOutCubic(clamp(this.st / T, 0, 1));
      const prev = this.trike.x;
      this.trike.x = lerp(-540, 0, u);
      const d = this.trike.x - prev;
      this.wheel.rot += d / this.wheel.r;
      this.rearRot += d / A.TRIKE.rearR;
      this.rabbit.mood = this.st > T * 0.55 ? 'worried' : 'idle';
      if (Math.random() < dt * 8) this.fx.dust(this.trike.x - 60, -4, -1);
      this.leak(dt, 0.6);
      this.trackRoughness(dt);
    } else if (this.st < T + 1.5) {
      // 降りる。穴が見やすい向き（右斜め上）で車輪を止める
      this.spinHoleUp(dt);
      this.rabbit.mood = 'sad';
      const u = clamp((this.st - T - 0.25) / 0.7, 0, 1);
      this.rabbit.hopT = 1 - easeOutCubic(u);
      if (this.rabbit.hopT <= 0) this.rabbit.riding = false;
      this.leak(dt, 0.9);
    } else {
      this.spinHoleUp(dt);
      this.rabbit.riding = false;
      this.rabbit.hopT = 0;
      this.rabbit.mood = 'sad';
      this.leak(dt, 0.9);
      if (this.st > T + 2.2) this.go(S.TOUCH);
    }
  }

  /** 穴が右斜め上にくるまで、そっと車輪を回す */
  spinHoleUp(dt) {
    const w = this.wheel;
    if (this.rotTarget === null || this.rotTarget === undefined) {
      const want = -0.42 - w.hole.a;
      let d = want - w.rot;
      d -= TAU * Math.round(d / TAU);
      this.rotTarget = w.rot + d;
    }
    const prev = w.rot;
    w.rot = approach(w.rot, this.rotTarget, 4.5, dt);
    this.rearRot += (w.rot - prev) * (w.r / A.TRIKE.rearR);
  }

  upTouch(dt) {
    const w = this.wheel;
    const p = this.pointer;
    this.rabbit.mood = this.touchCount > 0 ? 'worried' : 'sad';
    this.leak(dt, this.touchCount > 0 ? 1.5 : 0.9);

    const ax = this.axle;
    if (p.down && !this.uiConsumed) {
      const wp = this.s2w(p.x, p.y);
      const d = dist(wp.x, wp.y, ax.x, ax.y);
      if (p.pressed && d < w.r * 1.5) {
        // 押した場所がへこむ
        const a = Math.atan2(wp.y - ax.y, wp.x - ax.x);
        this.liveDent = { a: a - w.rot, depth: 0, target: 0.34, live: true };
        w.dents.push(this.liveDent);
        w.squash = 1;
        this.touchCount++;
        this.audio.squish();
        this.audio.hiss();
        // 押すと空気がまとめて漏れる
        const h = this.holePos();
        this.fx.airPuff(h.x, h.y, Math.cos(w.hole.a), Math.sin(w.hole.a), 10, 'world');
        w.targetInflation = Math.max(0.04, w.targetInflation - 0.02);
        if (this.touchCount === 1) this.holeRevealT = 0;
      } else if (this.liveDent && d < w.r * 2.2) {
        const a = Math.atan2(wp.y - ax.y, wp.x - ax.x);
        this.liveDent.a = a - w.rot;
      }
    }
    if (!p.down && this.liveDent) {
      this.liveDent.live = false;
      this.liveDent = null;
    }

    if (this.touchCount > 0) {
      w.hole.reveal = approach(w.hole.reveal, 1, 5, dt);
      this.holeRevealT = (this.holeRevealT || 0) + dt;
      if (this.holeRevealT > 1.5 && !p.down) this.go(S.PATCH);
    }
  }

  upPatch(dt) {
    const p = this.pointer;
    const u = this.ui();
    const w = this.wheel;
    this.rabbit.mood = 'worried';
    this.leak(dt, 1.2);
    w.hole.reveal = approach(w.hole.reveal, 1, 6, dt);

    // 道具置き場の定位置（せり出し中はドックの外から入ってくる）
    const off = (1 - this.tray.in) * (u.thick + 60);
    for (const it of this.patches) {
      const slot = u.slots[it.i];
      it.hx = slot.x + (this.L.portrait ? 0 : off);
      it.hy = slot.y + (this.L.portrait ? off : 0);
      if (it.mode === 'tray') {
        it.x = it.hx;
        it.y = it.hy + Math.sin(this.t * 2.2 + it.wobble) * 3;
        it.s = approach(it.s, 1, 8, dt);
      } else if (it.mode === 'back') {
        it.x = approach(it.x, it.hx, 9, dt);
        it.y = approach(it.y, it.hy, 9, dt);
        it.s = approach(it.s, 1, 9, dt);
        if (dist(it.x, it.y, it.hx, it.hy) < 2) it.mode = 'tray';
      }
    }

    if (p.pressed && !this.uiConsumed && !this.drag) {
      for (const it of this.patches) {
        if (it.mode === 'placed') continue;
        if (dist(p.x, p.y, it.x, it.y) < u.slotR * 1.7) {
          this.drag = it;
          it.mode = 'drag';
          it.grabDX = it.x - p.x;
          it.grabDY = it.y - p.y - u.slotR * 0.5;
          this.audio.pickUp();
          break;
        }
      }
    }

    // パッチが貼れたら、ひと呼吸おいて空気入れへ
    if (this.pendingPump > 0) {
      this.pendingPump -= dt;
      if (this.pendingPump <= 0) this.go(S.PUMP);
      return;
    }

    if (this.drag) {
      const it = this.drag;
      it.x = approach(it.x, p.x + it.grabDX, 30, dt);
      it.y = approach(it.y, p.y + it.grabDY, 30, dt);
      it.s = approach(it.s, 1.25, 10, dt);
      const hs = this.w2s(this.holePos().x, this.holePos().y);
      const snapR = Math.max(this.L.min * 0.3, w.r * this.cam.zoom * 1.5);
      it.near = dist(it.x, it.y, hs.x, hs.y) < snapR;

      if (!p.down) {
        if (it.near) {
          this.placePatch(it);
        } else {
          it.mode = 'back';
        }
        this.drag = null;
      }
    }
  }

  placePatch(it) {
    const w = this.wheel;
    it.mode = 'placed';
    w.patch = { type: it.type, color: it.color, a: w.hole.a, scale: 0, t: 0, grip: 1 };
    this.audio.stick();
    const h = this.holePos();
    this.fx.sparkle(h.x, h.y, 16, '#FFF0B0', 'world', 26);
    this.fx.heart(this.w2s(h.x, h.y).x, this.w2s(h.x, h.y).y, 3, 'screen');
    this.rabbit.mood = 'happy';
    this.rabbit.cheer = 1.2;
    // パッチで塞がると、空気漏れが止まる
    this.leakTimer = 1e9;
    this.pendingPump = 1.1;
  }

  upPump(dt) {
    const p = this.pointer;
    const u = this.ui();
    const w = this.wheel;
    this.rabbit.mood = this.pump.strokes >= NEED_STROKES ? 'happy' : 'idle';

    const stroke = u.pumpH * 0.42;

    // つかむ判定：ポンプまわりの広い矩形ならどこでもよい
    if (p.pressed && !this.uiConsumed && this.pump.in > 0.6) {
      const inX = Math.abs(p.x - this.pumpDrawX) < u.pumpH * 0.62;
      const inY = p.y > this.pumpDrawY - u.pumpH * 1.12 && p.y < this.pumpDrawY + 30;
      if (inX && inY) {
        this.pump.grab = { y: p.y, h: this.pump.handle };
      }
    }
    if (this.pump.grab) {
      if (p.down) {
        this.pump.handle = clamp(this.pump.grab.h + (p.y - this.pump.grab.y) / stroke, 0, 1);
      } else {
        this.pump.grab = null;
      }
    } else {
      this.pump.handle = approach(this.pump.handle, 0, 9, dt);
    }

    // 下まで押し切ったら 1 回ぶんの空気
    if (this.pump.handle > 0.72 && this.pump.armed) {
      this.pump.armed = false;
      this.pump.strokes++;
      this.onPumpStroke();
    }
    if (this.pump.handle < 0.3) this.pump.armed = true;

    const idx = Math.min(this.pump.strokes, INFLATION_STEPS.length - 1);
    w.targetInflation = INFLATION_STEPS[idx];

    if (this.pump.strokes >= NEED_STROKES) {
      this.pumpDoneT = (this.pumpDoneT || 0) + dt;
      if (this.pumpDoneT > 1.4 && !p.down) this.go(S.SPIN);
    }
  }

  onPumpStroke() {
    const w = this.wheel;
    const n = this.pump.strokes;
    this.audio.pump(Math.min(n, 3));
    this.pump.pulse = 1;
    this.pump.shake = 1;
    w.squash = -1;
    const v = this.valvePos();
    this.fx.airPuff(v.x, v.y, 0.2, -1, 5, 'world');
    // 空気が入るとへこみも戻る
    for (const d of w.dents) { d.target *= 0.3; d.depth *= 0.5; }
    if (n === NEED_STROKES) {
      this.audio.full();
      const ax = this.axle;
      this.fx.sparkle(ax.x, ax.y, 26, '#FFF0B0', 'world', w.r);
      this.rabbit.cheer = 1.4;
      this.rabbit.mood = 'happy';
    } else if (n < NEED_STROKES) {
      const ax = this.axle;
      this.fx.sparkle(ax.x, ax.y, 8, '#CFEFFF', 'world', w.r * 0.8);
    }
  }

  upSpin(dt) {
    const p = this.pointer;
    const w = this.wheel;
    const ax = this.axle;
    this.rabbit.mood = 'happy';

    if (p.down && !this.uiConsumed) {
      const wp = this.s2w(p.x, p.y);
      const d = dist(wp.x, wp.y, ax.x, ax.y);
      if (p.pressed && d < w.r * 1.55) this.spinGrab = true;
      if (this.spinGrab) {
        const a = Math.atan2(wp.y - ax.y, wp.x - ax.x);
        if (this.lastSpinA !== undefined) {
          let da = a - this.lastSpinA;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          w.rot += da;
          this.spinAmount += Math.abs(da);
          this.rearRot += da * (w.r / A.TRIKE.rearR);
          // 指の動きが遅くても、そのぶん勢いをつけてやる（幼児の手加減に合わせる）
          if (dt > 0) w.omega = clamp(w.omega * 0.55 + (da / dt) * 0.9, -26, 26);
        }
        this.lastSpinA = a;
      }
    } else {
      if (this.spinGrab) {
        // ちょっとでも回せたら「弾けた」とみなす
        if (this.spinAmount > 0.45 || Math.abs(w.omega) > 1.2) {
          if (!this.flicked) this.audio.spin();
          this.flicked = true;
          if (Math.abs(w.omega) < 3) w.omega = 3 * Math.sign(w.omega || 1);
        }
      }
      this.spinGrab = false;
      this.lastSpinA = undefined;
    }

    if (!this.spinGrab) {
      const prev = w.rot;
      w.rot += w.omega * dt;
      this.rearRot += (w.rot - prev) * (w.r / A.TRIKE.rearR);
      w.omega *= Math.exp(-1.05 * dt);
      if (Math.abs(w.omega) < 0.05) w.omega = 0;
    }

    if (Math.abs(w.omega) > 4 && Math.random() < dt * 12) {
      const a = rand(0, TAU);
      this.fx.sparkle(ax.x + Math.cos(a) * w.r, ax.y + Math.sin(a) * w.r, 1, '#FFFFFF', 'world', 4);
    }

    if (this.flicked && !this.spinGrab) {
      this.spinIdle += dt;
      if ((Math.abs(w.omega) < 0.7 && this.spinIdle > 1.0) || this.spinIdle > 7) {
        this.go(S.READY);
      }
    }
  }

  upReady(dt) {
    const w = this.wheel;
    w.rot += w.omega * dt;
    w.omega *= Math.exp(-2.2 * dt);
    this.rabbit.mood = 'happy';
    // うさぎが乗る
    const u = clamp((this.st - 0.35) / 0.65, 0, 1);
    this.rabbit.riding = true;
    this.rabbit.hopT = easeOutCubic(u);
    const p = this.pointer;
    if (this.st > 0.85 && ((p.pressed && !this.uiConsumed) || this.st > 6.5)) {
      this.startDrive();
    }
  }

  startDrive() {
    // 速度プロファイルを積分してゴール位置を決める（時間 = 17 秒ちょうど）
    let d = 0;
    const step = 1 / 120;
    for (let t = 0; t < DRIVE_DURATION; t += step) d += this.driveSpeed(t) * step;
    this.goalX = this.trike.x + d;
    this.driveStartX = this.trike.x;
    this.driveT = 0;
    this.rideRough = 0;
    this.roughShown = 0;
    this.roughBuf = [];
    this.go(S.DRIVE);
    this.audio.bell();
  }

  /**
   * 走りのなめらかさ＝車軸の上下動。
   * 空気が少ない・へこみが残っている ほど大きくなる。
   * 登場シーン（ぺしゃんこ）と試運転（修理後）で同じ計算を使う。
   */
  trackRoughness(dt) {
    const buf = this.roughBuf;
    buf.push(this.t, this.frontRadius);
    while (buf.length > 2 && this.t - buf[0] > 0.55) buf.splice(0, 2);
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 1; i < buf.length; i += 2) {
      if (buf[i] < mn) mn = buf[i];
      if (buf[i] > mx) mx = buf[i];
    }
    // 直近 0.55 秒で車軸が何割ぶん上下したか
    const amp = mx > mn ? (mx - mn) / this.wheel.r : 0;
    this.rideRough = approach(this.rideRough, amp, 8, dt);
    this.roughShown = approach(this.roughShown, this.rideRough, 6, dt);
  }

  driveSpeed(t) {
    const up = smoothstep(0, 1.9, t);
    const down = 1 - smoothstep(DRIVE_DURATION - 2.7, DRIVE_DURATION, t);
    return CRUISE * up * down;
  }

  upDrive(dt) {
    const w = this.wheel;
    this.driveT += dt;
    const v = this.driveSpeed(this.driveT);
    const d = v * dt;
    this.trike.x += d;
    w.rot += d / w.r;
    this.rearRot += d / A.TRIKE.rearR;
    this.rabbit.mood = this.rabbit.cheer > 0 ? 'cheer' : 'happy';

    this.trackRoughness(dt);

    if (v > 30 && Math.random() < dt * 10) this.fx.dust(this.trike.x - 80, -4, -1);
    // ガタガタの時は砂ぼこりが大きく跳ねる
    if (this.roughShown > 0.08 && Math.random() < dt * 14) this.fx.dust(this.trike.x + 110, -6, -1);

    const p = this.pointer;
    if (p.pressed && !this.uiConsumed) {
      this.fx.heart(p.x, p.y, 3, 'screen');
      this.fx.sparkle(p.x, p.y, 6, '#FFE9A3', 'screen', 14);
      this.audio.bell();
      this.rabbit.cheer = 0.9;
    }

    if (this.driveT >= DRIVE_DURATION) {
      this.go(S.FINALE);
      this.audio.fanfare();
      this.confettiTimer = 0;
    }
  }

  upFinale(dt) {
    this.rabbit.mood = 'cheer';
    this.rabbit.cheer = 1;
    this.medal = Math.min(1, this.medal + dt * 1.1);
    this.confettiTimer -= dt;
    if (this.confettiTimer <= 0 && this.st < 6) {
      this.confettiTimer = 0.45;
      this.fx.confetti(rand(this.L.w * 0.15, this.L.w * 0.85), this.L.h * 0.28, 18, 'screen');
    }
    const p = this.pointer;
    const b = this.mainButton();
    if (this.st > 1.6 && p.pressed && !this.uiConsumed && dist(p.x, p.y, b.x, b.y) < b.r * 1.5) {
      this.audio.bell();
      this.reset();
      this.cam.init = false;
    }
  }

  go(state) {
    this.state = state;
    this.st = 0;
    this.hint = 0;
    this.drag = null;
    if (this.liveDent) { this.liveDent.live = false; this.liveDent = null; }
    if (state === S.SPIN) { this.flicked = false; this.spinIdle = 0; this.spinAmount = 0; }
  }

  /* ------------------------------------------------------------- 描画 */

  draw() {
    const ctx = this.ctx;
    const L = this.L;
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.clearRect(0, 0, L.w, L.h);

    const ground = this.w2s(0, 0).y;
    A.drawSky(ctx, L);
    A.drawSun(ctx, L, this.t);
    A.drawClouds(ctx, L, this.t, this.cam.x, this.cam.zoom);
    A.drawBirds(ctx, L, this.t, this.cam.x, this.cam.zoom);
    A.drawHills(ctx, L, ground, this.cam.x, this.cam.zoom);

    // --- ワールド（カメラ変換の内側）
    ctx.save();
    ctx.translate(this.cam.cx, this.cam.cy);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);

    const tl = this.s2w(0, 0);
    const br = this.s2w(L.w, L.h);
    A.drawGroundWorld(ctx, tl.x - 60, br.x + 60, br.y + 60);
    this.drawScenery(ctx, tl.x, br.x);
    this.drawTrike(ctx);
    this.fx.draw(ctx, 'world');
    ctx.restore();

    // --- 画面まわり
    this.fx.draw(ctx, 'screen');
    this.drawUI(ctx);
    for (const r of this.ripples) A.drawRipple(ctx, r.x, r.y, r.t);
    this.drawHints(ctx);
  }

  drawScenery(ctx, x0, x1) {
    // 木（決まった位置に生える）
    const step = 310;
    for (let i = Math.floor(x0 / step) - 1; i <= Math.ceil(x1 / step) + 1; i++) {
      const h = hash1(i * 1.7);
      const x = i * step + h * 160;
      if (x < x0 - 300 || x > x1 + 300) continue;
      // 三輪車の作業スペースには木を置かない
      if (Math.abs(x) < 420) continue;
      A.drawTree(ctx, x, 1.35 + h * 0.75, this.t, i);
    }
    // ちょうちょ
    for (let i = 0; i < 3; i++) {
      const h = hash1(i * 9.4);
      const bx = x0 + ((this.t * (18 + h * 20) + h * 900) % (x1 - x0 + 400)) - 200;
      const by = -120 - h * 130 + Math.sin(this.t * 2.4 + i * 2) * 22;
      this.drawButterfly(ctx, bx, by, i);
    }
    // ゴールのアーチ
    if (this.state === S.DRIVE || this.state === S.FINALE || this.state === S.READY) {
      A.drawGoalArch(ctx, this.goalX + 210, this.t);
      A.drawFlag(ctx, this.goalX - 190, this.t);
      A.drawFlag(ctx, this.goalX + 430, this.t + 1);
      // 出むかえの友だち
      for (let i = 0; i < 2; i++) {
        ctx.save();
        ctx.translate(this.goalX + 196 + i * 130, -66 - Math.abs(Math.sin(this.t * 3 + i)) * 12);
        ctx.scale(0.62, 0.62);
        A.drawRabbit(ctx, { mood: 'cheer', t: this.t + i * 1.3, blink: 0 });
        ctx.restore();
      }
    }
  }

  drawButterfly(ctx, x, y, i) {
    const f = Math.sin(this.t * 14 + i * 2);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(this.t * 2 + i) * 0.2);
    ctx.fillStyle = ['#FFD36E', '#FF9EB5', '#C6A8F5'][i % 3];
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.scale(s * (0.4 + Math.abs(f) * 0.6), 1);
      ctx.beginPath();
      ctx.ellipse(7, -3, 8, 6, -0.3, 0, TAU);
      ctx.ellipse(6, 4, 6, 5, 0.3, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#5A4A55';
    ctx.beginPath();
    ctx.ellipse(0, 0, 2.4, 7, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawTrike(ctx) {
    const w = this.wheel;
    const ax = this.axle;
    const th = this.tilt;
    const [rx, ry] = A.TRIKE.rearHub;

    // 影
    ctx.fillStyle = 'rgba(45,70,55,0.2)';
    ctx.beginPath();
    ctx.ellipse(this.trike.x + 30, -2, 190, 15, 0, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.translate(this.trike.x, 0);
    ctx.translate(rx, ry);
    ctx.rotate(th);
    ctx.translate(-rx, -ry);
    A.drawTrikeBack(ctx, this.rearRot);
    ctx.restore();

    // 前輪（世界に対してまっすぐ＝つぶれは常に接地側）
    ctx.save();
    ctx.translate(ax.x, ax.y);
    const sq = 1 + w.squash * 0.05;
    ctx.scale(1 / sq, sq);
    A.drawWheel(ctx, w, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(this.trike.x, 0);
    ctx.translate(rx, ry);
    ctx.rotate(th);
    ctx.translate(-rx, -ry);
    A.drawCranks(ctx, w.rot, A.TRIKE.frontHub[1]);
    A.drawTrikeMid(ctx, this.rearRot);
    this.drawRabbitOnTrike(ctx);
    A.drawTrikeFront(ctx, this.t);
    ctx.restore();

    // 立っているうさぎ
    if (this.rabbit.hopT < 1) this.drawRabbitStanding(ctx, 1 - this.rabbit.hopT);
  }

  drawRabbitOnTrike(ctx) {
    const r = this.rabbit;
    if (r.hopT <= 0.02) return;
    const seat = [A.TRIKE.seat[0] + 2, A.TRIKE.seat[1] - 46];
    const pedals = A.pedalPos(this.wheel.rot);
    ctx.save();
    ctx.globalAlpha = 1;
    const hop = (1 - r.hopT) * 60;
    ctx.translate(seat[0] - (1 - r.hopT) * 150, seat[1] - hop * 1.2);
    ctx.scale(RABBIT_SCALE, RABBIT_SCALE);
    const toLocal = (p) => [
      (p[0] - seat[0]) / RABBIT_SCALE,
      (p[1] - seat[1]) / RABBIT_SCALE,
    ];
    A.drawRabbit(ctx, {
      mood: r.mood,
      t: this.t,
      blink: r.blink,
      hands: toLocal([132, -161]),
      feet: [toLocal(pedals[0]), toLocal(pedals[1])],
      bounce: -this.roughShown * 70,
      lean: 0.04 + this.roughShown * 0.5 * Math.sin(this.t * 19),
    });
    ctx.restore();
  }

  drawRabbitStanding(ctx, a) {
    const r = this.rabbit;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(this.trike.x + 243, -64 * RABBIT_SCALE - Math.abs(Math.sin(this.t * 2)) * 2);
    ctx.scale(-RABBIT_SCALE, RABBIT_SCALE); // 左を向く
    A.drawRabbit(ctx, { mood: r.mood, t: this.t, blink: r.blink });
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------- UI */

  drawUI(ctx) {
    const L = this.L;
    const u = this.ui();

    if (this.state === S.TITLE) this.drawTitle(ctx);

    // 道具置き場（せり出す木のカウンター）
    if (this.dockIn > 0.01) {
      const k = this.dockIn;
      const d = u.dock;
      ctx.save();
      ctx.translate(L.portrait ? 0 : (1 - k) * u.thick * 1.1, L.portrait ? (1 - k) * u.thick * 1.1 : 0);
      A.drawDock(ctx, d, L.portrait);
      ctx.restore();
    }

    // 3 種類のパッチ
    if (this.tray.in > 0.01) {
      for (const it of this.patches) {
        if (it.mode === 'placed') continue;
        A.drawSlot(ctx, it.hx, it.hy, u.slotR);
      }
      for (const it of this.patches) {
        if (it.mode === 'placed') continue;
        ctx.save();
        ctx.globalAlpha = clamp(this.tray.in * 1.4, 0, 1);
        ctx.translate(it.x, it.y);
        if (it.mode === 'drag') ctx.rotate(Math.sin(this.t * 9) * 0.06);
        A.drawPatchShape(ctx, it.type, u.slotR * 0.85 * it.s, it.color);
        ctx.restore();
      }
      // 吸い付く範囲を光らせる
      if (this.drag) {
        const hs = this.w2s(this.holePos().x, this.holePos().y);
        const snapR = Math.max(L.min * 0.3, this.wheel.r * this.cam.zoom * 1.5);
        ctx.save();
        ctx.globalAlpha = this.drag.near ? 0.55 : 0.25;
        ctx.strokeStyle = '#FFF0A8';
        ctx.setLineDash([12, 10]);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(hs.x, hs.y, snapR, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 空気入れ
    if (this.pump.in > 0.01) {
      const px = this.pumpDrawX + this.pump.shake * Math.sin(this.t * 40) * 3;
      const py = this.pumpDrawY;
      const v = this.valvePos();
      const vs = this.w2s(v.x, v.y);
      const g = A.pumpGeom(px, py, u.pumpH);
      A.drawHose(ctx, g.nozzleX, g.nozzleY, vs.x, vs.y, this.pump.pulse);
      A.drawPump(ctx, px, py, u.pumpH, this.pump.handle);
      A.drawGauge(ctx, g.gaugeX, g.gaugeY, g.gaugeR, this.wheel.inflation);
      // 何回押したかを丸で示す（数字は使わない）
      const dotR = clamp(L.min * 0.026, 8, 16);
      for (let i = 0; i < NEED_STROKES; i++) {
        const dx = u.dotX + (i - 1) * dotR * 3 + (L.portrait ? 0 : (1 - this.pump.in) * u.thick);
        const dy = u.dotY + (L.portrait ? (1 - this.pump.in) * u.thick : 0);
        const on = i < this.pump.strokes;
        ctx.fillStyle = on ? '#FFD36E' : 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.arc(dx, dy, dotR * (on ? 1.15 : 0.85), 0, TAU);
        ctx.fill();
        ctx.strokeStyle = on ? '#E0A93C' : 'rgba(150,120,80,0.5)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        if (on) {
          ctx.fillStyle = 'rgba(255,255,255,0.65)';
          ctx.beginPath();
          ctx.arc(dx - dotR * 0.3, dy - dotR * 0.35, dotR * 0.3, 0, TAU);
          ctx.fill();
        }
      }
    }

    // 試運転の進み具合
    if (this.state === S.DRIVE) {
      const x0 = u.muteX + u.btnR + 22;
      const w = Math.max(120, Math.min(L.w * 0.62, 460, L.w - L.safe.r - 26 - x0));
      const p = clamp((this.trike.x - this.driveStartX) / Math.max(1, this.goalX - this.driveStartX), 0, 1);
      A.drawProgressRibbon(ctx, x0, L.safe.t + clamp(L.min * 0.055, 26, 50), w, p, this.t);
    }

    // ゴール後
    if (this.state === S.FINALE) {
      const m = easeOutBack(clamp(this.medal, 0, 1));
      A.drawMedal(ctx, L.w / 2, L.h * 0.3, clamp(L.min * 0.11, 44, 90) * m, this.t);
      if (this.st > 1.6) {
        const b = this.mainButton();
        const pulse = 1 + Math.sin(this.t * 3) * 0.04;
        A.drawPulseRing(ctx, b.x, b.y, b.r * 1.3, this.t, '#FFFFFF');
        A.drawRoundButton(ctx, b.x, b.y, b.r * pulse, '#59C08A', A.iconReplay);
      }
    }

    // 音のオン・オフ
    A.drawRoundButton(ctx, u.muteX, u.muteY, u.btnR, this.muted ? '#9AA6B2' : '#F0A03C', A.iconSpeaker(this.muted));
  }

  drawTitle(ctx) {
    const L = this.L;
    const u = this.ui();
    const cx = L.w / 2;
    const top = u.muteY + u.btnR + 14;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const s1 = clamp(L.min * 0.115, 34, 82);
    ctx.font = `900 ${s1}px "Hiragino Maru Gothic ProN","Hiragino Sans","Yu Gothic",sans-serif`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = s1 * 0.32;
    ctx.strokeStyle = '#FFFFFF';
    ctx.strokeText('りんりん！', cx, top + s1 * 0.6);
    const g = ctx.createLinearGradient(0, top, 0, top + s1);
    g.addColorStop(0, '#FF9DAE');
    g.addColorStop(1, '#F2657A');
    ctx.fillStyle = g;
    ctx.fillText('りんりん！', cx, top + s1 * 0.6);

    const s2 = s1 * 0.42;
    ctx.font = `800 ${s2}px "Hiragino Maru Gothic ProN","Hiragino Sans","Yu Gothic",sans-serif`;
    ctx.lineWidth = s2 * 0.36;
    ctx.strokeStyle = '#FFFFFF';
    ctx.strokeText('ちいさな のりもの しゅうりやさん', cx, top + s1 * 1.35);
    ctx.fillStyle = '#4E7C8C';
    ctx.fillText('ちいさな のりもの しゅうりやさん', cx, top + s1 * 1.35);
    ctx.restore();

    // あそびかたは「押せばはじまる」だけ
    const b = this.mainButton();
    A.drawPulseRing(ctx, b.x, b.y, b.r * 1.3, this.t, '#FFFFFF');
    A.drawRoundButton(ctx, b.x, b.y, b.r * (1 + Math.sin(this.t * 3) * 0.045), '#59C08A', A.iconPlay);
  }

  /* --------------------------------------------------- お手本（読まずに分かる） */

  drawHints(ctx) {
    const L = this.L;
    const u = this.ui();
    const show = this.hint > 1.6;
    const loop = (this.t % 2.6) / 2.6;
    const ax = this.axle;
    const as = this.w2s(ax.x, ax.y);
    const wr = this.wheel.r * this.cam.zoom;
    const hs = this.w2s(this.holePos().x, this.holePos().y);
    const handS = clamp(L.min / 620, 0.55, 1.5);

    switch (this.state) {
      case S.TITLE: {
        if (!show) break;
        const b = this.mainButton();
        const press = Math.max(0, Math.sin(loop * TAU * 2));
        A.drawHand(ctx, b.x + 26, b.y + 34, handS, 0.9, 0, press);
        break;
      }
      case S.TOUCH: {
        A.drawPulseRing(ctx, as.x, as.y, wr * 0.9, this.t);
        if (!show) break;
        const press = Math.max(0, Math.sin(loop * TAU * 2));
        A.drawHand(ctx, as.x + wr * 0.25, as.y + wr * 0.1 + 24 - press * 10, handS, 0.9, 0, press);
        break;
      }
      case S.PATCH: {
        if (this.wheel.patch) break;
        A.drawPulseRing(ctx, hs.x, hs.y, wr * 0.42, this.t, '#FFF0A8');
        if (!this.drag) {
          for (const it of this.patches) {
            if (it.mode !== 'tray') continue;
            A.drawPulseRing(ctx, it.x, it.y, u.slotR * 1.15, this.t + it.i * 0.4, '#FFFFFF');
          }
        }
        if (!show || this.drag) break;
        // トレイ → 穴 へ運ぶお手本
        const p = easeInOutCubic(clamp(loop * 1.5, 0, 1));
        const src = this.patches[1];
        const hx = lerp(src.hx, hs.x, p);
        const hy = lerp(src.hy, hs.y, p) - Math.sin(p * PI) * 40;
        ctx.save();
        ctx.globalAlpha = 0.5 * (loop < 0.72 ? 1 : (1 - (loop - 0.72) / 0.28));
        A.drawPatchShape(ctx, src.type, u.slotR * 0.8, src.color);
        ctx.restore();
        A.drawHand(ctx, hx + 18, hy + 34, handS, 0.85 * (loop < 0.72 ? 1 : (1 - (loop - 0.72) / 0.28)), 0, 0.5);
        break;
      }
      case S.PUMP: {
        if (this.pump.strokes >= NEED_STROKES) break;
        const stroke = u.pumpH * 0.42;
        const bodyH = u.pumpH * 0.56;
        const px = this.pumpDrawX ?? u.pumpX;
        const py = this.pumpDrawY ?? u.pumpY;
        const topY = py - bodyH - stroke;
        A.drawPulseRing(ctx, px, topY, u.pumpH * 0.2, this.t, '#FFFFFF');
        const dn = 0.5 - Math.cos(loop * TAU * 2) * 0.5;
        A.drawArrow(ctx, px + u.pumpH * 0.42, topY + stroke * 0.5, u.pumpH * 0.3, PI / 2, 0.65 + dn * 0.3, '#FFE9A3');
        if (!show) break;
        A.drawHand(ctx, px + u.pumpH * 0.2, topY + stroke * dn + 26, handS, 0.9, 0, 0.6);
        break;
      }
      case S.SPIN: {
        A.drawPulseRing(ctx, as.x, as.y, wr * 0.9, this.t, '#CFEFFF');
        // くるっと回すことを示す弧の矢印
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = Math.max(4, wr * 0.09);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(as.x, as.y, wr * 1.16, -PI * 0.9, -PI * 0.15);
        ctx.stroke();
        ctx.restore();
        A.drawArrow(ctx, as.x + wr * 1.16 * Math.cos(-PI * 0.15), as.y + wr * 1.16 * Math.sin(-PI * 0.15), wr * 0.5, PI * 0.42, 0.85, '#FFFFFF');
        if (!show) break;
        const p = loop < 0.6 ? easeOutCubic(loop / 0.6) : 1;
        const a0 = PI * 0.85;
        const a1 = PI * 0.15;
        const aa = lerp(a0, a1, p);
        const hx = as.x + Math.cos(-aa) * wr * 0.75;
        const hy = as.y + Math.sin(-aa) * wr * 0.75;
        A.drawHand(ctx, hx, hy + 20, handS, 0.85 * (loop < 0.75 ? 1 : (1 - (loop - 0.75) / 0.25)), 0, 0.6);
        break;
      }
      case S.READY: {
        if (this.st < 0.85) break;
        const b = this.mainButton();
        A.drawPulseRing(ctx, b.x, b.y, b.r * 1.3, this.t, '#FFFFFF');
        A.drawRoundButton(ctx, b.x, b.y, b.r * (1 + Math.sin(this.t * 3) * 0.05), '#59C08A', A.iconPlay);
        if (show) {
          const press = Math.max(0, Math.sin(loop * TAU * 2));
          A.drawHand(ctx, b.x + 24, b.y + 34, handS, 0.9, 0, press);
        }
        break;
      }
      default: break;
    }
  }
}
