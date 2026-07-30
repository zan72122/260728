// 家具・小物。質量と排水体積の違いで「浮く/沈む/倒れる/吊り下がったまま」
// の挙動差を作る。初期は sleep させ、水が届いたら Buoyancy 側で起こす。

import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { PhysicsWorld, GROUP_PROP, GROUP_STATIC, GROUP_DOOR, GROUP_CHAR, groups } from '../physics/PhysicsWorld'
import { FloatingBody } from '../physics/Buoyancy'
import { ROOM } from '../sim/constants'
import {
  woodMat,
  woodDarkMat,
  whiteMat,
  metalMat,
  fabricMat,
  makeWettable,
  upholsteryMat,
  cardboardMat,
  ceramicMat,
  leafMat,
  tvBodyMat,
  tvScreenMat,
  plasticMat,
} from '../gfx/materials'

/** 面取りボックス(PS2感の要: エッジのハイライトが出る) */
function rbox(w: number, h: number, d: number, r = 0.012, seg = 2): RoundedBoxGeometry {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) / 2.5))
}

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
  private clockGroup: THREE.Group | null = null

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
    const dbg = new URLSearchParams(location.search).get('noprops') ?? ''
    if (!dbg.includes('tv')) this.buildTvAndStand()
    if (!dbg.includes('sofa')) this.buildSofa()
    if (!dbg.includes('plant')) this.buildPlant()
    if (!dbg.includes('bottle')) this.buildBottles()
    if (!dbg.includes('basket')) this.buildBasket()
    if (!dbg.includes('cardboard')) this.buildCardboardBox()
    if (!dbg.includes('ball')) this.buildBall()
  }

  get floatingBodies(): FloatingBody[] {
    return this.props.map((p) => p.floating)
  }

  /**
   * カメラと主人公の間を遮る大きな家具を半透明にフェードする。
   * 小物が横切るのは自然なので対象外。マテリアルは対象プロップだけ複製済み。
   */
  updateOcclusionFade(camPos: THREE.Vector3, target: THREE.Vector3, dt: number): void {
    this.ensureFadeSetup()
    const ax = camPos.x - target.x
    const ay = camPos.y - 0.25 - (target.y - 0.25)
    const az = camPos.z - target.z
    const len = Math.hypot(ax, ay, az)
    if (len < 0.01) return
    const nx = ax / len
    const ny = ay / len
    const nz = az / len
    for (const f of this.fadeProps!) {
      const t = f.prop.body.translation()
      const vx = t.x - target.x
      const vy = t.y - (target.y - 0.25)
      const vz = t.z - target.z
      const depth = vx * nx + vy * ny + vz * nz
      const lat = Math.sqrt(Math.max(0, vx * vx + vy * vy + vz * vz - depth * depth))
      const blocked = depth > 0.35 && depth < len - 0.15 && lat < f.r * 0.75 + 0.1
      const goal = blocked ? 0.14 : 1
      f.fade += (goal - f.fade) * Math.min(1, 8 * dt)
      const faded = f.fade < 0.985
      for (const m of f.mats) {
        m.opacity = f.fade
        m.transparent = faded
        m.depthWrite = f.fade > 0.6
      }
    }
  }

  private fadeProps:
    | { prop: Prop; mats: THREE.MeshStandardMaterial[]; r: number; fade: number }[]
    | null = null

  private ensureFadeSetup(): void {
    if (this.fadeProps) return
    this.fadeProps = []
    for (const p of this.props) {
      const h = p.floating.half
      if (Math.max(h.x, h.y, h.z) * 2 < 0.55) continue
      // このプロップ専用にマテリアルを複製(共有キャッシュを汚さない)
      const cloneMap = new Map<THREE.Material, THREE.MeshStandardMaterial>()
      const mats: THREE.MeshStandardMaterial[] = []
      p.mesh.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
          let c = cloneMap.get(o.material)
          if (!c) {
            c = o.material.clone()
            cloneMap.set(o.material, c)
            mats.push(c)
          }
          o.material = c
        }
      })
      this.fadeProps.push({ prop: p, mats, r: h.length(), fade: 1 })
    }
  }

  private addProp(
    name: string,
    mesh: THREE.Object3D,
    size: THREE.Vector3,
    mass: number,
    dispVol: number,
    pos: THREE.Vector3,
    rotY = 0,
    opts: { friction?: number; dragScale?: number; shape?: 'cuboid' | 'ball'; restitution?: number } = {}
  ): Prop {
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY)
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
        .setCcdEnabled(true) // 軽い物が壁・天井をトンネリングしないように
    )
    const volume = size.x * size.y * size.z
    const desc =
      opts.shape === 'ball'
        ? RAPIER.ColliderDesc.ball(size.x / 2).setDensity(mass / ((4 / 3) * Math.PI * (size.x / 2) ** 3))
        : RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setDensity(mass / volume)
    this.physics.world.createCollider(
      desc
        .setFriction(opts.friction ?? 0.6)
        .setRestitution(opts.restitution ?? 0.05)
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
    const body = new THREE.Mesh(rbox(size.x, size.y, size.z, 0.045, 3), whiteMat())
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
    g.add(new THREE.Mesh(rbox(size.x, size.y, size.z, 0.02, 2), woodDarkMat()))
    for (let i = 0; i < 3; i++) {
      const front = new THREE.Mesh(rbox(size.x - 0.08, 0.3, 0.02, 0.008, 2), woodMat())
      front.position.set(0, size.y / 2 - 0.22 - i * 0.36, size.z / 2 + 0.01)
      g.add(front)
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), metalMat())
      knob.position.set(0, front.position.y, size.z / 2 + 0.03)
      g.add(knob)
    }
    this.addProp('dresser', g, size, 88, 0.075, new THREE.Vector3(1.95, size.y / 2, 1.25), -Math.PI / 2, {
      friction: 0.75,
    })
  }

  // 木テーブル: 中量 → 水位が上がると浮いて流される
  private buildTable(): void {
    const size = new THREE.Vector3(0.95, 0.68, 0.65)
    const g = new THREE.Group()
    const top = new THREE.Mesh(rbox(size.x, 0.05, size.z, 0.014, 2), woodMat())
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
    const seat = new THREE.Mesh(rbox(0.4, 0.045, 0.4, 0.012, 2), woodMat())
    seat.position.y = seatY
    g.add(seat)
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.04), woodMat())
        leg.position.set(sx * 0.17, seatY - 0.225, sz * 0.17)
        g.add(leg)
      }
    const back = new THREE.Mesh(rbox(0.4, 0.38, 0.035, 0.012, 2), woodMat())
    back.position.set(0, seatY + 0.21, -0.18)
    g.add(back)
    this.addProp('chair', g, size, 5.5, 0.009, new THREE.Vector3(0.35, size.y / 2, 0.0), -0.4)
  }

  // クッション: 床の軽い物 → すぐ浮く
  private buildCushion(): void {
    const size = new THREE.Vector3(0.45, 0.13, 0.45)
    const m = new THREE.Mesh(rbox(size.x, size.y, size.z, 0.05, 3), fabricMat())
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
        rbox(0.24, 0.028, 0.3, 0.006, 2),
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
        rbox(size.x, size.y, size.z, 0.006, 2),
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

  // TV台: 低くて重い → ほぼ沈んだまま
  private buildTvAndStand(): void {
    const size = new THREE.Vector3(1.2, 0.36, 0.38)
    const g = new THREE.Group()
    g.add(new THREE.Mesh(rbox(size.x, size.y, size.z, 0.015, 2), woodDarkMat()))
    for (const sx of [-1, 1]) {
      const doorP = new THREE.Mesh(rbox(0.52, 0.26, 0.015, 0.006, 2), woodMat())
      doorP.position.set(sx * 0.29, 0, size.z / 2 + 0.008)
      g.add(doorP)
    }
    this.addProp('tvStand', g, size, 32, 0.05, new THREE.Vector3(-0.5, size.y / 2, 1.58), Math.PI, {
      friction: 0.7,
    })

    // 薄型TV: 軽くて薄い → 浮いて裏返る
    const tvSize = new THREE.Vector3(0.95, 0.58, 0.08)
    const tv = new THREE.Group()
    const panel = new THREE.Mesh(rbox(0.95, 0.55, 0.045, 0.01, 2), tvBodyMat())
    panel.position.y = 0.015
    tv.add(panel)
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.48), tvScreenMat())
    screen.position.set(0, 0.015, 0.024)
    tv.add(screen)
    const foot = new THREE.Mesh(rbox(0.4, 0.03, 0.16, 0.008, 2), tvBodyMat())
    foot.position.y = -0.275
    tv.add(foot)
    this.addProp(
      'tv',
      tv,
      tvSize,
      7.5,
      0.02,
      new THREE.Vector3(-0.5, 0.36 + tvSize.y / 2, 1.62),
      Math.PI,
      { dragScale: 1.5 }
    )
  }

  // 小さめソファ: 発泡材 → 深水でゆっくり浮上して漂う
  private buildSofa(): void {
    const size = new THREE.Vector3(0.8, 0.72, 1.4)
    const g = new THREE.Group()
    const mat = upholsteryMat()
    const base = new THREE.Mesh(rbox(0.72, 0.3, 1.3, 0.05, 3), mat)
    base.position.set(0.04, -size.y / 2 + 0.25, 0)
    g.add(base)
    const back = new THREE.Mesh(rbox(0.22, 0.62, 1.3, 0.05, 3), mat)
    back.position.set(-size.x / 2 + 0.13, 0.03, 0)
    back.rotation.z = -0.12
    g.add(back)
    for (const sz of [-1, 1]) {
      const arm = new THREE.Mesh(rbox(0.6, 0.2, 0.16, 0.05, 3), mat)
      arm.position.set(0.06, -0.02, sz * 0.62)
      g.add(arm)
      const cushion = new THREE.Mesh(rbox(0.55, 0.13, 0.58, 0.05, 3), fabricMat())
      cushion.position.set(0.08, -size.y / 2 + 0.44, sz * 0.31)
      g.add(cushion)
    }
    for (const sz of [-1, 1])
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.1, 10), woodDarkMat())
        leg.position.set(sx * 0.3, -size.y / 2 + 0.05, sz * 0.55)
        g.add(leg)
      }
    this.addProp('sofa', g, size, 26, 0.2, new THREE.Vector3(-1.72, size.y / 2, 0.9), Math.PI / 2, {
      friction: 0.7,
      dragScale: 1.2,
    })
  }

  // 観葉植物: 陶器鉢 → 沈んで転がる(葉は軽いが鉢が重い)
  private buildPlant(): void {
    const size = new THREE.Vector3(0.3, 0.62, 0.3)
    const g = new THREE.Group()
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.24, 16), ceramicMat())
    pot.position.y = -size.y / 2 + 0.12
    g.add(pot)
    const soil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.02, 16),
      makeWettable(new THREE.MeshStandardMaterial({ color: 0x2e2117, roughness: 1 }))
    )
    soil.position.y = -size.y / 2 + 0.235
    g.add(soil)
    for (let i = 0; i < 3; i++) {
      const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), leafMat())
      leaf.position.y = -size.y / 2 + 0.44
      leaf.rotation.y = (i * Math.PI) / 3
      g.add(leaf)
    }
    this.addProp('plant', g, size, 6.5, 0.0045, new THREE.Vector3(1.25, size.y / 2, -1.55), 0.4)
  }

  // ペットボトル: 真っ先に浮いて流される
  private buildBottles(): void {
    for (const [i, x, z] of [
      [0, 0.48, 0.42],
      [1, 0.85, 0.72],
    ] as const) {
      const size = new THREE.Vector3(0.075, 0.24, 0.075)
      const g = new THREE.Group()
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.036, 0.038, 0.2, 14),
        plasticMat(i === 0 ? 0xd8e8f0 : 0xd8ecd8)
      )
      body.position.y = -0.01
      g.add(body)
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.025, 10), plasticMat(0x4a86c8))
      cap.position.y = 0.105
      g.add(cap)
      const label = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0385, 0.0385, 0.07, 14),
        makeWettable(new THREE.MeshStandardMaterial({ color: i === 0 ? 0x5a90c8 : 0x6aa86a, roughness: 0.5 }))
      )
      label.position.y = -0.02
      g.add(label)
      // テーブルの上に置く
      this.addProp(`bottle${i}`, g, size, 0.55, 0.0018, new THREE.Vector3(x, 0.68 + size.y / 2, z), i, {
        dragScale: 2,
        friction: 0.4,
      })
    }
  }

  // ランドリーバスケット: プラ製 → 浮く
  private buildBasket(): void {
    const size = new THREE.Vector3(0.36, 0.4, 0.36)
    const g = new THREE.Group()
    const bin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.185, 0.15, size.y, 12, 1, true),
      plasticMat(0xcfd4d8)
    )
    ;(bin.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
    g.add(bin)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.014, 8, 16), plasticMat(0xb8bec4))
    rim.rotation.x = Math.PI / 2
    rim.position.y = size.y / 2
    g.add(rim)
    const towel = new THREE.Mesh(rbox(0.24, 0.1, 0.24, 0.04, 2), fabricMat())
    towel.position.y = size.y / 2 - 0.1
    towel.rotation.y = 0.5
    g.add(towel)
    this.addProp('basket', g, size, 1.4, 0.008, new THREE.Vector3(-0.85, size.y / 2, 1.15), 0.7, {
      dragScale: 1.5,
    })
  }

  // 段ボール箱: しばらく浮いてから水を吸う想定の低い浮力
  private buildCardboardBox(): void {
    const size = new THREE.Vector3(0.42, 0.32, 0.36)
    const m = new THREE.Mesh(rbox(size.x, size.y, size.z, 0.008, 2), cardboardMat())
    this.addProp('cardboard', m, size, 3.2, 0.02, new THREE.Vector3(1.15, size.y / 2, 1.35), -0.25)
  }

  // ボール: 弾んで水面を漂う
  private buildBall(): void {
    const size = new THREE.Vector3(0.22, 0.22, 0.22)
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 24, 18),
      plasticMat(0xc86a50)
    )
    this.addProp('ball', m, size, 0.18, 0.0045, new THREE.Vector3(0.1, 0.11, 1.15), 0, {
      shape: 'ball',
      restitution: 0.55,
      dragScale: 1.8,
    })
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
    this.clockGroup = g
  }

  updateClock(time: number, camZ: number): void {
    if (!this.clockHands) return
    this.clockHands.min.rotation.z = -time * 0.02
    this.clockHands.hour.rotation.z = -time * 0.0017 - 1.2
    // 後ろ壁の外にカメラがあるときは時計も隠す(壁掛け物の裏面対策)
    if (this.clockGroup) this.clockGroup.visible = camZ < ROOM.depth / 2 + 0.05
  }

  /**
   * ステップ後の後始末:
   * - ドア開口から弾き出されて部屋外に出た物は退避(視界外へ)
   * - 接触ソルバーが注入する非現実的なスピンを抑える
   */
  postStep(): void {
    const hw = ROOM.width / 2 + 0.4
    const hd = ROOM.depth / 2 + 0.4
    let stash = 0
    for (const p of this.props) {
      const t = p.body.translation()
      if (
        p.name !== 'lamp' &&
        (Math.abs(t.x) > hw || Math.abs(t.z) > hd || t.y < -0.5 || t.y > ROOM.height + 0.6)
      ) {
        p.body.setTranslation({ x: 30 + stash * 2, y: -20, z: 0 }, false)
        p.body.setLinvel({ x: 0, y: 0, z: 0 }, false)
        p.body.setAngvel({ x: 0, y: 0, z: 0 }, false)
        p.body.sleep()
        stash++
        continue
      }
      const av = p.body.angvel()
      const avMag = Math.hypot(av.x, av.y, av.z)
      if (avMag > 9) {
        const k = 9 / avMag
        p.body.setAngvel({ x: av.x * k, y: av.y * k, z: av.z * k }, false)
      }
    }
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
      p.body.setLinearDamping(0)
      p.body.setAngularDamping(0)
      if (p.name !== 'lamp') p.body.sleep()
    }
    this.sync()
  }
}
