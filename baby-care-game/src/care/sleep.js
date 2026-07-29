import * as THREE from 'three';
import { CareAction } from './base.js';
import { clamp, tween, easeOutBack } from '../util/tween.js';

const NEEDED_SWIPE = 1500;   // 合計これだけ指を動かすと ねむる（約5往復）

/**
 * ねんね：おふとんの上を 左右に なでなで（とんとん）すると ねむくなる。
 * 部屋の明かりも いっしょに おちる。
 */
export class SleepAction extends CareAction {
  static kind = 'sleep';

  get station() { return 'crib'; }
  get cameraPreset() { return 'sleep'; }
  get hintMotion() { return 'side'; }

  enter() {
    const { baby, props, lighting, sfx } = this.ctx;
    baby.setExpression('fussy');
    lighting.setNight(true);
    sfx.whoosh();

    const blanket = props.crib.userData.blanket;
    blanket.visible = true;
    blanket.scale.set(1, 0.2, 1);
    tween({ duration: 0.6, ease: easeOutBack, onUpdate: (t) => { blanket.scale.y = 0.2 + t * 0.8; } });

    this._swiped = 0;
    this._last = null;
    this._patStep = 0;
    this._sleeping = false;
    this._settle = 0;
  }

  pointerDown(p) { this._last = { x: p.x, y: p.y }; }

  pointerMove(p) {
    if (!this._last || this.done || this._sleeping) return;
    const dist = Math.hypot(p.x - this._last.x, p.y - this._last.y);
    this._last = { x: p.x, y: p.y };
    this._swiped += dist;
    this.progress = clamp(this._swiped / NEEDED_SWIPE, 0, 1);

    const { baby, sfx, particles } = this.ctx;
    if (this.progress > 0.35) baby.setExpression('sleepy');
    else baby.setExpression('neutral');

    // なでるたびに とんとん音と ハート
    if (this._swiped - this._patStep > 160) {
      this._patStep = this._swiped;
      sfx.pat();
      const at = baby.getHeadWorldPosition(new THREE.Vector3());
      at.y += 0.15;
      particles.burst('heart', at, 2, { speed: 0.7, gravity: -0.3, scale: 0.6, life: 1.1 });
    }

    if (this.progress >= 1) this._fallAsleep();
  }

  pointerUp() { this._last = null; }

  _fallAsleep() {
    this._sleeping = true;
    const { baby, sfx } = this.ctx;
    baby.setExpression('sleeping');
    baby.setLookEnabled(false);
    sfx.snore();
  }

  update(dt, time) {
    const { props, particles, baby, sfx } = this.ctx;
    // メリーを ゆっくり まわす
    props.crib.userData.mobile.rotation.y += dt * 0.5;

    if (!this._sleeping) return;
    this._settle += dt;

    // すやすや（あわが ふわりと のぼる）
    if (Math.floor(this._settle / 1.1) !== Math.floor((this._settle - dt) / 1.1)) {
      const at = baby.getHeadWorldPosition(new THREE.Vector3());
      at.y += 0.25;
      particles.burst('bubble', at, 2, { speed: 0.35, gravity: 0.25, scale: 0.7, life: 1.6, color: 0xdfe8ff });
      sfx.snore();
    }
    if (this._settle > 2.4) this.complete();
  }

  exit() {
    const { props, lighting, baby } = this.ctx;
    lighting.setNight(false);
    props.crib.userData.blanket.visible = false;
    baby.setLookEnabled(true);
    super.exit();
  }
}
