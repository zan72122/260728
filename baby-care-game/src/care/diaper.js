import * as THREE from 'three';
import { CareAction } from './base.js';
import { clamp, tween, easeOutBack } from '../util/tween.js';

/**
 * おむつ交換：よごれたおむつを 下（あしのほう）へ ひっぱると はずれる。
 * 引っぱる向きだけ合っていれば、どんなに ゆっくりでも かならず成功する。
 */
export class DiaperAction extends CareAction {
  static kind = 'diaper';

  get station() { return 'table'; }
  get cameraPreset() { return 'diaper'; }
  get hintMotion() { return 'down'; }

  hintAnchor() {
    return this.ctx.baby.diaperGroup.getWorldPosition(new THREE.Vector3());
  }

  enter() {
    const { baby } = this.ctx;
    baby.setDiaperDirty(true);
    baby.setExpression('fussy');
    baby.resetDiaper();
    this._pulled = 0;
    this._lastY = null;
    this._popped = false;
  }

  pointerDown(p) { this._lastY = p.y; }

  pointerMove(p) {
    if (this._lastY === null || this.done) return;
    const dy = p.y - this._lastY;      // 画面の下向きが プラス
    this._lastY = p.y;
    if (dy > 0) this._pulled += dy;
    this.progress = clamp(this._pulled / 200, 0, 1);

    const { baby } = this.ctx;
    baby.diaperGroup.position.y = -this.progress * 0.42;
    baby.diaperGroup.rotation.x = this.progress * 0.5;
    if (this.progress > 0.35) baby.setExpression('neutral');

    if (this.progress >= 1 && !this._popped) this._finishPull();
  }

  pointerUp() { this._lastY = null; }

  _finishPull() {
    this._popped = true;
    const { baby, sfx, particles } = this.ctx;
    const at = baby.diaperGroup.getWorldPosition(new THREE.Vector3());

    sfx.whoosh();
    sfx.pop();
    particles.burst('puff', at, 12, { speed: 1.1, gravity: -0.8, scale: 0.9 });

    // よごれたおむつは ぽん と消えて、まっさらな おむつが ふわっと出る
    baby.diaperGroup.visible = false;
    baby.setDiaperDirty(false);
    baby.setExpression('happy');

    setTimeout(() => {
      baby.resetDiaper();
      baby.diaperGroup.scale.setScalar(0.01);
      tween({
        duration: 0.5,
        ease: easeOutBack,
        onUpdate: (t) => baby.diaperGroup.scale.setScalar(t),
        onComplete: () => this.complete(),
      });
      sfx.sparkle();
      particles.burst('sparkle', at, 10, { speed: 1.3 });
    }, 260);
  }

  exit() {
    this.ctx.baby.setDiaperDirty(false);
    this.ctx.baby.resetDiaper();
    super.exit();
  }
}
