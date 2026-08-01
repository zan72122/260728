// 一本指だけを受け付けるポインタ入力。
// 2本目以降の指 / マウスボタンは完全に無視するので、
// 手のひらが画面に触れてもゲームが壊れない。

export class SinglePointer {
  constructor(canvas) {
    this.canvas = canvas;
    this.id = null;          // 追跡中のポインタ ID（1本だけ）
    this.down = false;       // 現在触れているか
    this.pressed = false;    // このフレームで触れ始めたか
    this.released = false;   // このフレームで離したか
    this.x = 0; this.y = 0;  // CSS ピクセル座標
    this.px = 0; this.py = 0;
    this.dx = 0; this.dy = 0;
    this.vx = 0; this.vy = 0; // px/秒（平滑化済み）
    this.startX = 0; this.startY = 0;
    this.travel = 0;          // 押してからの総移動量
    this.holdTime = 0;
    this.releaseX = 0; this.releaseY = 0;
    this.wasTap = false;      // 直近の release が「ちょんと触った」か
    this.everInteracted = false;

    const opts = { passive: false };
    canvas.addEventListener('pointerdown', this._onDown.bind(this), opts);
    canvas.addEventListener('pointermove', this._onMove.bind(this), opts);
    canvas.addEventListener('pointerup', this._onUp.bind(this), opts);
    canvas.addEventListener('pointercancel', this._onUp.bind(this), opts);
    canvas.addEventListener('pointerleave', this._onUp.bind(this), opts);
    // iOS Safari の既定ジェスチャ（ズーム・選択）を無効化
    canvas.addEventListener('touchstart', (e) => e.preventDefault(), opts);
    canvas.addEventListener('touchmove', (e) => e.preventDefault(), opts);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault(), opts);
  }

  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _onDown(e) {
    e.preventDefault();
    if (this.id !== null) return;         // すでに1本追跡中 → 無視
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.id = e.pointerId;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* 取得できなくても続行 */ }
    const p = this._local(e);
    this.x = this.px = this.startX = p.x;
    this.y = this.py = this.startY = p.y;
    this.dx = this.dy = 0;
    this.vx = this.vy = 0;
    this.travel = 0;
    this.holdTime = 0;
    this.down = true;
    this.pressed = true;
    this.everInteracted = true;
  }

  _onMove(e) {
    if (e.pointerId !== this.id) return;
    e.preventDefault();
    const p = this._local(e);
    this.dx += p.x - this.x;
    this.dy += p.y - this.y;
    this.travel += Math.hypot(p.x - this.x, p.y - this.y);
    this.x = p.x;
    this.y = p.y;
  }

  _onUp(e) {
    if (e.pointerId !== this.id) return;
    e.preventDefault();
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    this.id = null;
    this.down = false;
    this.released = true;
    this.releaseX = this.x;
    this.releaseY = this.y;
    this.wasTap = this.travel < 22 && this.holdTime < 0.7;
  }

  /** 毎フレームの先頭で呼ぶ：速度の平滑化 */
  update(dt) {
    if (dt > 0) {
      const instVx = (this.x - this.px) / dt;
      const instVy = (this.y - this.py) / dt;
      const k = 1 - Math.exp(-18 * dt);
      this.vx += (instVx - this.vx) * k;
      this.vy += (instVy - this.vy) * k;
    }
    this.px = this.x;
    this.py = this.y;
    if (this.down) this.holdTime += dt;
  }

  /** 毎フレームの末尾で呼ぶ：エッジフラグを消費 */
  endFrame() {
    this.pressed = false;
    this.released = false;
    this.dx = 0;
    this.dy = 0;
  }
}
