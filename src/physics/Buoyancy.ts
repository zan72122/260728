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

  apply(items: FloatingBody[], waterLevel: number, dt: number): void {
    for (const it of items) {
      const b = it.body
      const t = b.translation()
      const bottom = t.y - it.half.y * 1.2
      if (waterLevel <= bottom + 0.01) {
        // 水面上に出た物は抗力を解除
        if (b.linearDamping() !== 0) {
          b.setLinearDamping(0)
          b.setAngularDamping(0)
        }
        continue
      }
      if (b.isSleeping()) b.wakeUp()

      b.resetForces(true)
      _q.set(b.rotation().x, b.rotation().y, b.rotation().z, b.rotation().w)
      _c.set(t.x, t.y, t.z)
      const lv = b.linvel()
      _v.set(lv.x, lv.y, lv.z)

      const fPerSample = (WATER.rho * WATER.g * it.dispVol) / SAMPLES.length
      // 2パス: まず水没率を集計し、合計浮力をクランプしてから適用する
      // (軽い物への過大な加速で天井を突き抜ける事故を防ぐ)
      const subs: number[] = []
      let submerged = 0
      for (const s of SAMPLES) {
        _p.set(s[0] * it.half.x, s[1] * it.half.y, s[2] * it.half.z)
          .applyQuaternion(_q)
          .add(_c)
        const sub = Math.min(1, Math.max(0, (waterLevel - _p.y) / 0.08))
        subs.push(sub)
        submerged += sub / SAMPLES.length
      }
      const mass = b.mass()
      const totalF = fPerSample * subs.reduce((a, x) => a + x, 0)
      const maxF = mass * (WATER.g + 45)
      const fScale = totalF > maxF ? maxF / totalF : 1
      // 上向きに速い間は浮力を弱める(水面での暴れ防止)
      const vyDamp = _v.y > 0.5 ? Math.max(0.25, 1 - (_v.y - 0.5) * 0.35) : 1
      for (let i = 0; i < SAMPLES.length; i++) {
        if (subs[i] <= 0) continue
        const s = SAMPLES[i]
        _p.set(s[0] * it.half.x, s[1] * it.half.y, s[2] * it.half.z)
          .applyQuaternion(_q)
          .add(_c)
        b.addForceAtPoint(
          { x: 0, y: fPerSample * subs[i] * fScale * vyDamp, z: 0 },
          { x: _p.x, y: _p.y, z: _p.z },
          true
        )
      }
      if (submerged <= 0) {
        b.setLinearDamping(0)
        b.setAngularDamping(0)
        continue
      }

      const ds = it.dragScale ?? 1
      // 抗力は implicit damping で適用(慣性が小さい物でも無条件安定)
      b.setLinearDamping((1.2 + 0.8 * ds) * submerged)
      b.setAngularDamping((4.5 + 2 * ds) * submerged)

      // 水流の力(二次抗力)。1ステップで相対速度を超えないようクランプ
      this.flow.velocityAt(_c, _u)
      _rel.copy(_u).sub(_v)
      const relMag = _rel.length()
      if (relMag > 0.01) {
        const cQuad = 0.5 * WATER.rho * 1.0 * it.frontal * ds
        let fMag = cQuad * relMag * relMag * submerged
        const fMax = (mass * relMag) / dt * 0.5
        if (fMag > fMax) fMag = fMax
        b.addForce(
          { x: (_rel.x / relMag) * fMag, y: (_rel.y / relMag) * fMag, z: (_rel.z / relMag) * fMag },
          true
        )
      }

      // 保険: 速度の暴走を抑える(ソルバーのパニック防止)
      const av = b.angvel()
      const avMag = Math.hypot(av.x, av.y, av.z)
      if (avMag > 25) {
        const k = 25 / avMag
        b.setAngvel({ x: av.x * k, y: av.y * k, z: av.z * k }, true)
      }
      const vMag = _v.length()
      if (vMag > 12) {
        const k = 12 / vMag
        b.setLinvel({ x: _v.x * k, y: _v.y * k, z: _v.z * k }, true)
      }
    }
  }
}
