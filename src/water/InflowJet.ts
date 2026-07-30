// ドア開口からの流入の見た目: 白濁パーティクル + 水面/床を這う泡のファン。

import * as THREE from 'three'
import { DOOR, ROOM } from '../sim/constants'
import { FloodSim } from '../sim/FloodSim'
import { softCircleTexture } from '../gfx/textures'

const MAX_P = 1400

export class InflowJet {
  group = new THREE.Group()
  private points: THREE.Points
  private pos: Float32Array
  private vel: Float32Array
  private life: Float32Array
  private alpha: Float32Array
  private size: Float32Array
  private alive = 0
  private spawnAcc = 0
  private fan: THREE.Mesh
  private fanMat: THREE.ShaderMaterial
  private mist: THREE.Points
  private mistMat: THREE.PointsMaterial
  private mistSeed: Float32Array

  constructor(private flood: FloodSim) {
    this.pos = new Float32Array(MAX_P * 3)
    this.vel = new Float32Array(MAX_P * 3)
    this.life = new Float32Array(MAX_P)
    this.alpha = new Float32Array(MAX_P)
    this.size = new Float32Array(MAX_P)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTex: { value: softCircleTexture() } },
      vertexShader: `
        attribute float aAlpha;
        attribute float aSize;
        varying float vAlpha;
        void main(){
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * 240.0 / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTex;
        varying float vAlpha;
        void main(){
          vec4 t = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(0.88, 0.93, 0.9, t.a * vAlpha);
        }
      `,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 12
    this.group.add(this.points)

    // 床/水面を這う泡のファン
    const fanGeo = new THREE.PlaneGeometry(1, 1, 24, 12)
    fanGeo.rotateX(-Math.PI / 2)
    fanGeo.translate(0, 0, 0.5) // 原点=ドア側の辺
    this.fanMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uStrength: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uStrength;
        void main(){
          vUv = uv;
          vec3 p = position;
          // 扇形に広げる
          float t = p.z; // 0..1 (奥行き)
          p.x *= (0.35 + t * 1.6);
          p.y += sin(t * 18.0 - uTime * 9.0) * 0.02 * uStrength * t;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uStrength;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
        }
        void main(){
          float t = vUv.y;
          float streaks = noise(vec2(vUv.x * 9.0, t * 5.0 - uTime * 2.6));
          streaks += 0.6 * noise(vec2(vUv.x * 22.0, t * 12.0 - uTime * 5.0));
          float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
          float fade = (1.0 - t) * edge;
          float a = clamp(streaks * 0.75, 0.0, 1.0) * fade * uStrength * 0.85;
          gl_FragColor = vec4(0.9, 0.94, 0.92, a);
        }
      `,
    })
    this.fan = new THREE.Mesh(fanGeo, this.fanMat)
    this.fan.renderOrder = 11
    this.fan.visible = false
    this.group.add(this.fan)

    // ドア開口のミスト(飛沫の霧)
    const MIST_N = 14
    this.mistSeed = new Float32Array(MIST_N)
    const mistPos = new Float32Array(MIST_N * 3)
    for (let i = 0; i < MIST_N; i++) this.mistSeed[i] = Math.random()
    const mistGeo = new THREE.BufferGeometry()
    mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3).setUsage(THREE.DynamicDrawUsage))
    this.mistMat = new THREE.PointsMaterial({
      map: softCircleTexture(),
      color: 0xd8e4dc,
      size: 0.34,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    this.mist = new THREE.Points(mistGeo, this.mistMat)
    this.mist.frustumCulled = false
    this.mist.renderOrder = 12
    this.group.add(this.mist)
  }

  update(dt: number, time: number): void {
    const f = this.flood
    const inten = f.intensity
    const jetV = f.jetVelocity
    const gap = f.gapWidth

    // ---- ファン(床/水面の白波) ----
    if (inten > 0.02 && gap > 0.01) {
      this.fan.visible = true
      const th = f.doorAngle
      const hd = ROOM.depth / 2
      const fx = DOOR.hingeX + DOOR.width * Math.cos(th)
      const fz = -hd + DOOR.width * Math.sin(th)
      const ox = (fx + DOOR.hingeX + DOOR.width) / 2
      const oz = (fz + -hd) / 2
      this.fan.position.set(ox, f.waterLevel + 0.015, oz + 0.02)
      const dir = new THREE.Vector2(-Math.sin(th) * 0.5, (1 + Math.cos(th)) * 0.5).normalize()
      this.fan.rotation.y = Math.atan2(dir.x, dir.y)
      const len = 0.6 + inten * 2.6
      this.fan.scale.set(Math.max(0.25, gap * 1.6), 1, len)
      this.fanMat.uniforms.uTime.value = time
      this.fanMat.uniforms.uStrength.value = Math.min(1, inten * 1.4)
    } else {
      this.fan.visible = false
    }

    // ---- パーティクル ----
    // 湧き: 流入量に比例
    this.spawnAcc += dt * Math.min(900, f.inflowRate * 260 + (inten > 0 ? 30 : 0))
    let toSpawn = Math.floor(this.spawnAcc)
    this.spawnAcc -= toSpawn
    const th = f.doorAngle
    const hd = ROOM.depth / 2
    const dirx = -Math.sin(th) * 0.5
    const dirz = (1 + Math.cos(th)) * 0.5
    const dl = Math.hypot(dirx, dirz)
    const dx = dirx / dl
    const dz = dirz / dl
    while (toSpawn-- > 0 && this.alive < MAX_P) {
      const i = this.alive++
      // 開口の帯からランダムに湧く
      const s = Math.random()
      const px = DOOR.hingeX + DOOR.width * Math.cos(th) * s + (DOOR.width * (1 - s)) * (1 - Math.random() * 0.3)
      const pz = -hd + DOOR.width * Math.sin(th) * s
      const py = f.waterLevel + Math.random() * Math.max(0.15, (DOOR.height - f.waterLevel) * 0.55)
      const v = jetV * (0.45 + Math.random() * 0.5)
      this.pos[i * 3] = px + dx * 0.05
      this.pos[i * 3 + 1] = py
      this.pos[i * 3 + 2] = pz + dz * 0.05
      this.vel[i * 3] = dx * v + (Math.random() - 0.5) * v * 0.35
      this.vel[i * 3 + 1] = -0.3 - Math.random() * 0.6
      this.vel[i * 3 + 2] = dz * v + (Math.random() - 0.5) * v * 0.35
      this.life[i] = 0.8 + Math.random() * 0.8
      this.size[i] = 0.03 + Math.random() * 0.05
      this.alpha[i] = 0.55
    }
    // ミスト(開口付近の霧)
    this.mistMat.opacity = Math.min(0.14, inten * 0.2)
    if (inten > 0.02) {
      const mp = this.mist.geometry.getAttribute('position') as THREE.BufferAttribute
      const ox = DOOR.hingeX + DOOR.width * 0.5 * Math.cos(th) + DOOR.width * 0.5
      const oz = -hd + DOOR.width * 0.5 * Math.sin(th) * 0.5
      for (let i = 0; i < this.mistSeed.length; i++) {
        const s = this.mistSeed[i]
        const drift = (time * (0.2 + s * 0.3) + s * 7) % 1
        mp.setXYZ(
          i,
          ox / 2 + dx * drift * 1.4 + (s - 0.5) * 0.7,
          f.waterLevel + 0.15 + s * Math.max(0.3, DOOR.height - f.waterLevel) * 0.5,
          oz + dz * drift * 1.4 + (Math.floor(s * 10) % 2 === 0 ? 0.2 : -0.1) * s
        )
      }
      mp.needsUpdate = true
    }

    // 更新
    const lvl = f.waterLevel
    let splashBudget = 26
    for (let i = 0; i < this.alive; i++) {
      this.life[i] -= dt
      if (this.life[i] <= 0) {
        // 末尾と入れ替えて詰める
        const j = --this.alive
        for (let k = 0; k < 3; k++) {
          this.pos[i * 3 + k] = this.pos[j * 3 + k]
          this.vel[i * 3 + k] = this.vel[j * 3 + k]
        }
        this.life[i] = this.life[j]
        this.size[i] = this.size[j]
        this.alpha[i] = this.alpha[j]
        i--
        continue
      }
      let vy = this.vel[i * 3 + 1]
      const wasAbove = this.pos[i * 3 + 1] >= lvl
      const under = this.pos[i * 3 + 1] < lvl
      // 着水の瞬間にスプラッシュを上げる
      if (
        wasAbove &&
        this.pos[i * 3 + 1] + vy * dt < lvl &&
        vy < -1.2 &&
        splashBudget > 0 &&
        this.alive < MAX_P - 2
      ) {
        splashBudget--
        for (let k = 0; k < 2; k++) {
          const j = this.alive++
          this.pos[j * 3] = this.pos[i * 3] + (Math.random() - 0.5) * 0.06
          this.pos[j * 3 + 1] = lvl + 0.02
          this.pos[j * 3 + 2] = this.pos[i * 3 + 2] + (Math.random() - 0.5) * 0.06
          this.vel[j * 3] = this.vel[i * 3] * 0.25 + (Math.random() - 0.5) * 0.5
          this.vel[j * 3 + 1] = 0.9 + Math.random() * 1.1
          this.vel[j * 3 + 2] = this.vel[i * 3 + 2] * 0.25 + (Math.random() - 0.5) * 0.5
          this.life[j] = 0.3 + Math.random() * 0.2
          this.size[j] = 0.06 + Math.random() * 0.05
          this.alpha[j] = 0.65
        }
      }
      if (under) {
        // 水面下では泡として浮上・減速
        this.vel[i * 3] *= 1 - Math.min(1, 3 * dt)
        this.vel[i * 3 + 2] *= 1 - Math.min(1, 3 * dt)
        vy = vy * (1 - Math.min(1, 4 * dt)) + 1.6 * dt
        if (this.pos[i * 3 + 1] > lvl - 0.03) {
          this.pos[i * 3 + 1] = lvl + 0.005
          vy = 0
        }
        this.alpha[i] = Math.min(this.alpha[i], this.life[i] * 0.5)
      } else {
        vy -= 6.5 * dt
      }
      this.vel[i * 3 + 1] = vy
      this.pos[i * 3] += this.vel[i * 3] * dt
      this.pos[i * 3 + 1] += vy * dt
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt
      // 床・壁で止まる
      if (this.pos[i * 3 + 1] < 0.01) this.pos[i * 3 + 1] = 0.01
    }
    const geo = this.points.geometry
    ;(geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true
    ;(geo.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true
    geo.setDrawRange(0, this.alive)
  }

  reset(): void {
    this.alive = 0
    this.spawnAcc = 0
    this.points.geometry.setDrawRange(0, 0)
    this.fan.visible = false
    this.mistMat.opacity = 0
  }
}
