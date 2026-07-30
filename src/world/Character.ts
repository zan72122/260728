// 主人公(一般成人)。KinematicCharacterController + 自前速度積分。
// 浸水深に応じて WALK → WADE(滑る/よろける) → SWIM → AIR_POCKET と遷移する。

import * as THREE from 'three'
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
    const skin = makeWettable(new THREE.MeshStandardMaterial({ color: 0xd9a884, roughness: 0.7 }))
    const shirt = makeWettable(new THREE.MeshStandardMaterial({ color: 0x6f8fb0, roughness: 0.85 }))
    const pants = makeWettable(new THREE.MeshStandardMaterial({ color: 0x474c56, roughness: 0.9 }))
    const hair = makeWettable(new THREE.MeshStandardMaterial({ color: 0x33281f, roughness: 0.9 }))

    const root = new THREE.Group()
    this.mesh.add(root)

    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.17, 0.19), pants)
    pelvis.position.y = -0.18
    root.add(pelvis)
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.3, 6, 12), shirt)
    torso.scale.set(1.1, 1, 0.72)
    torso.position.y = 0.1
    const torsoPivot = new THREE.Group()
    torsoPivot.add(torso)
    root.add(torsoPivot)

    const headPivot = new THREE.Group()
    headPivot.position.y = 0.42
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 14), skin)
    head.position.y = 0.09
    headPivot.add(head)
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.108, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      hair
    )
    hairCap.position.set(0, 0.1, -0.012)
    headPivot.add(hairCap)
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10), skin)
    neck.position.y = -0.015
    headPivot.add(neck)
    torsoPivot.add(headPivot)

    const makeArm = (side: number) => {
      const shoulder = new THREE.Group()
      shoulder.position.set(side * 0.21, 0.32, 0)
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.2, 4, 10), shirt)
      upper.position.y = -0.14
      shoulder.add(upper)
      const elbow = new THREE.Group()
      elbow.position.y = -0.28
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.18, 4, 10), skin)
      fore.position.y = -0.12
      elbow.add(fore)
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), skin)
      hand.position.y = -0.25
      elbow.add(hand)
      shoulder.add(elbow)
      torsoPivot.add(shoulder)
      return { shoulder, elbow }
    }
    const armL = makeArm(-1)
    const armR = makeArm(1)

    const makeLeg = (side: number) => {
      const hip = new THREE.Group()
      hip.position.set(side * 0.095, -0.27, 0)
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.26, 4, 10), pants)
      thigh.position.y = -0.17
      hip.add(thigh)
      const knee = new THREE.Group()
      knee.position.y = -0.34
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.24, 4, 10), pants)
      shin.position.y = -0.16
      knee.add(shin)
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.22), hair)
      foot.position.set(0, -0.31, 0.05)
      knee.add(foot)
      hip.add(knee)
      root.add(hip)
      return { hip, knee }
    }
    const legL = makeLeg(-1)
    const legR = makeLeg(1)

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
    if (this.state === 'WALK' || this.state === 'WADE') {
      this.walkPhase += dt * (4 + speed * 5)
      const amp = Math.min(0.65, speed * 0.5 + (this.state === 'WADE' ? 0.25 : 0))
      const s = Math.sin(this.walkPhase)
      p.legL.rotation.x = s * amp
      p.legR.rotation.x = -s * amp
      p.kneeL.rotation.x = Math.max(0, -s) * amp * 0.9
      p.kneeR.rotation.x = Math.max(0, s) * amp * 0.9
      p.armL.rotation.x = -s * amp * 0.55
      p.armR.rotation.x = s * amp * 0.55
      p.elbowL.rotation.x = -0.2
      p.elbowR.rotation.x = -0.2
      // 徒渉では腕でバランスを取る
      const spread = this.state === 'WADE' ? 0.5 + Math.min(0.4, depth * 0.3) : 0.06
      p.armL.rotation.z = -spread
      p.armR.rotation.z = spread
      p.torso.rotation.x = this.state === 'WADE' ? 0.12 : speed * 0.05
      p.root.rotation.x = 0
    } else {
      // 泳ぎ: 移動中は水平姿勢でクロール、停止中は立ち泳ぎ
      this.walkPhase += dt * (5 + speed * 4)
      const swimLevel = Math.min(1, inputMag * 1.5)
      p.root.rotation.x = -swimLevel * 1.25
      const s = Math.sin(this.walkPhase * 2)
      // バタ足
      p.legL.rotation.x = s * 0.35 + swimLevel * 0.15
      p.legR.rotation.x = -s * 0.35 + swimLevel * 0.15
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
        p.elbowL.rotation.x = 0
        p.elbowR.rotation.x = 0
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
