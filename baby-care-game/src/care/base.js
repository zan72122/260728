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
    this._diff = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
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

  /**
   * 指のレイを「画面に正対する板」と交差させ、3D の位置に変える。
   * through には お世話の対象（口・おなかなど）を渡すこと。
   * 動かす物のほうを基準にすると、板が対象と別の奥行きに固定されて永遠に届かなくなる。
   */
  dragPoint(ray, through) {
    this.ctx.camera.getWorldDirection(this._camDir);
    this._plane.setFromNormalAndCoplanarPoint(this._camDir, through);
    return ray.intersectPlane(this._plane, this._hitPoint) ? this._hitPoint.clone() : null;
  }

  /**
   * カメラから見た「見た目の近さ」。奥行きのズレは無視するので、
   * 4さいの感覚（画面のうえで重なっていれば当たり）と一致する。
   */
  screenDistance(a, b) {
    this.ctx.camera.getWorldDirection(this._camDir);
    const d = this._diff.subVectors(a, b);
    d.addScaledVector(this._camDir, -d.dot(this._camDir));
    return d.length();
  }

  /** through と同じ奥行きの板の上に、画面の右・上へずらした位置を作る。 */
  placeInView(through, right, up) {
    const cam = this.ctx.camera;
    const r = this._right.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const u = this._up.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    return through.clone().addScaledVector(r, right).addScaledVector(u, up);
  }

  complete() {
    if (this.done) return;
    this.done = true;
    this.progress = 1;
    this.ctx.onComplete();
  }
}
