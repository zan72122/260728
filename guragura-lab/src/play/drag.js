import * as THREE from 'three';
import { clampBearPosition, isOnCushion, CUSHION } from '../core/layout.js';

/**
 * くまのドラッグ操作。
 * 大きな当たり判定・持ち上げ演出つき。配置フェーズでのみ有効。
 */
export class BearDrag {
  constructor(canvas, camera, bear, { onPickup, onDrop, onFirstDrag }) {
    this.canvas = canvas;
    this.camera = camera;
    this.bear = bear;
    this.enabled = false;
    this.dragging = false;
    this.lift = 0;
    this.onPickup = onPickup;
    this.onDrop = onDrop;
    this.onFirstDrag = onFirstDrag;
    this.hasDragged = false;

    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hitPoint = new THREE.Vector3();

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
  }

  setPointer(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.ray.setFromCamera(this.pointer, this.camera);
  }

  down(e) {
    if (!this.enabled || this.dragging) return;
    this.setPointer(e);
    const hits = this.ray.intersectObject(this.bear.hitProxy, false);
    if (hits.length > 0) {
      this.dragging = true;
      this.pointerId = e.pointerId;
      this.canvas.setPointerCapture?.(e.pointerId);
      this.onPickup?.();
      if (!this.hasDragged) {
        this.hasDragged = true;
        this.onFirstDrag?.();
      }
    }
  }

  move(e) {
    if (!this.dragging || e.pointerId !== this.pointerId) return;
    this.setPointer(e);
    if (this.ray.ray.intersectPlane(this.floorPlane, this.hitPoint)) {
      const { x, z } = clampBearPosition(this.hitPoint.x, this.hitPoint.z);
      this.bear.group.position.x = x;
      this.bear.group.position.z = z;
    }
  }

  up(e) {
    if (!this.dragging || e.pointerId !== this.pointerId) return;
    this.dragging = false;
    this.onDrop?.();
  }

  /** 毎フレーム：持ち上げの浮き・クッションの高さに追従 */
  update(dt) {
    const targetLift = this.dragging ? 0.16 : 0;
    this.lift += (targetLift - this.lift) * Math.min(1, dt * 12);
    const p = this.bear.group.position;
    const groundY = isOnCushion(p.x, p.z) ? CUSHION.height * 0.9 : 0;
    p.y = groundY + this.lift;
    this.bear.group.rotation.z = this.lift * 0.55;
    this.bear.shadowBlob.material.opacity = 0.9 - this.lift * 2.5;
  }
}
