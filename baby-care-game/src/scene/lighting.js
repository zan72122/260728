import * as THREE from 'three';
import { damp } from '../util/tween.js';

/**
 * 昼のあかるい部屋と、ねんね用のうす暗い部屋を行き来する照明。
 */
export class Lighting {
  constructor(scene) {
    this.hemi = new THREE.HemisphereLight(0xfff4e2, 0xcbb59a, 0.62);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff0d6, 1.9);
    this.sun.position.set(4.5, 8, 5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 26;
    this.sun.shadow.camera.left = -8;
    this.sun.shadow.camera.right = 8;
    this.sun.shadow.camera.top = 8;
    this.sun.shadow.camera.bottom = -8;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.fill = new THREE.DirectionalLight(0xdfe9ff, 0.35);
    this.fill.position.set(-5, 4, -4);
    scene.add(this.fill);

    this.scene = scene;
    this.dayFog = new THREE.Color(0xf1e6d4);
    this.nightFog = new THREE.Color(0x39406b);
    scene.background = this.dayFog.clone();

    this.night = 0;      // 0 = ひる, 1 = よる
    this.nightTarget = 0;
  }

  setNight(on) {
    this.nightTarget = on ? 1 : 0;
  }

  update(dt) {
    this.night = damp(this.night, this.nightTarget, 2.2, dt);
    const n = this.night;
    this.hemi.intensity = 0.62 - 0.4 * n;
    this.sun.intensity = 1.9 - 1.55 * n;
    this.fill.intensity = 0.35 + 0.25 * n;
    this.hemi.color.setHex(n > 0.5 ? 0xbcc6ff : 0xfff4e2);
    this.scene.background.copy(this.dayFog).lerp(this.nightFog, n * 0.85);
  }
}
