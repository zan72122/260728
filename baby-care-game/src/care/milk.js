import * as THREE from 'three';
import { CareAction } from './base.js';
import { PALETTE, toonUnique } from '../scene/palette.js';
import { clamp, lerp, tween, easeInOutQuad } from '../util/tween.js';

const BOTTLE_H = 0.34;
const DRINK_TIME = 3.4;

/**
 * ミルク：ほにゅうびんを 指でつまんで、おくちまで はこぶ。
 * 近づけば すいこまれるように くっつくので、こまかい操作はいらない。
 */
export class MilkAction extends CareAction {
  static kind = 'milk';

  get station() { return 'chair'; }
  get cameraPreset() { return 'milk'; }
  get hintMotion() { return 'up'; }

  hintAnchor() { return this._bottle ? this._bottle.position.clone() : super.hintAnchor(); }

  enter() {
    const { baby, camera } = this.ctx;
    baby.setExpression('fussy');

    this._bottle = this._makeBottle();
    const head = baby.getHeadWorldPosition(new THREE.Vector3());
    const toCam = camera.position.clone().sub(head).setY(0).normalize();
    this._bottle.position.copy(head).addScaledVector(toCam, 0.55).add(new THREE.Vector3(0, -0.42, 0));
    this._home = this._bottle.position.clone();
    this.addObject(this._bottle);

    this._grabbed = false;
    this._attached = false;
    this._drinkTime = 0;
    this._glug = 0;
  }

  _makeBottle() {
    const g = new THREE.Group();

    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.09, BOTTLE_H, 18, 1, true),
      toonUnique(0xffffff, { opacity: 0.55, side: THREE.DoubleSide })
    );
    g.add(glass);

    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.085, 0.03, 18), toonUnique(0xffffff, { opacity: 0.7 }));
    bottom.position.y = -BOTTLE_H / 2;
    g.add(bottom);

    // なかみ（のむと へっていく）
    this._milk = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.082, BOTTLE_H * 0.82, 18), toonUnique(0xfff3d8));
    this._milkBottom = -BOTTLE_H / 2 + 0.02;
    this._milkHeight = BOTTLE_H * 0.82;
    this._milk.position.y = this._milkBottom + this._milkHeight / 2;
    g.add(this._milk);

    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.06, 18), toonUnique(PALETTE.mint));
    collar.position.y = BOTTLE_H / 2 + 0.02;
    g.add(collar);

    const nipple = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 12), toonUnique(0xf6d9a8));
    nipple.scale.set(1, 1.3, 1);
    nipple.position.y = BOTTLE_H / 2 + 0.1;
    g.add(nipple);
    this._tipOffset = BOTTLE_H / 2 + 0.14;

    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  _setMilkLevel(level) {
    const h = Math.max(0.02, this._milkHeight * level);
    this._milk.scale.y = h / this._milkHeight;
    this._milk.position.y = this._milkBottom + h / 2;
  }

  pointerDown(p) {
    if (this._attached) return;
    this._grabbed = true;
    this.pointerMove(p);
  }

  pointerMove(p) {
    if (!this._grabbed || this._attached || this.done) return;
    const hit = this.dragPoint(p.ray, this._home);
    if (!hit) return;
    this._bottle.position.copy(hit);

    const mouth = this.ctx.baby.mouthSmile.getWorldPosition(new THREE.Vector3());
    const tip = this._bottle.position.clone().add(new THREE.Vector3(0, this._tipOffset, 0));
    this.progress = clamp(1 - tip.distanceTo(mouth) / 0.9, 0, 0.95);
    if (tip.distanceTo(mouth) < 0.3) this._attach(mouth);
  }

  pointerUp() { this._grabbed = false; }

  /** おくちに くっついたら、あとは じどうで のんでくれる。 */
  _attach(mouth) {
    this._attached = true;
    this._grabbed = false;
    const { baby, sfx, camera } = this.ctx;
    sfx.pop();
    baby.setExpression('happy');
    baby.setLookEnabled(false);

    const toCam = camera.position.clone().sub(mouth).setY(0).normalize();
    const target = mouth.clone().addScaledVector(toCam, 0.16).add(new THREE.Vector3(0, -0.3, 0));
    const from = this._bottle.position.clone();
    const dir = mouth.clone().sub(target).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const fromQuat = this._bottle.quaternion.clone();

    tween({
      duration: 0.35,
      ease: easeInOutQuad,
      onUpdate: (t) => {
        this._bottle.position.lerpVectors(from, target, t);
        this._bottle.quaternion.slerpQuaternions(fromQuat, quat, t);
      },
    });
  }

  update(dt) {
    if (!this._attached || this.done) return;
    const { sfx, baby } = this.ctx;
    this._drinkTime += dt;
    const t = clamp(this._drinkTime / DRINK_TIME, 0, 1);
    this.progress = lerp(0.3, 1, t);
    this._setMilkLevel(1 - t);

    this._glug -= dt;
    if (this._glug <= 0) {
      this._glug = 0.55;
      sfx.glug();
    }
    baby.setExpression(t > 0.85 ? 'sleepy' : 'happy');

    if (t >= 1) {
      baby.setLookEnabled(true);
      baby.setExpression('laugh');
      sfx.sparkle();
      this.complete();
    }
  }

  exit() {
    this.ctx.baby.setLookEnabled(true);
    super.exit();
  }
}
