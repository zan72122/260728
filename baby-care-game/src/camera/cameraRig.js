import * as THREE from 'three';
import { STATIONS } from '../scene/props.js';
import { clamp, damp } from '../util/tween.js';

const PHI_MIN = 0.62;   // 上から見おろす限界（真上まで行くと迷子になるので手前で止める）
const PHI_MAX = 1.38;   // 床すれすれの限界
const RADIUS_MIN = 3.2;
const RADIUS_MAX = 15;
const IDLE_RETURN_SEC = 14;  // ほうっておくと ゆっくり全景へもどる

/**
 * カメラを「その場所から部屋の中心側」に置くための方位角。
 * カメラ位置 = 注視点 + r * (sinθ, ..., cosθ) なので、
 * 中心へ向かうベクトル (-x, -z) をそのまま θ にする。
 */
function thetaTowardCenter(spot) {
  return Math.atan2(-spot.x, -spot.z);
}

/**
 * @param {number} [theta] 明示したいときの方位角。ねかせる場所では
 *   体の軸と直角から見ないと「あたまのてっぺん」しか見えないので、ここで指定する。
 */
function stationView(key, radius, phi, height = 0.35, theta = null) {
  const spot = STATIONS[key].spot;
  return {
    target: new THREE.Vector3(spot.x, spot.y + height, spot.z),
    theta: theta === null ? thetaTowardCenter(spot) : theta,
    phi,
    radius,
  };
}

/**
 * 自由に回せるカメラ。お世話がはじまると自動でその場所に寄り、
 * 終わると全景へもどる。指で動かしたときは、いつでも手動が優先。
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;

    this.presets = {
      overview: { target: new THREE.Vector3(0, 0.95, 0), theta: 0.0, phi: 1.02, radius: 7.8 },
      play:     { target: new THREE.Vector3(0, 0.75, 0.4), theta: 0.15, phi: 1.1, radius: 4.6 },
      diaper:   stationView('table', 3.3, 1.05, 0.5, Math.PI / 2 + 0.25),
      milk:     stationView('chair', 3.1, 1.1, 0.75),
      sleep:    stationView('crib', 3.6, 0.95, 0.55, Math.PI / 2 - 0.25),
      bath:     stationView('bath', 3.2, 0.92, 0.85),
    };

    const start = this.presets.overview;
    this.target = start.target.clone();
    this.theta = start.theta;
    this.phi = start.phi;
    this.radius = start.radius;

    this.desiredTarget = start.target.clone();
    this.desiredTheta = start.theta;
    this.desiredPhi = start.phi;
    this.desiredRadius = start.radius;

    this.userControl = true;   // お世話ちゅうは false（カメラ固定）
    this.idle = 0;
    this._radiusScale = 1;
    this._offset = new THREE.Vector3();
  }

  setPreset(name, { instant = false } = {}) {
    const p = this.presets[name];
    if (!p) return;
    this.desiredTarget.copy(p.target);
    // いまの向きから 近いほうへ回す
    let theta = p.theta;
    while (theta - this.theta > Math.PI) theta -= Math.PI * 2;
    while (theta - this.theta < -Math.PI) theta += Math.PI * 2;
    this.desiredTheta = theta;
    this.desiredPhi = p.phi;
    this.desiredRadius = p.radius;
    this.idle = 0;
    if (instant) {
      this.target.copy(this.desiredTarget);
      this.theta = this.desiredTheta;
      this.phi = this.desiredPhi;
      this.radius = this.desiredRadius;
    }
  }

  /** 指のドラッグ（画面の割合）でぐるぐる回す。 */
  orbit(dxRatio, dyRatio) {
    if (!this.userControl) return;
    this.desiredTheta -= dxRatio * Math.PI * 2.2;
    this.desiredPhi = clamp(this.desiredPhi - dyRatio * Math.PI * 1.4, PHI_MIN, PHI_MAX);
    this.idle = 0;
  }

  /** ピンチで よせたり ひいたり。 */
  zoom(factor) {
    if (!this.userControl) return;
    this.desiredRadius = clamp(this.desiredRadius / factor, RADIUS_MIN, RADIUS_MAX);
    this.idle = 0;
  }

  /** 画面のたて／よこに合わせて、ひきの量を変える。 */
  setAspect(aspect) {
    this._radiusScale = aspect >= 1.1 ? 1 : clamp(1.12 / aspect, 1, 1.95);
  }

  update(dt) {
    if (this.userControl) {
      this.idle += dt;
      if (this.idle > IDLE_RETURN_SEC) {
        const o = this.presets.overview;
        this.desiredTarget.lerp(o.target, 1 - Math.exp(-0.6 * dt));
        this.desiredRadius = damp(this.desiredRadius, o.radius, 0.6, dt);
        this.desiredPhi = damp(this.desiredPhi, o.phi, 0.6, dt);
      }
    }

    const speed = 3.4;
    this.target.lerp(this.desiredTarget, 1 - Math.exp(-speed * dt));
    this.theta = damp(this.theta, this.desiredTheta, speed, dt);
    this.phi = damp(this.phi, this.desiredPhi, speed, dt);
    this.radius = damp(this.radius, this.desiredRadius * this._radiusScale, speed, dt);

    const sinPhi = Math.sin(this.phi);
    this._offset.set(
      sinPhi * Math.sin(this.theta),
      Math.cos(this.phi),
      sinPhi * Math.cos(this.theta)
    ).multiplyScalar(this.radius);

    this.camera.position.copy(this.target).add(this._offset);
    // 床より下にもぐらない
    this.camera.position.y = Math.max(this.camera.position.y, 0.6);
    this.camera.lookAt(this.target);
  }
}
