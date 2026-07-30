// 三人称オービットカメラ(自前実装)。主人公を追従し、ドラッグで回転、
// ピンチでズーム。OrbitControls はタッチ役割分担と干渉するため使わない。

import * as THREE from 'three'
import { CAMERA } from '../sim/constants'

export class CameraRig {
  camera: THREE.PerspectiveCamera
  yaw = CAMERA.initYaw
  pitch = CAMERA.initPitch
  dist = CAMERA.initDist
  maxDist = CAMERA.maxDist
  private target = new THREE.Vector3(0, 1, 0)
  private smoothTarget = new THREE.Vector3(0, 1, 0)
  /** 直近フレームの注視点(遮蔽フェード判定に使う) */
  lastTarget = new THREE.Vector3(0, 1, 0)

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(58, aspect, 0.05, 60)
    this.setViewport(aspect)
  }

  /**
   * 水平FOVを固定し、縦画面では垂直FOVを拡大して部屋が
   * 横幅いっぱいに写るようにする(縮こまり対策)。
   */
  setViewport(aspect: number): void {
    this.camera.aspect = aspect
    const vFov = 2 * Math.atan(Math.tan(CAMERA.targetHFov / 2) / aspect)
    this.camera.fov = THREE.MathUtils.radToDeg(
      Math.min(CAMERA.maxVFov, Math.max(0.7, vFov))
    )
    this.camera.updateProjectionMatrix()
  }

  rotateBy(dxNdc: number, dyNdc: number): void {
    this.yaw -= dxNdc * 2.6
    this.pitch += dyNdc * 2.2
    this.pitch = Math.min(CAMERA.maxPitch, Math.max(CAMERA.minPitch, this.pitch))
  }

  zoomBy(factor: number): void {
    this.dist = Math.min(this.maxDist, Math.max(CAMERA.minDist, this.dist / factor))
  }

  setTarget(p: THREE.Vector3): void {
    this.target.copy(p)
  }


  update(dt: number): void {
    this.smoothTarget.lerp(this.target, Math.min(1, 7 * dt))
    let d = this.dist
    const cp = Math.cos(this.pitch)
    const dirX = cp * Math.sin(this.yaw)
    const dirZ = cp * Math.cos(this.yaw)
    const dirY = Math.sin(this.pitch)

    this.lastTarget.copy(this.smoothTarget)
    const x = this.smoothTarget.x + d * dirX
    const z = this.smoothTarget.z + d * dirZ
    let y = this.smoothTarget.y + d * dirY
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
