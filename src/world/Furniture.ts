// 家具・小物。質量と排水体積の違いで「浮く/沈む/倒れる/吊り下がったまま」
// の挙動差を作る。初期は sleep させ、水が届いたら Buoyancy 側で起こす。

import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { PhysicsWorld, GROUP_PROP, GROUP_STATIC, GROUP_DOOR, GROUP_CHAR, groups } from '../physics/PhysicsWorld'
import { FloatingBody } from '../physics/Buoyancy'
import { ROOM } from '../sim/constants'
import { woodMat, woodDarkMat, whiteMat, metalMat, fabricMat, makeWettable } from '../gfx/materials'

interface PropInit {
  pos: THREE.Vector3
  quat: THREE.Quaternion
}

export interface Prop {
  name: string
  body: RAPIER.RigidBody
  mesh: THREE.Object3D
  floating: FloatingBody
  init: PropInit
}

const PROP_GROUPS = groups(GROUP_PROP, GROUP_STATIC | GROUP_DOOR | GROUP_PROP | GROUP_CHAR)

export class Furniture {
  group = new THREE.Group()
  props: Prop[] = []
  private clockHands: { hour: THREE.Object3D; min: THREE.Object3D } | null = null

  constructor(private physics: PhysicsWorld) {
    this.buildFridge()
    this.buildDresser()
    this.buildTable()
    this.buildChair()
    this.buildCushion()
    this.buildTrashBin()
    this.buildSlippers()
    this.buildMagazines()
    this.buildShelfAndBooks()
    this.buildPendantLamp()
    this.buildWallClock()
  }

  get floatingBodies(): FloatingBody[] {
    return this.props.map((p) => p.floating)
  }

  private addProp(
    name: string,
    mesh: THREE.Object3D,
    size: THREE.Vector3,
    mass: number,
    dispVol: number,
    pos: THREE.Vector3,
    rotY = 0,
    opts: { friction?: number; dragScale?: number } = {}
  ): Prop {
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY)
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
    )
    const volume = size.x * size.y * size.z
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setDensity(mass / volume)
        .setFriction(opts.friction ?? 0.6)
        .setRestitution(0.05)
        .setCollisionGroups(PROP_GROUPS),
      body
    )
    body.sleep()
    mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    this.group.add(mesh)
    const prop: Prop = {
      name,
      body,
      mesh,
      floating: {
        body,
        half: new THREE.Vector3(size.x / 2, size.y / 2, size.z / 2),
        dispVol,
        frontal: size.y * Math.max(size.x, size.z) * 0.8,
        dragScale: opts.dragScale,
      },
      init: { pos: pos.clone(), quat: quat.clone() },
    }
    this.props.push(prop)
    return prop
  }

  // 冷蔵庫: 密閉体なので排水体積が大きい → 深水で浮き上がりながら転倒
  private buildFridge(): void {
    const size = new THREE.Vector3(0.62, 1.55, 0.62)
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), whiteMat())
    g.add(body)
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(size.x + 0.005, 0.012, size.z + 0.005),
      new THREE.MeshStandardMaterial({ color: 0x9aa0a3, roughness: 0.6 })
    )
    line.position.y = 0.25
    g.add(line)
    for (const hy of [0.55, 0.0]) {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), metalMat())
      handle.position.set(-size.x / 2 + 0.06, hy, size.z / 2 + 0.03)
      g.add(handle)
    }
    this.addProp('fridge', g, size, 78, 0.5, new THREE.Vector3(1.75, size.y / 2, -1.2), 0, {
      friction: 0.7,
    })
  }

  // タンス: 開放棚で水が入る → 排水体積小 → ほぼ沈んだまま流れで傾く
  private buildDresser(): void {
    const size = new THREE.Vector3(1.0, 1.15, 0.42)
    const g = new THREE.Group()
    g.add(new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), woodDarkMat()))
    for (let i = 0; i < 3; i++) {
      const front = new THREE.Mesh(new THREE.BoxGeometry(size.x - 0.08, 0.3, 0.02), woodMat())
      front.position.set(0, size.y / 2 - 0.22 - i * 0.36, size.z / 2 + 0.01)
      g.add(front)
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), metalMat())
      knob.position.set(0, front.position.y, size.z / 2 + 0.03)
      g.add(knob)
    }
    this.addProp('dresser', g, size, 88, 0.075, new THREE.Vector3(-1.55, size.y / 2, 1.55), 0, {
      friction: 0.75,
    })
  }

  // 木テーブル: 中量 → 水位が上がると浮いて流される
  private buildTable(): void {
    const size = new THREE.Vector3(0.95, 0.68, 0.65)
    const g = new THREE.Group()
    const top = new THREE.Mesh(new THREE.BoxGeometry(size.x, 0.05, size.z), woodMat())
    top.position.y = size.y / 2 - 0.025
    g.add(top)
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, size.y - 0.05, 0.05), woodMat())
        leg.position.set(sx * (size.x / 2 - 0.06), -0.025, sz * (size.z / 2 - 0.06))
        g.add(leg)
      }
    this.addProp('table', g, size, 15, 0.024, new THREE.Vector3(0.65, size.y / 2, 0.6), 0.15)
  }

  // 椅子: 軽め → 早めに浮く
  private buildChair(): void {
    const size = new THREE.Vector3(0.42, 0.85, 0.42)
    const g = new THREE.Group()
    const seatY = 0.45 - size.y / 2
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.045, 0.4), woodMat())
    seat.position.y = seatY
    g.add(seat)
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.04), woodMat())
        leg.position.set(sx * 0.17, seatY - 0.225, sz * 0.17)
        g.add(leg)
      }
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.035), woodMat())
    back.position.set(0, seatY + 0.21, -0.18)
    g.add(back)
    this.addProp('chair', g, size, 5.5, 0.009, new THREE.Vector3(0.35, size.y / 2, 0.0), -0.4)
  }

  // クッション: 床の軽い物 → すぐ浮く
  private buildCushion(): void {
    const size = new THREE.Vector3(0.45, 0.13, 0.45)
    const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z, 2, 1, 2), fabricMat())
    this.addProp('cushion', m, size, 0.6, 0.02, new THREE.Vector3(-0.55, size.y / 2, 0.9), 0.5, {
      dragScale: 1.6,
    })
  }

  // ゴミ箱: プラ製 → 浮いて流される
  private buildTrashBin(): void {
    const size = new THREE.Vector3(0.28, 0.34, 0.28)
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.11, size.y, 16),
      makeWettable(new THREE.MeshStandardMaterial({ color: 0x7d8f9b, roughness: 0.5 }))
    )
    this.addProp('trash', m, size, 0.7, 0.011, new THREE.Vector3(-1.9, size.y / 2, -1.2), 0)
  }

  // スリッパ: 最軽量 → 真っ先に浮く
  private buildSlippers(): void {
    for (const [i, x, z, r] of [
      [0, -0.35, -1.35, 0.2],
      [1, -0.05, -1.4, -0.15],
    ] as const) {
      const size = new THREE.Vector3(0.11, 0.05, 0.28)
      const g = new THREE.Group()
      const sole = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, 0.02, size.z),
        makeWettable(new THREE.MeshStandardMaterial({ color: 0xb0575a, roughness: 0.9 }))
      )
      sole.position.y = -0.01
      g.add(sole)
      const toe = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, 0.03, 0.12),
        makeWettable(new THREE.MeshStandardMaterial({ color: 0xc76d70, roughness: 0.9 }))
      )
      toe.position.set(0, 0.01, -0.05)
      g.add(toe)
      this.addProp(`slipper${i}`, g, size, 0.12, 0.0012, new THREE.Vector3(x, 0.03, z), r, {
        dragScale: 2,
      })
    }
  }

  // 雑誌の山: 紙 → 低く浮かぶ
  private buildMagazines(): void {
    const size = new THREE.Vector3(0.25, 0.09, 0.32)
    const g = new THREE.Group()
    const colors = [0xd9d4c8, 0xc9d2dc, 0xd9c9c0]
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.028, 0.3),
        makeWettable(new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.85 }))
      )
      m.position.y = -size.y / 2 + 0.015 + i * 0.03
      m.rotation.y = (i - 1) * 0.15
      g.add(m)
    }
    this.addProp('magazines', g, size, 2.2, 0.0058, new THREE.Vector3(1.15, size.y / 2, 1.35), 0.9)
  }

  // 本棚(固定)+ 本(水が届くと浮き出す)
  private buildShelfAndBooks(): void {
    const shelfW = 0.9 // z 方向
    const shelfD = 0.34 // x 方向
    const shelfH = 1.5
    const cx = -ROOM.width / 2 + shelfD / 2 + 0.02
    const cz = -0.55
    const g = new THREE.Group()
    const mat = woodDarkMat()
    const panel = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
      m.position.set(x, y, z)
      m.castShadow = true
      m.receiveShadow = true
      g.add(m)
    }
    // 側板・背板・棚板
    panel(shelfD, shelfH, 0.03, cx, shelfH / 2, cz - shelfW / 2)
    panel(shelfD, shelfH, 0.03, cx, shelfH / 2, cz + shelfW / 2)
    panel(0.03, shelfH, shelfW, cx - shelfD / 2 + 0.015, shelfH / 2, cz)
    for (const y of [0.06, 0.55, 1.05, shelfH]) {
      panel(shelfD, 0.035, shelfW, cx, y, cz)
      this.physics.addStaticBox(cx, y, cz, shelfD / 2, 0.02, shelfW / 2)
    }
    this.group.add(g)

    // 本: 上段に並べる(初期 sleep、水位到達で浮き出す)
    const bookColors = [0x8a4a3d, 0x3d5a72, 0x6a7a4a, 0x9a8a5a, 0x5a4a6a, 0x7a5a3a]
    for (let i = 0; i < 6; i++) {
      const bh = 0.2 + (i % 3) * 0.015
      const size = new THREE.Vector3(0.032, bh, 0.15)
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        makeWettable(new THREE.MeshStandardMaterial({ color: bookColors[i], roughness: 0.8 }))
      )
      this.addProp(
        `book${i}`,
        m,
        size,
        0.32,
        0.00095,
        new THREE.Vector3(cx + 0.03, 0.55 + 0.0375 + bh / 2, cz - 0.32 + i * 0.055),
        0
      )
    }
  }

  // 吊り下げ照明: 天井アンカーに球面ジョイント → 吊り下がったまま揺れる
  private buildPendantLamp(): void {
    const size = new THREE.Vector3(0.26, 0.34, 0.26)
    const g = new THREE.Group()
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.35, 8), metalMat())
    rod.position.y = 0.17 + 0.1
    g.add(rod)
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 0.16, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.6, side: THREE.DoubleSide })
    )
    shade.position.y = 0.05
    g.add(shade)
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 14, 10),
      new THREE.MeshStandardMaterial({
        color: 0xfff6dd,
        emissive: 0xffe9b0,
        emissiveIntensity: 1.6,
        roughness: 0.3,
      })
    )
    bulb.position.y = -0.02
    g.add(bulb)

    const pos = new THREE.Vector3(0, ROOM.height - 0.45, 0.25)
    const prop = this.addProp('lamp', g, size, 1.3, 0.003, pos, 0, { dragScale: 1.2 })
    // 天井アンカー
    const anchor = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, ROOM.height, pos.z)
    )
    this.physics.world.createImpulseJoint(
      RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: 0.45, z: 0 }),
      anchor,
      prop.body,
      true
    )
    // 照明は常時起こしておく(揺れが止まらないように軽く)
    prop.body.wakeUp()
  }

  // 壁掛け時計(固定・見た目のみ)。針は動く
  private buildWallClock(): void {
    const g = new THREE.Group()
    const face = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.03, 32),
      new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.5 })
    )
    face.rotation.x = Math.PI / 2
    g.add(face)
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.014, 10, 32),
      woodDarkMat()
    )
    g.add(rim)
    const hour = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, 0.08, 0.01),
      new THREE.MeshStandardMaterial({ color: 0x222222 })
    )
    hour.position.set(0, 0.04, 0.02)
    const hourPivot = new THREE.Group()
    hourPivot.add(hour)
    g.add(hourPivot)
    const min = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.12, 0.01),
      new THREE.MeshStandardMaterial({ color: 0x222222 })
    )
    min.position.set(0, 0.06, 0.022)
    const minPivot = new THREE.Group()
    minPivot.add(min)
    g.add(minPivot)
    g.position.set(0.4, 1.75, ROOM.depth / 2 - 0.04)
    g.rotation.y = Math.PI
    this.group.add(g)
    this.clockHands = { hour: hourPivot, min: minPivot }
  }

  updateClock(time: number): void {
    if (!this.clockHands) return
    this.clockHands.min.rotation.z = -time * 0.02
    this.clockHands.hour.rotation.z = -time * 0.0017 - 1.2
  }

  /** 物理→メッシュ同期 */
  sync(): void {
    for (const p of this.props) {
      const t = p.body.translation()
      const r = p.body.rotation()
      p.mesh.position.set(t.x, t.y, t.z)
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w)
    }
  }

  reset(): void {
    for (const p of this.props) {
      p.body.resetForces(false)
      p.body.resetTorques(false)
      p.body.setTranslation({ x: p.init.pos.x, y: p.init.pos.y, z: p.init.pos.z }, false)
      p.body.setRotation({ x: p.init.quat.x, y: p.init.quat.y, z: p.init.quat.z, w: p.init.quat.w }, false)
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, false)
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, false)
      if (p.name !== 'lamp') p.body.sleep()
    }
    this.sync()
  }
}
