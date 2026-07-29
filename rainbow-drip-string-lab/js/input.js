// ポインタ入力。4歳児の「ざっくりタッチ」前提で、判定はすべて大きめ。
// マルチタッチ対応: 指ごとに独立したジェスチャを持てる
// (片手で雲を押しながら、もう片方の手でピンを動かせる)。

import { sounds } from './audio.js';

const TAP_MOVE_LIMIT = 14; // これ以内の移動なら「タップ」とみなす

export class InputHandler {
  constructor(world, canvas) {
    this.world = world;
    this.canvas = canvas;
    this.gestures = new Map();   // pointerId -> gesture
    this.selectedPin = null;     // タップ→タップで紐を張るときの1本目
    this.stringPreview = null;   // {pin, x, y} ドラッグ中のプレビュー

    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e));
    canvas.addEventListener('pointercancel', (e) => this._up(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _findPin(x, y) {
    const pins = this.world.pins;
    for (let i = pins.length - 1; i >= 0; i--) {
      if (pins[i].hit(x, y)) return pins[i];
    }
    return null;
  }

  _findRope(x, y) {
    let best = null;
    let bestD = 20; // 紐のタッチ判定はゆるめ
    for (const rope of this.world.ropes) {
      const n = rope.nearest(x, y);
      if (n.dist < bestD) { bestD = n.dist; best = rope; }
    }
    return best;
  }

  _down(e) {
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    sounds.unlock();
    const { x, y } = this._pos(e);
    const world = this.world;

    // 1) 雲: どのツールでも最優先(いつでも雨を降らせられる)
    if (world.cloud.hit(x, y)) {
      world.cloud.active = true;
      this.gestures.set(e.pointerId, { kind: 'cloud', startX: x });
      return;
    }

    const tool = world.tool;
    const pin = this._findPin(x, y);

    // 2) 消しゴム
    if (tool === 'eraser') {
      if (pin) {
        world.pushUndo();
        world.removePin(pin);
        sounds.poof();
      } else {
        const rope = this._findRope(x, y);
        if (rope) {
          world.pushUndo();
          world.removeRope(rope);
          sounds.poof();
        }
      }
      this.gestures.set(e.pointerId, { kind: 'none' });
      return;
    }

    // 3) 紐ツール: ピンからドラッグ or タップ→タップ
    if (tool === 'string') {
      if (pin) {
        this.stringPreview = { pin, x, y };
        this.gestures.set(e.pointerId, { kind: 'string', from: pin, startX: x, startY: y, moved: false });
      } else {
        this.selectedPin = null; // 何もない所を触ったら選択解除
        this.gestures.set(e.pointerId, { kind: 'none' });
      }
      return;
    }

    // 4) ピンツール: 既存ピンは動かす / 空きスペースには新しく置く
    if (pin) {
      this.gestures.set(e.pointerId, { kind: 'movePin', pin, moved: false });
      return;
    }
    if (world.canPlacePin(x, y)) {
      world.pushUndo();
      world.addPin(x, y);
      sounds.pop();
      // 置いた直後にそのまま動かせる
      this.gestures.set(e.pointerId, { kind: 'movePin', pin: world.pins[world.pins.length - 1], moved: false });
      return;
    }
    this.gestures.set(e.pointerId, { kind: 'none' });
  }

  _move(e) {
    const g = this.gestures.get(e.pointerId);
    if (!g) return;
    const { x, y } = this._pos(e);
    const world = this.world;

    if (g.kind === 'cloud') {
      // 雲は左右にお引っ越し(押しっぱなしで雨も続く)
      world.cloud.x = Math.min(Math.max(x, 60), world.width - 60);
      return;
    }
    if (g.kind === 'movePin') {
      const { minX, maxX, minY, maxY } = world.pinBounds();
      g.pin.x = Math.min(Math.max(x, minX), maxX);
      g.pin.y = Math.min(Math.max(y, minY), maxY);
      g.moved = true;
      // つながっている紐をぷるんと揺らす
      for (const rope of world.ropes) {
        if (rope.a === g.pin || rope.b === g.pin) rope.excite(0.12);
      }
      return;
    }
    if (g.kind === 'string') {
      if (Math.hypot(x - g.startX, y - g.startY) > TAP_MOVE_LIMIT) g.moved = true;
      this.stringPreview = { pin: g.from, x, y };
    }
  }

  _up(e) {
    const g = this.gestures.get(e.pointerId);
    this.gestures.delete(e.pointerId);
    if (!g) return;
    const { x, y } = this._pos(e);
    const world = this.world;

    if (g.kind === 'cloud') {
      // 他の指が雲を押していなければ止める
      let stillHeld = false;
      for (const other of this.gestures.values()) {
        if (other.kind === 'cloud') stillHeld = true;
      }
      if (!stillHeld) world.cloud.active = false;
      return;
    }

    if (g.kind === 'string') {
      this.stringPreview = null;
      const target = this._findPin(x, y);
      if (g.moved && target && target !== g.from) {
        // ドラッグでつなぐ
        world.connectPins(g.from, target);
      } else if (!g.moved) {
        // タップ→タップでつなぐ(ドラッグが難しい子向け)
        if (this.selectedPin && this.selectedPin !== g.from) {
          world.connectPins(this.selectedPin, g.from);
          this.selectedPin = null;
        } else {
          this.selectedPin = g.from;
          sounds.pop();
        }
      }
      return;
    }
  }

  /** 選択中ピンの光る輪と、ドラッグ中の紐プレビューを描く */
  drawOverlay(ctx, time) {
    if (this.world.tool === 'string' && this.selectedPin) {
      const p = this.selectedPin;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + 9 + Math.sin(time * 5) * 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,200,80,0.85)';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }
}
