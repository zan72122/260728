// エントリポイント。ワールド(全状態)とメインループを持つ。
// 描画順: 背景 → 紙 → にじみ → 紐 → ピン → 反応オブジェクト →
//          水たまり → しずく → 飛沫 → 雲 → 操作オーバーレイ → ヒント

import { CONFIG } from './config.js';
import { PALETTE } from './color.js';
import { Pin, Rope, drawRopePreview } from './strings.js';
import { DropletSystem } from './droplets.js';
import { ParticleSystem } from './particles.js';
import { StainLayer } from './stains.js';
import { Cup, Sponge, Paper, PuddleManager } from './reactions.js';
import { Flower } from './flowers.js';
import { drawBackground, Cloud, drawHint } from './scene.js';
import { InputHandler } from './input.js';
import { buildUI } from './ui.js';
import { sounds } from './audio.js';

const TOP_BAR_BOTTOM = 92;   // 色ボタン帯のぶんだけ雲を下げる
const SHELF_DEPTH = 78;      // 床(棚)の高さ
const SIDE_TRAY_PAD = 88;    // 左右トレイのぶんの余白

class World {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.groundY = 0;
    this.objectScale = 1;

    this.pins = [];
    this.ropes = [];
    this.droplets = new DropletSystem(this);
    this.particles = new ParticleSystem();
    this.stains = new StainLayer();
    this.puddles = new PuddleManager();
    this.cloud = new Cloud();

    // 底辺の反応オブジェクト(左の縦トレイを避けて右寄りに配置)
    this.paper = new Paper(0.22);
    this.flowers = [new Flower(0.36, [1, 0.15, 0.25]), new Flower(0.90, [0.9, 0.1, 0.6])];
    this.cups = [new Cup(0.44), new Cup(0.635)];
    this.sponge = new Sponge(0.77);

    this.tool = 'pin';
    this.currentColor = this._colorEntry('blue');
    this.firstDripDone = false;
    this.undoStack = [];
    this.delayed = [];
    this.time = 0;

    this.input = new InputHandler(this, canvas);
    this.ui = buildUI(this, uiRoot);

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.defaultScene();
  }

  _colorEntry(id) {
    const entry = PALETTE.find((c) => c.id === id) ?? PALETTE[4];
    return { id: entry.id, ryb: entry.ryb, rainbow: entry.id === 'rainbow' };
  }

  setColor(id) {
    this.currentColor = this._colorEntry(id);
  }

  setTool(id) {
    this.tool = id;
    this.input.selectedPin = null;
    this.input.stringPreview = null;
  }

  // ------------------------------------------------------------ レイアウト
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const oldW = this.width || w;
    const oldH = this.height || h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = w;
    this.height = h;
    this.groundY = h - SHELF_DEPTH;
    this.objectScale = Math.min(1.15, Math.max(0.62, w / 760));

    // 既存のピンと雲は相対位置を保って引っ越し
    if (oldW !== w || oldH !== h) {
      for (const p of this.pins) {
        p.x = (p.x / oldW) * w;
        p.y = (p.y / oldH) * h;
      }
      this.cloud.x = (this.cloud.x / oldW) * w;
    }
    this.stains.resize(w, h);
    this.cloud.layout(w, h, TOP_BAR_BOTTOM);
    this.paper.layout(w, this.groundY, this.objectScale);
    for (const f of this.flowers) f.layout(w, this.groundY, this.objectScale);
    for (const c of this.cups) c.layout(w, this.groundY, this.objectScale);
    this.sponge.layout(w, this.groundY, this.objectScale);
  }

  pinBounds() {
    // 左右の縦トレイ(UI)の下にピンが隠れないよう余白を取る
    return {
      minX: SIDE_TRAY_PAD,
      maxX: this.width - SIDE_TRAY_PAD,
      minY: this.cloud.y + 58,
      maxY: this.groundY - 84,
    };
  }

  // ------------------------------------------------------------ 初期シーン
  defaultScene() {
    this.pins = [];
    this.ropes = [];
    this.droplets.items = [];
    this.particles.items = [];
    this.puddles.reset();
    this.stains.clear();
    this.undoStack = [];
    this.delayed = [];
    for (const c of this.cups) c.reset();
    this.sponge.reset();
    for (const f of this.flowers) { f.stage = 0; f.water = 0; }

    // 最初から遊べるお手本: ピン3本と紐1本
    const w = this.width;
    const h = this.height;
    const a = this.addPin(w * 0.32, h * 0.38);
    const b = this.addPin(w * 0.60, h * 0.50);
    this.addPin(w * 0.78, h * 0.34);
    const rope = new Rope(a, b);
    this.ropes.push(rope);
    // お手本の紐は「たわみの腹」から滴下するので、その真下にカップを置く。
    // 雲を押すだけで しずく→紐→カップ の成功体験がすぐ得られる。
    let low = rope._samples[0];
    for (const p of rope._samples) if (p.y > low.y) low = p;
    this.cups[1].xRatio = Math.min(0.7, low.x / w - 0.006);
    this.cups[1].layout(w, this.groundY, this.objectScale);
    this.cloud.x = w * 0.32;
    this.currentColor = this._colorEntry('blue');
    this.ui?.refresh();
  }

  // ------------------------------------------------------------ 構造の操作
  canPlacePin(x, y) {
    const b = this.pinBounds();
    if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) return false;
    for (const p of this.pins) {
      if (Math.hypot(p.x - x, p.y - y) < CONFIG.MIN_PIN_DIST) return false;
    }
    return true;
  }

  addPin(x, y) {
    const pin = new Pin(x, y);
    this.pins.push(pin);
    return pin;
  }

  removePin(pin) {
    for (const rope of this.ropes.filter((r) => r.a === pin || r.b === pin)) {
      this.removeRope(rope);
    }
    this.pins = this.pins.filter((p) => p !== pin);
    this.particles.sparkle(pin.x, pin.y, 4);
    if (this.input.selectedPin === pin) this.input.selectedPin = null;
  }

  removeRope(rope) {
    this.droplets.releaseRope(rope);
    this.ropes = this.ropes.filter((r) => r !== rope);
  }

  connectPins(a, b) {
    if (a === b) return;
    const exists = this.ropes.some(
      (r) => (r.a === a && r.b === b) || (r.a === b && r.b === a),
    );
    if (exists) return;
    this.pushUndo();
    const rope = new Rope(a, b);
    rope.excite(0.8);
    this.ropes.push(rope);
    sounds.stretch();
  }

  // ------------------------------------------------------------ アンドゥ
  pushUndo() {
    this.undoStack.push({
      pins: [...this.pins],
      pinPos: this.pins.map((p) => [p.x, p.y]),
      ropes: [...this.ropes],
    });
    if (this.undoStack.length > CONFIG.UNDO_LIMIT) this.undoStack.shift();
  }

  undo() {
    const snap = this.undoStack.pop();
    if (!snap) return;
    this.pins = snap.pins;
    snap.pinPos.forEach(([x, y], i) => {
      this.pins[i].x = x;
      this.pins[i].y = y;
    });
    this.ropes = snap.ropes;
    this.input.selectedPin = null;
    this.input.stringPreview = null;
  }

  // ------------------------------------------------------------ リセット
  /** 液体とシミだけ片づける(作った紐は残す) */
  clearLiquid() {
    this.droplets.items = [];
    this.particles.items = [];
    this.puddles.reset();
    this.stains.clear();
    this.delayed = [];
    for (const c of this.cups) c.reset();
    this.sponge.reset();
    for (const f of this.flowers) f.reset();
    for (const r of this.ropes) { r.wet = 0; }
  }

  resetAll() {
    this.defaultScene();
  }

  // ------------------------------------------------------------ 反応の振り分け
  /** 空中のしずくがオブジェクトに入ったか(入ったら消費して true) */
  tryCatch(drop, prevY) {
    for (const cup of this.cups) {
      if (cup.tryCatch(drop, prevY, this)) return true;
    }
    if (this.sponge.tryCatch(drop, prevY, this)) return true;
    if (this.paper.tryCatch(drop, prevY, this)) return true;
    return false;
  }

  /** 床に落ちたしずくの反応 */
  onFloorHit(drop) {
    const ryb = drop.currentRyb(this.time);
    // 花の根元なら、お水をあげる
    for (const f of this.flowers) {
      if (Math.abs(drop.x - f.x) < 42 * this.objectScale) {
        f.drink(drop.vol, ryb, this);
        this.particles.splash(drop.x, this.groundY - 2, ryb, drop.vol * 0.5);
        this.stains.stamp(drop.x, this.groundY + 3, drop.r * 1.6, ryb, 0.1);
        sounds.splash(drop.vol * 0.5);
        return;
      }
    }
    // それ以外は水たまりとシミになる
    this.puddles.add(drop.x, drop.vol, ryb, this);
    this.stains.stamp(drop.x, this.groundY + 4, drop.r * 2.4, ryb, 0.12);
    this.particles.splash(drop.x, this.groundY - 2, ryb, drop.vol * 0.6);
  }

  /** 少し遅らせて実行(紙のにじみがじわっと広がる表現などに使う) */
  later(delay, fn) {
    this.delayed.push({ at: this.time + delay, fn });
  }

  // ------------------------------------------------------------ 更新と描画
  update(dt) {
    this.time += dt;
    const t = this.time;

    // 遅延キュー
    if (this.delayed.length) {
      const due = this.delayed.filter((d) => d.at <= t);
      this.delayed = this.delayed.filter((d) => d.at > t);
      for (const d of due) d.fn();
    }

    for (const p of this.pins) p.update(dt);
    for (const r of this.ropes) r.update(dt, t);
    this.cloud.update(dt, this);
    this.droplets.update(dt, t);
    for (const c of this.cups) c.update(dt, this);
    this.sponge.update(dt, this);
    this.paper.update(dt);
    for (const f of this.flowers) f.update(dt, this, t);
    this.puddles.update(dt, this);
    this.particles.update(dt);
    this.stains.update(dt);
  }

  draw() {
    const ctx = this.ctx;
    const t = this.time;
    drawBackground(ctx, this.width, this.height, this.groundY, t);
    this.paper.drawSheet(ctx, t);
    this.stains.draw(ctx);
    for (const r of this.ropes) r.draw(ctx);
    if (this.input.stringPreview) {
      const pv = this.input.stringPreview;
      drawRopePreview(ctx, pv.pin, pv.x, pv.y);
    }
    for (const p of this.pins) p.draw(ctx);
    for (const c of this.cups) c.draw(ctx, t);
    this.sponge.draw(ctx);
    for (const f of this.flowers) f.draw(ctx, t);
    this.puddles.draw(ctx, this.groundY + 6);
    this.droplets.draw(ctx, t);
    this.particles.draw(ctx, t);
    this.cloud.draw(ctx, this, t);
    this.input.drawOverlay(ctx, t);
    if (!this.firstDripDone) drawHint(ctx, this.cloud, t);
  }
}

// ------------------------------------------------------------------ 起動
const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');
const world = new World(canvas, uiRoot);
window.world = world; // 自動テスト・デバッグ用フック

let last = performance.now();
function frame(now) {
  // タブ復帰などの巨大 dt で物理が破綻しないよう上限を設ける
  const dt = Math.min(0.033, Math.max(0.001, (now - last) / 1000));
  last = now;
  world.update(dt);
  world.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
