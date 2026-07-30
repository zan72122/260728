// 三人称オービットカメラ(自前実装)。主人公を追従し、ドラッグで回転、
// ピンチでズーム。OrbitControls はタッチ役割分担と干渉するため使わない。

import * as THREE from 'three'
import { CAMERA } from '../sim/constants'

export class CameraRig {
  camera: THREE.PerspectiveCamera
  yaw = CAMERA.initYaw
  pitch = CAMERA.initPitch
  dist = CAMERA.initDist
  private target = new THREE.Vector3(0, 1, 0)
  private smoothTarget = new THREE.Vector3(0, 1, 0)
  portraitBoost = 1

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(58, aspect, 0.05, 60)
  }

  rotateBy(dxNdc: number, dyNdc: number): void {
    this.yaw -= dxNdc * 2.6
    this.pitch += dyNdc * 2.2
    this.pitch = Math.min(CAMERA.maxPitch, Math.max(CAMERA.minPitch, this.pitch))
  }

  zoomBy(factor: number): void {
    this.dist = Math.min(CAMERA.maxDist, Math.max(CAMERA.minDist, this.dist / factor))
  }

  setTarget(p: THREE.Vector3): void {
    this.target.copy(p)
  }

  update(dt: number): void {
    this.smoothTarget.lerp(this.target, Math.min(1, 7 * dt))
    const d = this.dist * this.portraitBoost
    const cp = Math.cos(this.pitch)
    const x = this.smoothTarget.x + d * cp * Math.sin(this.yaw)
    const z = this.smoothTarget.z + d * cp * Math.cos(this.yaw)
    let y = this.smoothTarget.y + d * Math.sin(this.pitch)
    if (y < 0.12) y = 0.12
    this.camera.position.set(x, y, z)
    this.camera.lookAt(this.smoothTarget)
  }

  /** ジョイスティック入力(画面基準)をワールド水平方向へ変換 */
  screenToWorldDir(jx: number, jy: number, out: THREE.Vector2): THREE.Vector2 {
    // 画面上=奥(カメラ前方)
    const fx = -Math.sin(this.yaw)
    const fz = -Math.cos(this.yaw)
    const rx = -fz
    const rz = fx
    out.set(fx * jy + rx * jx, fz * jy + rz * jx)
    return out
  }
}
