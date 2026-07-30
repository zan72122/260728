// 窓の外の「完全水没」の表現: 濁水のゆらぎシェーダー面 + 漂う粒子。

import * as THREE from 'three'
import { ROOM } from '../sim/constants'
import { WINDOW_RECT } from './Room'
import { softCircleTexture } from '../gfx/textures'

export class Outside {
  group = new THREE.Group()
  private murk: THREE.ShaderMaterial
  private particles: THREE.Points
  private pPos: Float32Array
  private pSeed: Float32Array

  constructor() {
    const hw = ROOM.width / 2
    this.murk = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
        }
        void main(){
          vec2 p = vUv * 4.0;
          float n = noise(p + vec2(uTime*0.05, uTime*0.02));
          n += 0.5 * noise(p*2.0 - vec2(uTime*0.08, 0.0));
          n /= 1.5;
          // 上方はわずかに明るく(遠い水面からの微光)
          vec3 deep = vec3(0.10, 0.15, 0.11);
          vec3 lit  = vec3(0.22, 0.30, 0.22);
          vec3 col = mix(deep, lit, n * 0.6 + vUv.y * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(4, 3.5), this.murk)
    plane.position.set(hw + 0.6, (WINDOW_RECT.y0 + WINDOW_RECT.y1) / 2, (WINDOW_RECT.z0 + WINDOW_RECT.z1) / 2)
    plane.rotation.y = -Math.PI / 2
    this.group.add(plane)

    // ドアの外も濁水(開けたとき黒い虚空にならないように)
    const doorMurk = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 3.2), this.murk)
    doorMurk.position.set(-0.3, 1.4, -ROOM.depth / 2 - 0.55)
    this.group.add(doorMurk)

    // 漂う粒子(窓とシェーダー面の間)
    const N = 60
    this.pPos = new Float32Array(N * 3)
    this.pSeed = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      this.pPos[i * 3] = hw + 0.1 + Math.random() * 0.45
      this.pPos[i * 3 + 1] = WINDOW_RECT.y0 - 0.3 + Math.random() * 1.6
      this.pPos[i * 3 + 2] = WINDOW_RECT.z0 - 0.5 + Math.random() * 2.3
      this.pSeed[i] = Math.random() * 100
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3))
    this.particles = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        map: softCircleTexture(),
        color: 0x9fb59a,
        size: 0.035,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        sizeAttenuation: true,
      })
    )
    this.group.add(this.particles)
  }

  update(time: number): void {
    this.murk.uniforms.uTime.value = time
    const pos = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < this.pSeed.length; i++) {
      const s = this.pSeed[i]
      pos.array[i * 3 + 1] += Math.sin(time * 0.6 + s) * 0.0004 + 0.0002
      pos.array[i * 3 + 2] += Math.cos(time * 0.4 + s) * 0.0004
      if ((pos.array[i * 3 + 1] as number) > WINDOW_RECT.y1 + 0.5) pos.array[i * 3 + 1] = WINDOW_RECT.y0 - 0.4
    }
    pos.needsUpdate = true
  }
}
