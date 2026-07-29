import * as THREE from 'three';

/**
 * 指の入力の ふりわけ。
 * ・お世話ちゅう … お世話のアクションへ そのまま渡す
 * ・ふだん      … 1本指でカメラをまわす／赤ちゃんを タップすると わらう
 * ・2本指       … いつでも ピンチでズーム
 */
export class Input {
  constructor({ dom, camera, rig, care, baby, onTapBaby, onFirstTouch }) {
    this.dom = dom;
    this.camera = camera;
    this.rig = rig;
    this.care = care;
    this.baby = baby;
    this.onTapBaby = onTapBaby;
    this.onFirstTouch = onFirstTouch;

    this.pointers = new Map();
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._pinchDist = 0;
    this._moved = 0;
    this._firstDone = false;

    dom.addEventListener('pointerdown', this._down, { passive: false });
    dom.addEventListener('pointermove', this._move, { passive: false });
    dom.addEventListener('pointerup', this._up);
    dom.addEventListener('pointercancel', this._up);
    dom.addEventListener('pointerleave', this._up);
    // iOS Safari の 2本指スクロール・ピンチを止める
    dom.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    dom.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  _pack(e) {
    const rect = this.dom.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this._ndc.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this.camera);
    return { x, y, ndc: this._ndc, ray: this._ray.ray, raycaster: this._ray };
  }

  _down = (e) => {
    e.preventDefault();
    this.dom.setPointerCapture?.(e.pointerId);
    if (!this._firstDone) {
      this._firstDone = true;
      this.onFirstTouch?.();
    }

    const p = this._pack(e);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, startX: p.x, startY: p.y });
    this._moved = 0;

    if (this.pointers.size === 2) {
      this._pinchDist = this._distance();
      return;
    }
    if (this.pointers.size === 1) this.care.pointerDown(p);
  };

  _move = (e) => {
    if (!this.pointers.has(e.pointerId)) return;
    e.preventDefault();
    const p = this._pack(e);
    const prev = this.pointers.get(e.pointerId);
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    prev.x = p.x;
    prev.y = p.y;
    this._moved += Math.hypot(dx, dy);

    if (this.pointers.size >= 2) {
      const dist = this._distance();
      if (this._pinchDist > 0 && dist > 0) this.rig.zoom(dist / this._pinchDist);
      this._pinchDist = dist;
      return;
    }

    if (this.care.active) {
      this.care.pointerMove(p);
    } else {
      const rect = this.dom.getBoundingClientRect();
      this.rig.orbit(dx / rect.width, dy / rect.height);
    }
  };

  _up = (e) => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this._pack(e);
    this.pointers.delete(e.pointerId);
    this._pinchDist = 0;
    this.care.pointerUp(p);

    // ほとんど動いていなければ「タップ」として あつかう
    if (this._moved < 12 && !this.care.active) {
      const hit = this._ray.intersectObjects(this.baby.touchTargets, false);
      if (hit.length > 0) this.onTapBaby?.(hit[0].point);
    }
  };

  _distance() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }
}
