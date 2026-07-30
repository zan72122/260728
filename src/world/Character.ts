// 主人公(一般成人)。KinematicCharacterController + 自前速度積分。
// 浸水深に応じて WALK → WADE(滑る/よろける) → SWIM → AIR_POCKET と遷移する。

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import RAPIER from '@dimforge/rapier3d-compat'
import { PhysicsWorld, GROUP_CHAR, GROUP_STATIC, GROUP_DOOR, GROUP_PROP, groups } from '../physics/PhysicsWorld'
import { FlowField } from '../physics/FlowField'
import { CHAR, ROOM } from '../sim/constants'
import { makeWettable } from '../gfx/materials'

export type CharState = 'WALK' | 'WADE' | 'SWIM' | 'AIR_POCKET'

const CAPSULE_HALF = (CHAR.height - 2 * CHAR.radius) / 2 // 円筒部半長
const CENTER_H = CAPSULE_HALF + CHAR.radius // 足元→体中心

const _v3a = new THREE.Vector3()
const _flow = new THREE.Vector3()

export class Character {
  mesh = new THREE.Group()
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  controller: RAPIER.KinematicCharacterController
  state: CharState = 'WALK'
  velocity = new THREE.Vector3()
  /** 入力: ワールド空間の水平移動方向(長さ 0..1) */
  moveInput = new THREE.Vector2()
  /** 入力: 泳ぎの上下(-1 潜る .. +1 浮上) */
  swimVertical = 0
  yaw = 0
  private targetYaw = 0
  private walkPhase = 0
  private staggerPhase = 0
  private lean = new THREE.Vector2()
  private swimPose = 0
  private breathTime = 0
  private breathTarget: THREE.Mesh | null = null
  private initPos = new THREE.Vector3(-1.0, CENTER_H, 0.15)

  // 身体パーツ(プロシージャルアニメ用ピボット)
  private parts!: {
    torso: THREE.Object3D
    head: THREE.Object3D
    armL: THREE.Object3D
    armR: THREE.Object3D
    elbowL: THREE.Object3D
    elbowR: THREE.Object3D
    legL: THREE.Object3D
    legR: THREE.Object3D
    kneeL: THREE.Object3D
    kneeR: THREE.Object3D
    root: THREE.Group
  }

  constructor(private physics: PhysicsWorld) {
    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        this.initPos.x,
        this.initPos.y,
        this.initPos.z
      )
    )
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CHAR.radius).setCollisionGroups(
        groups(GROUP_CHAR, GROUP_STATIC | GROUP_DOOR | GROUP_PROP)
      ),
      this.body
    )
    this.controller = physics.world.createCharacterController(0.04)
    this.controller.setUp({ x: 0, y: 1, z: 0 })
    this.controller.enableAutostep(0.35, 0.15, true)
    this.controller.enableSnapToGround(0.25)
    this.controller.setMaxSlopeClimbAngle((55 * Math.PI) / 180)
    this.controller.setApplyImpulsesToDynamicBodies(true)

    this.buildMesh()
    // ドアの方を向いて開始
    this.targetYaw = this.yaw = Math.atan2(-0.3 - this.initPos.x, -ROOM.depth / 2 - this.initPos.z)
    this.syncMesh(0, 0)
  }

  private buildMesh(): void {
    const skin = makeWettable(new THREE.MeshStandardMaterial({ color: 0xd9a884, roughness: 0.62 }))
    const shirt = makeWettable(new THREE.MeshStandardMaterial({ color: 0x6f8fb0, roughness: 0.88 }))
    const shirtDark = makeWettable(new THREE.MeshStandardMaterial({ color: 0x5e7c9c, roughness: 0.9 }))
    const pants = makeWettable(new THREE.MeshStandardMaterial({ color: 0x474c56, roughness: 0.92 }))
    const shoe = makeWettable(new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.55 }))
    const hair = makeWettable(new THREE.MeshStandardMaterial({ color: 0x33281f, roughness: 0.85 }))

    const root = new THREE.Group()
    this.mesh.add(root)

    // 骨盤〜腰(丸み)
    const pelvis = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.2, 0.2, 3, 0.07), pants)
    pelvis.position.y = -0.17
    root.add(pelvis)
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.158, 0.05, 16), shoe)
    belt.scale.z = 0.72
    belt.position.y = -0.06
    root.add(belt)

    const torsoPivot = new THREE.Group()
    root.add(torsoPivot)
    // 腹(シャツ)
    const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.155, 0.1, 6, 14), shirt)
    belly.scale.set(1.02, 0.95, 0.74)
    belly.position.y = 0.02
    torsoPivot.add(belly)
    // 胸(シャツ)
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.165, 0.16, 6, 14), shirt)
    chest.scale.set(1.1, 1, 0.76)
    chest.position.y = 0.18
    torsoPivot.add(chest)
    // シャツの裾
    const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.175, 0.07, 16), shirtDark)
    hem.scale.z = 0.74
    hem.position.y = -0.05
    torsoPivot.add(hem)
    // 襟
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.075, 0.045, 12), shirtDark)
    collar.position.y = 0.375
    torsoPivot.add(collar)
    // 肩のブレンド球
    for (const side of [-1, 1]) {
      const sh = new THREE.Mesh(new THREE.SphereGeometry(0.068, 12, 10), shirt)
      sh.position.set(side * 0.185, 0.3, 0)
      torsoPivot.add(sh)
    }

    // 頭(のっぺらぼう維持)
    const headPivot = new THREE.Group()
    headPivot.position.y = 0.42
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 22, 18), skin)
    head.scale.set(0.92, 1.05, 0.96)
    head.position.y = 0.095
    headPivot.add(head)
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.109, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.52),
      hair
    )
    hairCap.scale.set(0.94, 1.06, 0.99)
    hairCap.position.set(0, 0.1, -0.014)
    headPivot.add(hairCap)
    // もみあげ・襟足
    const nape = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.3),
      hair
    )
    nape.scale.set(0.9, 1.05, 0.9)
    nape.position.set(0, 0.1, -0.03)
    headPivot.add(nape)
    // 耳
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), skin)
      ear.scale.set(0.5, 1, 0.8)
      ear.position.set(side * 0.095, 0.085, -0.01)
      headPivot.add(ear)
    }
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.055, 0.09, 12), skin)
    neck.position.y = -0.01
    headPivot.add(neck)
    torsoPivot.add(headPivot)

    const makeArm = (side: number) => {
      const shoulder = new THREE.Group()
      shoulder.position.set(side * 0.21, 0.3, 0)
      // 半袖: 上腕上部はシャツ
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.12, 12), shirt)
      sleeve.position.y = -0.06
      shoulder.add(sleeve)
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 4, 12), skin)
      upper.position.y = -0.17
      shoulder.add(upper)
      const elbow = new THREE.Group()
      elbow.position.y = -0.28
      const elbowBall = new THREE.Mesh(new THREE.SphereGeometry(0.044, 10, 8), skin)
      elbow.add(elbowBall)
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.17, 4, 12), skin)
      fore.scale.set(1, 1, 0.92)
      fore.position.y = -0.12
      elbow.add(fore)
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.047, 12, 10), skin)
      hand.scale.set(0.8, 1.3, 0.55)
      hand.position.y = -0.26
      elbow.add(hand)
      shoulder.add(elbow)
      torsoPivot.add(shoulder)
      return { shoulder, elbow }
    }
    const armL = makeArm(-1)
    const armR = makeArm(1)

    const makeLeg = (side: number) => {
      const hip = new THREE.Group()
      hip.position.set(side * 0.095, -0.25, 0)
      const hipBall = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), pants)
      hip.add(hipBall)
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.24, 4, 12), pants)
      thigh.scale.set(1, 1, 0.95)
      thigh.position.y = -0.18
      hip.add(thigh)
      const knee = new THREE.Group()
      knee.position.y = -0.36
      const kneeBall = new THREE.Mesh(new THREE.SphereGeometry(0.058, 10, 8), pants)
      knee.add(kneeBall)
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.2, 4, 12), pants)
      shin.position.y = -0.14
      knee.add(shin)
      const ankle = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), skin)
      ankle.position.y = -0.27
      knee.add(ankle)
      const foot = new THREE.Mesh(new RoundedBoxGeometry(0.095, 0.06, 0.24, 2, 0.025), shoe)
      foot.position.set(0, -0.3, 0.05)
      knee.add(foot)
      hip.add(knee)
      root.add(hip)
      return { hip, knee }
    }
    const legL = makeLeg(-1)
    const legR = makeLeg(1)
    this.breathTarget = chest

    this.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.receiveShadow = false
      }
    })

    this.parts = {
      torso: torsoPivot,
      head: headPivot,
      armL: armL.shoulder,
      armR: armR.shoulder,
      elbowL: armL.elbow,
      elbowR: armR.elbow,
      legL: legL.hip,
      legR: legR.hip,
      kneeL: legL.knee,
      kneeR: legR.knee,
      root,
    }
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation()
    return _v3a.set(t.x, t.y, t.z)
  }

  get footY(): number {
    return this.body.translation().y - CENTER_H
  }

  get headY(): number {
    return this.body.translation().y + CENTER_H
  }

  update(dt: number, waterLevel: number, flow: FlowField, ceilingLimit: number): void {
    const t = this.body.translation()
    const depth = Math.max(0, waterLevel - (t.y - CENTER_H))

    // 状態遷移
    if (depth < CHAR.wadeDepth) this.state = 'WALK'
    else if (depth < CHAR.swimDepth) this.state = 'WADE'
    else if (waterLevel >= ceilingLimit - 0.02) this.state = 'AIR_POCKET'
    else this.state = 'SWIM'

    const pos = new THREE.Vector3(t.x, t.y, t.z)
    flow.velocityAt(pos, _flow)
    const flowMag = Math.hypot(_flow.x, _flow.z)

    const inputMag = this.moveInput.length()
    const grounded = this.controller.computedGrounded()

    if (this.state === 'WALK' || this.state === 'WADE') {
      const dfrac =
        this.state === 'WALK'
          ? 0
          : (depth - CHAR.wadeDepth) / (CHAR.swimDepth - CHAR.wadeDepth)
      const speedFactor = 1 - (1 - CHAR.wadeMinFactor) * dfrac
      const targetVx = this.moveInput.x * CHAR.walkSpeed * speedFactor
      const targetVz = this.moveInput.y * CHAR.walkSpeed * speedFactor
      // 摩擦(足の効き)が水深で低下 → 加速も止まりも鈍る=滑る
      const grip = 1 - 0.8 * dfrac
      const accel = 12 * grip
      this.velocity.x += (targetVx - this.velocity.x) * Math.min(1, accel * dt)
      this.velocity.z += (targetVz - this.velocity.z) * Math.min(1, accel * dt)
      // 流れが足をさらう
      const push = (0.5 + 2.2 * dfrac) * dt
      this.velocity.x += (_flow.x - this.velocity.x * 0.0) * push
      this.velocity.z += (_flow.z - this.velocity.z * 0.0) * push
      // よろけ(流れ×水深に比例するランダム擾乱)
      if (flowMag * dfrac > 0.15) {
        this.staggerPhase += dt * (3 + flowMag)
        const wob = Math.sin(this.staggerPhase * 2.7) * Math.sin(this.staggerPhase * 1.3)
        this.velocity.x += wob * flowMag * dfrac * 0.6 * dt * 8
        this.velocity.z += Math.cos(this.staggerPhase * 2.1) * flowMag * dfrac * 0.5 * dt * 8
      }
      // 重力
      this.velocity.y -= 9.81 * dt * (1 - 0.65 * dfrac)
      if (grounded && this.velocity.y < -0.4) this.velocity.y = -0.4
    } else {
      // SWIM / AIR_POCKET: 上手く泳げる
      const targetVx = this.moveInput.x * CHAR.swimSpeed
      const targetVz = this.moveInput.y * CHAR.swimSpeed
      this.velocity.x += (targetVx - this.velocity.x) * Math.min(1, 5 * dt)
      this.velocity.z += (targetVz - this.velocity.z) * Math.min(1, 5 * dt)
      // 流れに流されつつも泳ぎで抗える
      this.velocity.x += _flow.x * 0.9 * dt
      this.velocity.z += _flow.z * 0.9 * dt
      if (Math.abs(this.swimVertical) > 0.05) {
        const targetVy = this.swimVertical * 1.1
        this.velocity.y += (targetVy - this.velocity.y) * Math.min(1, 5 * dt)
      } else {
        // 無操作時は頭が水面に出る高さへ漸近(立ち泳ぎ)
        const targetCenterY = Math.min(
          waterLevel - 0.52,
          ROOM.height - 0.06 - CENTER_H
        )
        const err = targetCenterY - t.y
        this.velocity.y += (err * 2.2 - this.velocity.y * 1.8) * dt * 2
      }
      // 頭を天井にぶつけない
      if (t.y > ROOM.height - 0.05 - CENTER_H && this.velocity.y > 0) this.velocity.y = 0
      // 床下に沈まない
      if (t.y < CENTER_H * 0.7 && this.velocity.y < 0) this.velocity.y = 0
    }

    // KCC で衝突解決しつつ移動
    const move = {
      x: this.velocity.x * dt,
      y: this.velocity.y * dt,
      z: this.velocity.z * dt,
    }
    this.controller.computeColliderMovement(this.collider, move)
    const cm = this.controller.computedMovement()
    this.body.setNextKinematicTranslation({ x: t.x + cm.x, y: t.y + cm.y, z: t.z + cm.z })
    // 実効速度に反映(壁で止まったら速度もリセット)
    if (dt > 0) {
      this.velocity.x = cm.x / dt
      if (this.state === 'WALK' || this.state === 'WADE') {
        if (this.controller.computedGrounded()) this.velocity.y = Math.max(this.velocity.y, cm.y / dt)
      } else {
        this.velocity.y = cm.y / dt
      }
      this.velocity.z = cm.z / dt
    }

    // 向き: 入力方向へ(泳ぎ中も)
    if (inputMag > 0.1) {
      this.targetYaw = Math.atan2(this.moveInput.x, this.moveInput.y)
    }
    let dy = this.targetYaw - this.yaw
    while (dy > Math.PI) dy -= Math.PI * 2
    while (dy < -Math.PI) dy += Math.PI * 2
    this.yaw += dy * Math.min(1, 8 * dt)

    // 体の傾き(よろけ・流れ)
    const leanTargetX = this.state === 'WADE' ? Math.min(0.35, _flow.z * 0.12 + Math.sin(this.staggerPhase * 2.7) * 0.13 * Math.min(1, flowMag)) : 0
    const leanTargetZ = this.state === 'WADE' ? Math.min(0.3, -_flow.x * 0.12 + Math.cos(this.staggerPhase * 1.9) * 0.1 * Math.min(1, flowMag)) : 0
    this.lean.x += (leanTargetX - this.lean.x) * Math.min(1, 5 * dt)
    this.lean.y += (leanTargetZ - this.lean.y) * Math.min(1, 5 * dt)

    this.animate(dt, depth, inputMag)
    this.syncMesh(depth, waterLevel)
  }

  private animate(dt: number, depth: number, inputMag: number): void {
    const p = this.parts
    const speed = Math.hypot(this.velocity.x, this.velocity.z)
    // 呼吸(常時、わずかに)
    this.breathTime += dt
    if (this.breathTarget) {
      const b = 1 + Math.sin((this.breathTime * Math.PI * 2) / 3.2) * 0.009
      this.breathTarget.scale.y = b
    }
    // 泳ぎ姿勢への滑らかな移行
    const swimming = this.state === 'SWIM' || this.state === 'AIR_POCKET'
    const swimLevel = swimming ? Math.min(1, inputMag * 1.5) : 0
    const poseTarget = swimming ? swimLevel : 0
    this.swimPose += (poseTarget - this.swimPose) * Math.min(1, 4 * dt)
    const sp = this.swimPose * this.swimPose * (3 - 2 * this.swimPose)
    p.root.rotation.x = -sp * 1.25

    if (!swimming) {
      // 非対称の踏み込み(sin + 2倍波)+ 腕は位相遅れ
      this.walkPhase += dt * (4 + speed * 5)
      const amp = Math.min(0.65, speed * 0.5 + (this.state === 'WADE' ? 0.25 : 0))
      const gait = (x: number) => Math.sin(x) + 0.15 * Math.sin(2 * x)
      const s = gait(this.walkPhase)
      const sArm = gait(this.walkPhase - 0.18)
      p.legL.rotation.x = s * amp
      p.legR.rotation.x = -s * amp
      p.kneeL.rotation.x = Math.max(0, -s) * amp * 0.9
      p.kneeR.rotation.x = Math.max(0, s) * amp * 0.9
      p.armL.rotation.x = -sArm * amp * 0.5
      p.armR.rotation.x = sArm * amp * 0.5
      p.elbowL.rotation.x = -0.22 - Math.max(0, sArm) * amp * 0.25
      p.elbowR.rotation.x = -0.22 - Math.max(0, -sArm) * amp * 0.25
      // 徒渉では腕でバランスを取る
      const spread = this.state === 'WADE' ? 0.5 + Math.min(0.4, depth * 0.3) : 0.06
      p.armL.rotation.z = -spread
      p.armR.rotation.z = spread
      p.torso.rotation.x = this.state === 'WADE' ? 0.12 : speed * 0.05
      p.head.rotation.x = this.state === 'WADE' ? -0.08 : 0
    } else {
      // 泳ぎ: 移動中は水平姿勢でクロール、停止中は立ち泳ぎ
      this.walkPhase += dt * (5 + speed * 4)
      const s = Math.sin(this.walkPhase * 2)
      // バタ足
      p.legL.rotation.x = s * 0.35 + sp * 0.15
      p.legR.rotation.x = -s * 0.35 + sp * 0.15
      p.kneeL.rotation.x = Math.max(0, s) * 0.3
      p.kneeR.rotation.x = Math.max(0, -s) * 0.3
      if (swimLevel > 0.3) {
        // クロールの腕回し
        p.armL.rotation.x = this.walkPhase * 1.6
        p.armR.rotation.x = this.walkPhase * 1.6 + Math.PI
        p.armL.rotation.z = -0.25
        p.armR.rotation.z = 0.25
        p.elbowL.rotation.x = -0.4
        p.elbowR.rotation.x = -0.4
        p.head.rotation.x = 0.9
      } else {
        // 立ち泳ぎ: 腕を横に掻く
        const w = Math.sin(this.walkPhase * 1.4)
        p.armL.rotation.x = 0
        p.armR.rotation.x = 0
        p.armL.rotation.z = -0.9 - w * 0.25
        p.armR.rotation.z = 0.9 + w * 0.25
        p.elbowL.rotation.x = -0.3 + w * 0.15
        p.elbowR.rotation.x = -0.3 + w * 0.15
        p.head.rotation.x = 0
      }
      p.torso.rotation.x = 0
    }
  }

  private syncMesh(depth: number, waterLevel: number): void {
    const t = this.body.translation()
    this.mesh.position.set(t.x, t.y, t.z)
    this.mesh.rotation.set(this.lean.x, this.yaw, this.lean.y, 'YXZ')
  }

  reset(): void {
    this.body.setTranslation({ x: this.initPos.x, y: this.initPos.y, z: this.initPos.z }, true)
    this.body.setNextKinematicTranslation({ x: this.initPos.x, y: this.initPos.y, z: this.initPos.z })
    this.velocity.set(0, 0, 0)
    this.moveInput.set(0, 0)
    this.swimVertical = 0
    this.state = 'WALK'
    this.walkPhase = 0
    this.targetYaw = this.yaw = Math.atan2(-0.3 - this.initPos.x, -ROOM.depth / 2 - this.initPos.z)
    this.syncMesh(0, 0)
  }
}
