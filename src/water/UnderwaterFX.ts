// 水中側の見た目: カメラ水没時のフォグ・減光、水中の浮遊粒子、
// 満水間際の天井コースティクス。

import * as THREE from 'three'
import { DOOR, ROOM, WATER } from '../sim/constants'
import { FloodSim } from '../sim/FloodSim'
import { softCircleTexture, causticsTexture } from '../gfx/textures'
import { WINDOW_RECT } from '../world/Room'

/** 根本→先端でフェードする光芒 */
function makeBeamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vUv;
      void main(){
        float alongFade = pow(vUv.y, 1.6);
        float edgeFade = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
        float shimmer = 0.8 + 0.2 * sin(uTime * 1.7 + vUv.x * 9.0);
        gl_FragColor = vec4(0.65, 0.85, 0.75, uOpacity * alongFade * edgeFade * shimmer);
      }
    `,
  })
}

export class UnderwaterFX {
  group = new THREE.Group()
  private motes: THREE.Points
  private motePos: Float32Array
  private caustics: THREE.Mesh
  private causticsMat: THREE.MeshBasicMaterial
  private floorCausticsMat: THREE.MeshBasicMaterial
  private beamMats: THREE.ShaderMaterial[] = []
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

    // 床のコースティクス(浅水時の屈折光)
    this.floorCausticsMat = new THREE.MeshBasicMaterial({
      map: causticsTexture(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const fc = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM.width - 0.05, ROOM.depth - 0.05),
      this.floorCausticsMat
    )
    fc.rotation.x = -Math.PI / 2
    fc.position.y = 0.012
    fc.renderOrder = 7
    this.group.add(fc)

    // 窓・ドア開口からの光芒(水没時)
    const addBeams = (
      cx: number,
      cy: number,
      cz: number,
      w: number,
      len: number,
      axis: 'x' | 'z'
    ) => {
      for (const off of [-0.16, 0, 0.16]) {
        const mat = makeBeamMaterial()
        this.beamMats.push(mat)
        const geo = new THREE.PlaneGeometry(w, len, 1, 8)
        geo.translate(0, -len / 2, 0)
        const m = new THREE.Mesh(geo, mat)
        const g = new THREE.Group()
        g.position.set(cx, cy, cz)
        if (axis === 'x') {
          // 窓(+x壁)から -x 下向きへ
          g.rotation.y = Math.PI / 2
          g.rotation.x = 0
          m.rotation.x = 0
          g.rotation.z = 0
          g.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), 0.95 + off * 0.3)
          m.rotation.y = off
        } else {
          // ドア(-z壁)から +z 下向きへ
          g.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0), -0.95 - off * 0.3)
          m.rotation.y = off
        }
        m.renderOrder = 13
        g.add(m)
        this.group.add(g)
      }
    }
    addBeams(
      ROOM.width / 2 - 0.05,
      (WINDOW_RECT.y0 + WINDOW_RECT.y1) / 2 + 0.2,
      (WINDOW_RECT.z0 + WINDOW_RECT.z1) / 2,
      WINDOW_RECT.z1 - WINDOW_RECT.z0,
      2.6,
      'x'
    )
    addBeams(DOOR.hingeX + DOOR.width / 2, DOOR.height * 0.7, -ROOM.depth / 2 + 0.05, DOOR.width, 3.0, 'z')

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
      ((under ? 0.3 : 0.72) - this.hemiLight.intensity) * Math.min(1, 6 * dt)
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

    // 浅水時: 床の屈折光(水没カメラでは控えめに)
    this.floorCausticsMat.opacity =
      Math.min(0.3, lvl * 0.55) * (under ? 0.5 : 1) * Math.max(0, 1 - nearFull)
    if (this.floorCausticsMat.map) {
      this.floorCausticsMat.map.offset.set(time * 0.03, time * 0.017)
    }

    // 光芒は水没中のみ
    const beamOpacity = under ? Math.min(0.16, lvl * 0.1) : 0
    for (const m of this.beamMats) {
      m.uniforms.uOpacity.value +=
        (beamOpacity - (m.uniforms.uOpacity.value as number)) * Math.min(1, 4 * dt)
      m.uniforms.uTime.value = time
    }
  }
}
