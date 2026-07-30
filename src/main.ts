// エントリポイント: 全システムの結線と固定タイムステップのメインループ。

import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Renderer } from './engine/Renderer'
import { PhysicsWorld } from './physics/PhysicsWorld'
import { Buoyancy } from './physics/Buoyancy'
import { FlowField } from './physics/FlowField'
import { FloodSim } from './sim/FloodSim'
import { DT, ROOM } from './sim/constants'
import { Room } from './world/Room'
import { Door } from './world/Door'
import { Furniture } from './world/Furniture'
import { Character } from './world/Character'
import { Outside } from './world/Outside'
import { WaterSurface } from './water/WaterSurface'
import { InflowJet } from './water/InflowJet'
import { UnderwaterFX } from './water/UnderwaterFX'
import { wetUniforms } from './gfx/materials'
import { CameraRig } from './input/CameraRig'
import { Joystick } from './input/Joystick'
import { DoorSwipe } from './input/DoorSwipe'
import { GestureRouter } from './input/GestureRouter'
import { Hud } from './ui/Hud'

class App {
  renderer: Renderer
  scene = new THREE.Scene()
  rig: CameraRig
  physics: PhysicsWorld
  flood = new FloodSim()
  flow: FlowField
  buoyancy: Buoyancy
  room: Room
  door: Door
  furniture: Furniture
  character: Character
  outside: Outside
  water: WaterSurface
  jet: InflowJet
  fx: UnderwaterFX
  router: GestureRouter
  doorSwipe: DoorSwipe
  joystick: Joystick
  hud: Hud
  private accumulator = 0
  private last = performance.now()
  private simTime = 0
  private testMode: boolean
  private testDrive: { omega: number; remaining: number } | null = null
  private moveOverride: { x: number; y: number } | null = null

  constructor(parent: HTMLElement) {
    this.testMode = new URLSearchParams(location.search).has('test')
    this.renderer = new Renderer(parent)
    this.rig = new CameraRig(window.innerWidth / window.innerHeight)
    this.renderer.onResize = (w, h) => {
      this.rig.camera.aspect = w / h
      this.rig.portraitBoost = h > w ? 1.25 : 1
      this.rig.camera.updateProjectionMatrix()
    }
    this.renderer.onResize(window.innerWidth, window.innerHeight)

    // ライティング
    const dir = new THREE.DirectionalLight(0xfff4e0, 1.6)
    dir.position.set(2.5, 5.5, 3)
    dir.castShadow = true
    dir.shadow.mapSize.set(1024, 1024)
    dir.shadow.camera.left = -3.5
    dir.shadow.camera.right = 3.5
    dir.shadow.camera.top = 3.5
    dir.shadow.camera.bottom = -3.5
    dir.shadow.camera.far = 15
    dir.shadow.bias = -0.002
    this.scene.add(dir)
    const hemi = new THREE.HemisphereLight(0xdfe8dd, 0x3a3f36, 0.95)
    this.scene.add(hemi)
    const ceil = new THREE.PointLight(0xffe9c0, 12, 7)
    ceil.position.set(0, ROOM.height - 0.55, 0.25)
    this.scene.add(ceil)
    const pmrem = new THREE.PMREMGenerator(this.renderer.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.5

    // ワールド構築
    this.physics = new PhysicsWorld()
    this.room = new Room(this.physics)
    this.scene.add(this.room.group)
    this.door = new Door(this.physics)
    this.scene.add(this.door.mesh)
    this.furniture = new Furniture(this.physics)
    this.scene.add(this.furniture.group)
    this.character = new Character(this.physics)
    this.scene.add(this.character.mesh)
    this.outside = new Outside()
    this.scene.add(this.outside.group)

    this.flow = new FlowField(this.flood)
    this.buoyancy = new Buoyancy(this.flow)
    this.water = new WaterSurface(this.flood)
    this.scene.add(this.water.mesh)
    this.scene.add(this.water.sides)
    this.jet = new InflowJet(this.flood)
    this.scene.add(this.jet.group)
    this.fx = new UnderwaterFX(this.flood, this.scene, dir, hemi)
    this.scene.add(this.fx.group)

    // 入力
    this.joystick = new Joystick(parent)
    this.doorSwipe = new DoorSwipe(this.door, this.rig.camera)
    this.router = new GestureRouter(this.renderer.canvas, this.rig, this.joystick, this.doorSwipe)
    this.hud = new Hud(parent, {
      onReset: () => this.reset(),
      onQualityToggle: () => {
        const hi = this.renderer.dprCap < 2
        this.renderer.setQuality(hi)
        return hi
      },
    })

    if (this.testMode) this.installTestHooks()
    requestAnimationFrame(this.frame)
  }

  /** 固定タイムステップ 1 回分のシミュレーション */
  private step(dt: number): void {
    this.simTime += dt
    // テスト駆動(決定的検証用)
    if (this.testDrive) {
      this.door.targetOmega = this.testDrive.omega
      this.testDrive.remaining -= dt
      if (this.testDrive.remaining <= 0) {
        this.testDrive = null
        this.door.targetOmega = null
      }
    } else if (!this.doorSwipe.active && this.door.targetOmega !== null && !this.testMode) {
      this.door.targetOmega = null
    }

    // 入力 → キャラ
    const mv = this.moveOverride ?? this.joystick.value
    const world = this.rig.screenToWorldDir(mv.x, mv.y, new THREE.Vector2())
    this.character.moveInput.copy(world)
    this.character.swimVertical = this.router.swimVertical

    // 水位モデル
    this.flood.doorAngle = this.door.openAngle
    this.flood.step(dt)
    this.flow.updateGeometry()

    // 力の適用 → 物理 → 後処理
    this.doorSwipe.update(dt)
    this.door.applyTorques(this.flood.waterLevel)
    this.buoyancy.apply(this.furniture.floatingBodies, this.flood.waterLevel)
    this.character.update(dt, this.flood.waterLevel, this.flow, this.flood.ceilingLimit)
    this.physics.step()
    this.door.postStep()
    this.furniture.sync()
  }

  private frame = (): void => {
    const now = performance.now()
    let dt = (now - this.last) / 1000
    this.last = now
    if (dt > 0.1) dt = 0.1 // バックグラウンド復帰の Δt 爆発防止

    if (!this.testMode) {
      this.accumulator += dt
      let sub = 0
      while (this.accumulator >= DT && sub < 4) {
        this.step(DT)
        this.accumulator -= DT
        sub++
      }
      if (this.accumulator > DT * 4) this.accumulator = 0
    }

    // 描画系の毎フレーム更新
    const swim = this.character.state === 'SWIM' || this.character.state === 'AIR_POCKET'
    this.router.swimMode = swim
    this.router.update()
    const t = this.simTime
    this.water.update(t)
    this.jet.update(Math.min(dt, 0.05), t)
    this.outside.update(t)
    this.furniture.updateClock(t)
    this.door.updateGlow(t)
    wetUniforms.uWaterLevel.value = this.flood.waterLevel
    wetUniforms.uMaxLevel.value = this.flood.maxLevel

    const target = this.character.position.clone()
    target.y += swim ? 0.45 : 0.35
    this.rig.setTarget(target)
    this.rig.update(dt)
    this.fx.update(dt, t, this.rig.camera.position.y)
    this.hud.update(dt)

    this.renderer.renderer.render(this.scene, this.rig.camera)
    requestAnimationFrame(this.frame)
  }

  reset(): void {
    this.flood.reset()
    this.door.reset()
    this.furniture.reset()
    this.character.reset()
    this.jet.reset()
    this.testDrive = null
    this.moveOverride = null
    this.simTime = 0
  }

  /** ?test=1 のとき: 決定的な手動ステップ実行フックを公開 */
  private installTestHooks(): void {
    const api = {
      step: (n: number) => {
        for (let i = 0; i < n; i++) this.step(DT)
      },
      setDoorOmega: (omega: number, seconds: number) => {
        this.testDrive = { omega, remaining: seconds }
      },
      setMove: (x: number, y: number) => {
        this.moveOverride = x === 0 && y === 0 ? null : { x, y }
      },
      reset: () => this.reset(),
      knobScreen: () => {
        const v = new THREE.Vector3()
        this.door.knobWorld(v)
        v.project(this.rig.camera)
        return {
          x: ((v.x + 1) / 2) * window.innerWidth,
          y: ((1 - v.y) / 2) * window.innerHeight,
        }
      },
      state: () => ({
        waterLevel: this.flood.waterLevel,
        inflowRate: this.flood.inflowRate,
        doorAngle: this.door.openAngle,
        charState: this.character.state,
        charPos: { ...this.character.position },
        time: this.simTime,
      }),
    }
    ;(window as unknown as { __sim: typeof api }).__sim = api
  }
}

async function boot(): Promise<void> {
  await RAPIER.init()
  const parent = document.getElementById('app')!
  new App(parent)
}

boot()
