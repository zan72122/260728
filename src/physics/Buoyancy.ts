// 浮力・水の抗力・水流力を dynamic body 群へ適用する。
// 各ボディの半径の半分の位置に 8 サンプル点をとり、水没分だけ浮力を
// かける → 部分水没での傾き・転倒が自然に出る。

import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { WATER } from '../sim/constants'
import { FlowField } from './FlowField'

export interface FloatingBody {
  body: RAPIER.RigidBody
  /** 半エクステント(サンプル点の配置に使用) */
  half: THREE.Vector3
  /** 排水体積 [m^3](水がしみ込む物は小さく) */
  dispVol: number
  /** 前面投影面積の目安 [m^2](流れの力) */
  frontal: number
  /** 抗力スケール(1が標準) */
  dragScale?: number
}

const SAMPLES: [number, number, number][] = [
  [-0.5, -0.5, -0.5],
  [0.5, -0.5, -0.5],
  [-0.5, -0.5, 0.5],
  [0.5, -0.5, 0.5],
  [-0.5, 0.5, -0.5],
  [0.5, 0.5, -0.5],
  [-0.5, 0.5, 0.5],
  [0.5, 0.5, 0.5],
]

const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _c = new THREE.Vector3()
const _v = new THREE.Vector3()
const _u = new THREE.Vector3()
const _rel = new THREE.Vector3()

export class Buoyancy {
  constructor(private flow: FlowField) {}

  apply(items: FloatingBody[], waterLevel: number): void {
    for (const it of items) {
      const b = it.body
      const t = b.translation()
      const bottom = t.y - it.half.y * 1.2
      if (waterLevel <= bottom + 0.01) continue
      if (b.isSleeping()) b.wakeUp()

      b.resetForces(true)
      _q.set(b.rotation().x, b.rotation().y, b.rotation().z, b.rotation().w)
      _c.set(t.x, t.y, t.z)
      const lv = b.linvel()
      _v.set(lv.x, lv.y, lv.z)

      const fPerSample = (WATER.rho * WATER.g * it.dispVol) / SAMPLES.length
      let submerged = 0
      for (const s of SAMPLES) {
        _p.set(s[0] * it.half.x, s[1] * it.half.y, s[2] * it.half.z)
          .applyQuaternion(_q)
          .add(_c)
        // 滑らかな水没率(安定化)
        const sub = Math.min(1, Math.max(0, (waterLevel - _p.y) / 0.08))
        if (sub <= 0) continue
        submerged += sub / SAMPLES.length
        b.addForceAtPoint({ x: 0, y: fPerSample * sub, z: 0 }, { x: _p.x, y: _p.y, z: _p.z }, true)
      }
      if (submerged <= 0) continue

      const ds = it.dragScale ?? 1
      // 抗力(線形+二次)
      this.flow.velocityAt(_c, _u)
      _rel.copy(_u).sub(_v)
      const relMag = _rel.length()
      const cLin = 18 * it.dispVol * 1000 * 0.06 * ds
      const cQuad = 0.5 * WATER.rho * 1.0 * it.frontal * ds
      const fx = _rel.x * (cLin + cQuad * relMag) * submerged
      const fy = _rel.y * (cLin + cQuad * relMag) * submerged
      const fz = _rel.z * (cLin + cQuad * relMag) * submerged
      b.addForce({ x: fx, y: fy, z: fz }, true)

      // 回転抗力
      const av = b.angvel()
      const cAng = (2.5 * it.dispVol * 1000 * 0.05 + 0.4) * submerged * ds
      b.addTorque({ x: -av.x * cAng, y: -av.y * cAng, z: -av.z * cAng }, true)
    }
  }
}
