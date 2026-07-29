import * as THREE from 'three';

/**
 * お世話ひとつぶんの共通のかたち。
 * コントローラーが 移動 → enter → 指の操作 → complete → exit の順に呼ぶ。
 */
export class CareAction {
  /** @param {object} ctx scene / baby / rig / hud / sfx / particles / camera / props など */
  constructor(ctx) {
    this.ctx = ctx;
    this.progress = 0;
    this.done = false;
    this._objects = [];
    this._plane = new THREE.Plane();
    this._hitPoint = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
  }

  // --- サブクラスで指定するもの ------------------------------------
  get station() { return 'rug'; }
  get cameraPreset() { return 'play'; }
  get hintMotion() { return 'side'; }
  hintAnchor() { return this.ctx.baby.getHeadWorldPosition(new THREE.Vector3()); }

  enter() {}
  update(dt, time) {}
  exit() { this.disposeObjects(); }
  pointerDown(p) {}
  pointerMove(p) {}
  pointerUp(p) {}

  // --- 便利メソッド --------------------------------------------------

  /** アクション中だけ出しておく物。exit で自動的に片づける。 */
  addObject(obj) {
    this.ctx.scene.add(obj);
    this._objects.push(obj);
    return obj;
  }

  disposeObjects() {
    for (const obj of this._objects) {
      obj.parent?.remove(obj);
      obj.traverse?.((o) => {
        if (o.isMesh) {
          o.geometry?.dispose?.();
          if (o.material?.dispose && o.material.userData.shared !== true) o.material.dispose();
        }
      });
    }
    this._objects.length = 0;
  }

  /** 指のレイを「画面に正対する板」と交差させ、3D の位置に変える。 */
  dragPoint(ray, through) {
    this.ctx.camera.getWorldDirection(this._camDir);
    this._plane.setFromNormalAndCoplanarPoint(this._camDir, through);
    return ray.intersectPlane(this._plane, this._hitPoint) ? this._hitPoint.clone() : null;
  }

  complete() {
    if (this.done) return;
    this.done = true;
    this.progress = 1;
    this.ctx.onComplete();
  }
}
