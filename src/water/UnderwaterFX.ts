// 水中側の見た目: カメラ水没時のフォグ・減光、水中の浮遊粒子、
// 満水間際の天井コースティクス。

import * as THREE from 'three'
import { ROOM, WATER } from '../sim/constants'
import { FloodSim } from '../sim/FloodSim'
import { softCircleTexture, causticsTexture } from '../gfx/textures'

export class UnderwaterFX {
  group = new THREE.Group()
  private motes: THREE.Points
  private motePos: Float32Array
  private caustics: THREE.Mesh
  private causticsMat: THREE.MeshBasicMaterial
  private fog = new THREE.FogExp2(new THREE.Color(WATER.deepColor).getHex(), WATER.underwaterFog)
  private aboveBg = new THREE.Color(0x233029)
  private underBg = new THREE.Color(0x243228)
  underwater = false

  constructor(
    private flood: FloodSim,
    private scene: THREE.Scene,
    private dirLight: THREE.DirectionalLight,
    private hemiLight: THREE.HemisphereLight
  ) {
    const N = 90
    this.motePos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      this.motePos[i * 3] = (Math.random() - 0.5) * ROOM.width * 0.9
      this.motePos[i * 3 + 1] = Math.random() * ROOM.height
      this.motePos[i * 3 + 2] = (Math.random() - 0.5) * ROOM.depth * 0.9
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.motePos, 3))
    this.motes = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        map: softCircleTexture(),
        color: 0xaebfa8,
        size: 0.02,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      })
    )
    this.motes.visible = false
    this.group.add(this.motes)

    this.causticsMat = new THREE.MeshBasicMaterial({
      map: causticsTexture(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.caustics = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM.width - 0.05, ROOM.depth - 0.05),
      this.causticsMat
    )
    this.caustics.rotation.x = Math.PI / 2
    this.caustics.position.y = ROOM.height - 0.01
    this.caustics.renderOrder = 9
    this.group.add(this.caustics)

    this.scene.background = this.aboveBg.clone()
  }

  update(dt: number, time: number, cameraY: number): void {
    const lvl = this.flood.waterLevel
    const under = lvl > 0.05 && cameraY < lvl

    if (under !== this.underwater) {
      this.underwater = under
      this.scene.fog = under ? this.fog : null
    }
    this.dirLight.intensity +=
      ((under ? 0.55 : 1.6) - this.dirLight.intensity) * Math.min(1, 6 * dt)
    this.hemiLight.intensity +=
      ((under ? 0.35 : 0.95) - this.hemiLight.intensity) * Math.min(1, 6 * dt)
    const bg = this.scene.background as THREE.Color
    bg.lerp(under ? this.underBg : this.aboveBg, Math.min(1, 5 * dt))

    // 水中の浮遊粒子(水面下のみに漂う)
    this.motes.visible = lvl > 0.3
    if (this.motes.visible) {
      const attr = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < this.motePos.length / 3; i++) {
        let y = attr.array[i * 3 + 1] as number
        y += Math.sin(time * 0.5 + i) * 0.0005 + 0.0003
        if (y > lvl - 0.03) y = 0.05 + Math.random() * Math.max(0.1, lvl - 0.1)
        attr.array[i * 3 + 1] = y
        attr.array[i * 3] = (attr.array[i * 3] as number) + Math.cos(time * 0.3 + i * 2.1) * 0.0004
      }
      attr.needsUpdate = true
    }

    // 満水間際: 天井の揺れる光模様
    const nearFull = Math.max(
      0,
      (lvl - (ROOM.height - WATER.airCompressStart)) / (WATER.airCompressStart - WATER.ceilingGap)
    )
    this.causticsMat.opacity = Math.min(0.35, nearFull * 0.4)
    if (this.causticsMat.map) {
      this.causticsMat.map.offset.set(time * 0.02, Math.sin(time * 0.3) * 0.05)
    }
  }
}
