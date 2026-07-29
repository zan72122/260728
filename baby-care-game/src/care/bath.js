import * as THREE from 'three';
import { CareAction } from './base.js';
import { PALETTE, toonUnique } from '../scene/palette.js';
import { clamp, tween, easeInOutQuad } from '../util/tween.js';

const SPOT_POSITIONS = [
  [0.0, 0.30, 0.16],
  [-0.13, 0.18, 0.13],
  [0.14, 0.22, 0.11],
  [0.0, 0.52, 0.16],
];

/**
 * おふろ：スポンジで からだを ごしごし すると、よごれが きえる。
 * よごれは 4つ。ぜんぶ きれいになったら できあがり。
 */
export class BathAction extends CareAction {
  static kind = 'bath';

  get station() { return 'bath'; }
  get cameraPreset() { return 'bath'; }
  get hintMotion() { return 'side'; }

  hintAnchor() { return this._sponge ? this._sponge.position.clone() : super.hintAnchor(); }

  enter() {
    const { baby, props, sfx, camera } = this.ctx;
    baby.setExpression('neutral');

    // おゆを ためる
    const tub = props.tub;
    const water = tub.userData.water;
    water.visible = true;
    water.scale.y = 0.1;
    water.position.y = 0.1;
    tween({
      duration: 0.9,
      ease: easeInOutQuad,
      onUpdate: (t) => {
        water.scale.y = 0.1 + t * 0.9;
        water.position.y = 0.06 + t * 0.26;
      },
    });
    tub.userData.foam.visible = true;
    sfx.splash();

    // よごれ（赤ちゃんの ポーズ空間に つける）
    this._spots = SPOT_POSITIONS.map(([x, y, z]) => {
      const spot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), toonUnique(PALETTE.dirt, { opacity: 0.9 }));
      spot.position.set(x, y, z);
      spot.scale.set(1.3, 1, 0.4);
      spot.userData.noOutline = true;
      spot.userData.clean = false;
      baby.pose.add(spot);
      return spot;
    });

    // スポンジ
    this._sponge = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.16), toonUnique(PALETTE.butter));
    this._sponge.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.15), toonUnique(PALETTE.pink));
    top.position.y = 0.08;
    this._sponge.add(top);
    this._sponge.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    const head = baby.getHeadWorldPosition(new THREE.Vector3());
    const toCam = camera.position.clone().sub(head).setY(0).normalize();
    this._sponge.position.copy(head).addScaledVector(toCam, 0.5).add(new THREE.Vector3(0.3, -0.25, 0));
    this.addObject(this._sponge);

    this._grabbed = false;
    this._cleaned = 0;
    this._scrubTimer = 0;
    this._tmp = new THREE.Vector3();
  }

  pointerDown(p) {
    this._grabbed = true;
    this.pointerMove(p);
  }

  pointerMove(p) {
    if (!this._grabbed || this.done) return;
    const hit = this.dragPoint(p.ray, this._sponge.position);
    if (!hit) return;
    const moved = hit.distanceTo(this._sponge.position);
    this._sponge.position.copy(hit);
    this._sponge.rotation.z = Math.sin(hit.x * 12) * 0.25;

    this._scrubTimer -= moved;
    if (this._scrubTimer <= 0 && moved > 0.001) {
      this._scrubTimer = 0.16;
      this.ctx.sfx.scrub();
    }
    this._checkSpots(moved);
  }

  pointerUp() { this._grabbed = false; }

  _checkSpots(moved) {
    const { particles, sfx } = this.ctx;
    for (const spot of this._spots) {
      if (spot.userData.clean) continue;
      spot.getWorldPosition(this._tmp);
      if (this._tmp.distanceTo(this._sponge.position) > 0.22) continue;

      spot.userData.wear = (spot.userData.wear ?? 0) + moved * 3 + 0.02;
      spot.scale.setScalar(Math.max(0.01, 1 - spot.userData.wear));
      particles.burst('bubble', this._tmp, 1, { speed: 0.5, gravity: 0.4, scale: 0.6, life: 1.0 });

      if (spot.userData.wear >= 1) {
        spot.userData.clean = true;
        spot.visible = false;
        this._cleaned++;
        sfx.pop();
        particles.burst('bubble', this._tmp, 6, { speed: 0.9, gravity: 0.5, scale: 0.8 });
        this.progress = clamp(this._cleaned / this._spots.length, 0, 1);
        if (this._cleaned >= this._spots.length) this._finish();
      }
    }
    this.progress = clamp(
      this._spots.reduce((sum, s) => sum + Math.min(1, s.userData.wear ?? 0), 0) / this._spots.length,
      0, 1
    );
  }

  _finish() {
    const { baby, sfx, particles } = this.ctx;
    baby.setExpression('laugh');
    sfx.splash();
    sfx.sparkle();
    const at = baby.getHeadWorldPosition(new THREE.Vector3());
    particles.burst('sparkle', at, 14, { speed: 1.5, spread: 0.6 });
    setTimeout(() => this.complete(), 500);
  }

  update(dt, time) {
    // あひるが ぷかぷか
    const duck = this.ctx.props.tub.userData.duck;
    duck.position.y = 0.62 + Math.sin(time * 2.2) * 0.03;
    duck.rotation.z = Math.sin(time * 1.7) * 0.12;
  }

  exit() {
    const { props, baby } = this.ctx;
    this._spots.forEach((s) => {
      baby.pose.remove(s);
      s.geometry.dispose();
      s.material.dispose();
    });
    this._spots.length = 0;

    const water = props.tub.userData.water;
    tween({
      duration: 0.7,
      onUpdate: (t) => {
        water.scale.y = 1 - t * 0.9;
        water.position.y = 0.32 - t * 0.26;
      },
      onComplete: () => { water.visible = false; },
    });
    props.tub.userData.foam.visible = false;
    super.exit();
  }
}
