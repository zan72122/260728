// 内開きドア。dynamic body + revolute joint。
// スワイプ中: 目標角速度へ有限トルクで追従(=水圧に負ける・家具に阻まれる)。
// 水圧トルク: ドア面のストリップ積分。シール角を超えると一気に立ち上がり
// 「少し開けたら押し開けられる」が力学的に発生する。

import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { PhysicsWorld, GROUP_DOOR, GROUP_STATIC, GROUP_PROP, GROUP_CHAR, groups } from '../physics/PhysicsWorld'
import { DOOR, ROOM, WATER } from '../sim/constants'
import { woodMat, metalMat } from '../gfx/materials'

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export class Door {
  mesh = new THREE.Group()
  body: RAPIER.RigidBody
  knobLocal = new THREE.Vector3(DOOR.width / 2 - 0.08, -0.05, -(DOOR.thickness / 2 + 0.05))
  knobMesh!: THREE.Mesh
  /** スワイプ中の目標角速度(開く方向が正)。null なら手を離している */
  targetOmega: number | null = null
  /** 現在の開口角(開く=正)[rad] */
  openAngle = 0
  /** 直近の水圧トルク(デバッグ/演出用) */
  lastPressureTorque = 0

  private hd = ROOM.depth / 2
  private closedCenter: THREE.Vector3

  constructor(physics: PhysicsWorld) {
    const w = DOOR.width
    const h = DOOR.height
    const t = DOOR.thickness
    this.closedCenter = new THREE.Vector3(DOOR.hingeX + w / 2, h / 2, -this.hd)

    // 物理ボディ
    const density = DOOR.mass / (w * h * t)
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.closedCenter.x, this.closedCenter.y, this.closedCenter.z)
        .setCcdEnabled(true)
    )
    physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, t / 2)
        .setDensity(density)
        .setCollisionGroups(groups(GROUP_DOOR, GROUP_STATIC | GROUP_PROP | GROUP_CHAR)),
      this.body
    )
    // ヒンジ(固定ボディに接続)
    const hingeBody = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(DOOR.hingeX, h / 2, -this.hd)
    )
    const joint = RAPIER.JointData.revolute(
      { x: 0, y: 0, z: 0 },
      { x: -w / 2, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 }
    )
    physics.world.createImpulseJoint(joint, hingeBody, this.body, true)

    // メッシュ
    const wood = woodMat()
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), wood)
    panel.castShadow = true
    panel.receiveShadow = true
    this.mesh.add(panel)
    // 化粧パネル(彫り込み風)
    const inset = new THREE.MeshStandardMaterial({ color: 0x6e4a2f, roughness: 0.8 })
    for (const [py, ph] of [
      [h * 0.24, h * 0.32],
      [-h * 0.22, h * 0.36],
    ] as const) {
      for (const side of [1, -1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, ph, 0.008), inset)
        p.position.set(0, py, side * (t / 2 + 0.002))
        this.mesh.add(p)
      }
    }
    // ノブ(室内側)。薄い発光パルスで「触れる」ことを示す
    const knobMat = metalMat().clone()
    knobMat.emissive = new THREE.Color(0x88bbcc)
    knobMat.emissiveIntensity = 0.0
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 12), knobMat)
    stem.rotation.x = Math.PI / 2
    stem.position.set(this.knobLocal.x, this.knobLocal.y, -(t / 2 + 0.03))
    this.mesh.add(stem)
    this.knobMesh = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), knobMat)
    this.knobMesh.position.copy(this.knobLocal)
    this.mesh.add(this.knobMesh)
    // 室外側ノブ
    const knobOut = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), metalMat())
    knobOut.position.set(this.knobLocal.x, this.knobLocal.y, t / 2 + 0.05)
    this.mesh.add(knobOut)

    this.syncMesh()
  }

  /** ノブのワールド座標 */
  knobWorld(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.knobLocal).applyQuaternion(this.mesh.quaternion).add(this.mesh.position)
  }

  /** ヒンジのワールド座標(y は無視してよい) */
  get hingeWorld(): THREE.Vector3 {
    return new THREE.Vector3(DOOR.hingeX, 0, -this.hd)
  }

  /** 物理ステップ前に呼ぶ: 手トルク+水圧トルク+回転抵抗 */
  applyTorques(waterLevel: number): void {
    const rot = this.body.rotation()
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ')
    this.openAngle = -e.y // 内開き = rotation.y 負方向

    const av = this.body.angvel()
    const omegaOpen = -av.y

    let torqueOpen = 0

    // 手(スワイプ)
    if (this.targetOmega !== null) {
      const t = DOOR.handStiffness * (this.targetOmega - omegaOpen)
      torqueOpen += Math.max(-DOOR.handMaxTorque, Math.min(DOOR.handMaxTorque, t))
    }

    // 水圧(外一定水頭 vs 室内水位)
    const strips = 4
    let tp = 0
    for (let i = 0; i < strips; i++) {
      const yc = ((i + 0.5) / strips) * DOOR.height
      const pOut = WATER.rho * WATER.g * Math.max(0, WATER.headEff - yc)
      const pIn = WATER.rho * WATER.g * Math.max(0, waterLevel - yc)
      const dp = Math.max(0, pOut - pIn)
      const f = dp * DOOR.width * (DOOR.height / strips)
      tp += f * (DOOR.width / 2)
    }
    const ramp = smoothstep(DOOR.pressureRampStart, DOOR.pressureRampEnd, this.openAngle)
    tp *= DOOR.pressureTorqueScale * ramp
    this.lastPressureTorque = tp
    torqueOpen += tp

    // 水中的な回転抵抗(スラムの暴れ止め)
    torqueOpen += -DOOR.rotDrag * omegaOpen * (1 + 2 * Math.min(1, waterLevel / 1.5))

    this.body.resetTorques(true)
    this.body.addTorque({ x: 0, y: -torqueOpen, z: 0 }, true)
  }

  /** 物理ステップ後: 角度クランプ(枠のストッパー)とメッシュ同期 */
  postStep(): void {
    const rot = this.body.rotation()
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ')
    let open = -e.y
    if (open < 0 || open > DOOR.maxAngle) {
      open = Math.min(DOOR.maxAngle, Math.max(0, open))
      this.setAngle(open)
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
    this.openAngle = open
    this.syncMesh()
  }

  /** 角度を直接設定(クランプ/リセット用) */
  private setAngle(open: number): void {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -open)
    // ヒンジ周りの回転: パネル中心 = ヒンジ + R*(w/2,0,0)
    const arm = new THREE.Vector3(DOOR.width / 2, 0, 0).applyQuaternion(q)
    const hinge = new THREE.Vector3(DOOR.hingeX, DOOR.height / 2, -this.hd)
    const c = hinge.add(arm)
    this.body.setTranslation({ x: c.x, y: c.y, z: c.z }, true)
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
  }

  private syncMesh(): void {
    const p = this.body.translation()
    const r = this.body.rotation()
    this.mesh.position.set(p.x, p.y, p.z)
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w)
  }

  /** ノブ発光パルス(触れることのアフォーダンス)。開けたら消灯 */
  updateGlow(time: number): void {
    const m = this.knobMesh.material as THREE.MeshStandardMaterial
    const active = this.openAngle < 0.05 && this.targetOmega === null
    m.emissiveIntensity = active ? 0.35 + 0.3 * Math.sin(time * 2.4) : 0
  }

  reset(): void {
    this.targetOmega = null
    this.setAngle(0)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.openAngle = 0
    this.syncMesh()
  }
}
