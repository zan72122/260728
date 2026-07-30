// ドアノブのスワイプ → ドアの目標角速度。
// 指の位置をノブ高さの水平面に投影し、ヒンジ周りの角度をそのまま追従させる。
// 指の速さ・距離がそのまま開く速度・角度になる。

import * as THREE from 'three'
import { Door } from '../world/Door'
import { DOOR, ROOM } from '../sim/constants'

const _ray = new THREE.Ray()
const _plane = new THREE.Plane()
const _hit = new THREE.Vector3()
const _knob = new THREE.Vector3()

export class DoorSwipe {
  active = false
  private desiredAngle = 0

  constructor(private door: Door, private camera: THREE.PerspectiveCamera) {}

  /** ノブ付近をタッチしたか(役割判定) */
  hitTest(ndcX: number, ndcY: number): boolean {
    _ray.origin.setFromMatrixPosition(this.camera.matrixWorld)
    _ray.direction
      .set(ndcX, ndcY, 0.5)
      .unproject(this.camera)
      .sub(_ray.origin)
      .normalize()
    this.door.knobWorld(_knob)
    const d = _ray.distanceToPoint(_knob)
    return d < DOOR.knobRadius
  }

  start(ndcX: number, ndcY: number): void {
    this.active = true
    this.desiredAngle = this.door.openAngle
    this.moveTo(ndcX, ndcY)
  }

  moveTo(ndcX: number, ndcY: number): void {
    if (!this.active) return
    _ray.origin.setFromMatrixPosition(this.camera.matrixWorld)
    _ray.direction
      .set(ndcX, ndcY, 0.5)
      .unproject(this.camera)
      .sub(_ray.origin)
      .normalize()
    this.door.knobWorld(_knob)
    _plane.set(new THREE.Vector3(0, 1, 0), -_knob.y)
    if (!_ray.intersectPlane(_plane, _hit)) return
    const dx = _hit.x - DOOR.hingeX
    const dz = _hit.z - -(ROOM.depth / 2)
    let ang = Math.atan2(dz, dx)
    ang = Math.min(DOOR.maxAngle, Math.max(0, ang))
    this.desiredAngle = ang
  }

  /** 毎フレーム: ドアの目標角速度を更新 */
  update(dt: number): void {
    if (!this.active) {
      return
    }
    const err = this.desiredAngle - this.door.openAngle
    const omega = Math.min(DOOR.maxHandOmega, Math.max(-DOOR.maxHandOmega, err / Math.max(dt, 1 / 120) / 3))
    this.door.targetOmega = omega
  }

  end(): void {
    this.active = false
    this.door.targetOmega = null
  }
}
