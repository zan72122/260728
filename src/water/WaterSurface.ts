// 室内の上昇する水面。sin波 + ドアを波源とするリング波。
// フラグメントで波の解析勾配から per-pixel 法線を計算し、
// 壁際フォーム・水深による色の濃さ・2ローブのスペキュラを持つ。

import * as THREE from 'three'
import { ROOM, WATER } from '../sim/constants'
import { FloodSim } from '../sim/FloodSim'

// 頂点・フラグメントで共有する波形定義
const WAVE_GLSL = `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec2 uDoorPos;

  float waveAmp(float inten){ return 0.009 + 0.05 * inten; }

  float waveH(vec2 p, float t, float inten){
    float h = 0.0;
    h += sin(p.x * 5.0 + t * 2.2) * 0.5;
    h += sin((p.x * 0.6 + p.y) * 7.3 - t * 2.9) * 0.32;
    h += sin((p.y - p.x * 0.3) * 11.0 + t * 4.1) * 0.18;
    h += sin((p.x + p.y) * 17.0 - t * 5.3) * 0.1;
    h *= waveAmp(inten);
    float r = length(p - uDoorPos);
    h += sin(r * 14.0 - t * 8.0) * exp(-r * 1.1) * 0.07 * inten;
    return h;
  }

  vec2 waveGrad(vec2 p, float t, float inten){
    vec2 g = vec2(0.0);
    g += vec2(cos(p.x * 5.0 + t * 2.2) * 5.0 * 0.5, 0.0);
    float c2 = cos((p.x * 0.6 + p.y) * 7.3 - t * 2.9) * 0.32 * 7.3;
    g += vec2(c2 * 0.6, c2);
    float c3 = cos((p.y - p.x * 0.3) * 11.0 + t * 4.1) * 0.18 * 11.0;
    g += vec2(-c3 * 0.3, c3);
    float c4 = cos((p.x + p.y) * 17.0 - t * 5.3) * 0.1 * 17.0;
    g += vec2(c4, c4);
    g *= waveAmp(inten);
    // リング波
    vec2 d = p - uDoorPos;
    float r = max(length(d), 1e-4);
    float ph = r * 14.0 - t * 8.0;
    float dHdr = (cos(ph) * 14.0 - sin(ph) * 1.1) * exp(-r * 1.1) * 0.07 * inten;
    g += (d / r) * dHdr;
    return g;
  }
`

export class WaterSurface {
  mesh: THREE.Mesh
  /** 部屋の外から見たときの水の側面(水槽方式)。外向き面のみ */
  sides = new THREE.Group()
  private mat: THREE.ShaderMaterial
  private sideMat: THREE.ShaderMaterial

  constructor(private flood: FloodSim) {
    const geo = new THREE.PlaneGeometry(ROOM.width - 0.02, ROOM.depth - 0.02, 72, 56)
    geo.rotateX(-Math.PI / 2)
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uLevel: { value: 0 },
        uDoorPos: { value: new THREE.Vector2(-0.3, -ROOM.depth / 2) },
        uHalf: { value: new THREE.Vector2(ROOM.width / 2, ROOM.depth / 2) },
        uSurfCol: { value: new THREE.Color(WATER.surfaceColor) },
        uDeepCol: { value: new THREE.Color(WATER.deepColor) },
        uSkyCol: { value: new THREE.Color(0xb8c4b2) },
        uLightDir: { value: new THREE.Vector3(0.35, 0.8, 0.45).normalize() },
      },
      vertexShader: `
        ${WAVE_GLSL}
        varying vec3 vWorldPos;
        void main(){
          vec3 pos = position;
          pos.y += waveH(pos.xz, uTime, uIntensity);
          vec4 wp = modelMatrix * vec4(pos, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        ${WAVE_GLSL}
        uniform vec3 uSurfCol;
        uniform vec3 uDeepCol;
        uniform vec3 uSkyCol;
        uniform vec3 uLightDir;
        uniform vec2 uHalf;
        uniform float uLevel;
        varying vec3 vWorldPos;

        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
        }

        void main(){
          vec2 p = vWorldPos.xz;
          // 解析勾配による法線(メッシュ解像度に依存しない)
          vec2 g = waveGrad(p, uTime, uIntensity);
          vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fres = pow(1.0 - max(0.0, dot(viewDir, n)), 3.0);

          // 水深で濃くなる基調色
          float depthT = smoothstep(0.1, 1.6, uLevel);
          vec3 base = mix(uSurfCol, uDeepCol, depthT * 0.7);
          vec3 col = mix(base * 0.85, base, 0.5 + 0.5 * n.y);
          col = mix(col, uSkyCol, fres * 0.45);

          // 2ローブのスペキュラ
          vec3 halfv = normalize(uLightDir + viewDir);
          float ndh = max(0.0, dot(n, halfv));
          col += vec3(1.0, 0.98, 0.92) * (pow(ndh, 240.0) * 0.9 + pow(ndh, 24.0) * 0.18);

          // 壁際のフォーム
          float edge = min(uHalf.x - abs(p.x), uHalf.y - abs(p.y));
          float foamEdge = smoothstep(0.13, 0.02, edge);
          foamEdge *= 0.55 + 0.45 * noise(p * 14.0 + vec2(uTime * 1.3, -uTime * 0.9));
          // 波の荒れによるフォーム
          float h = waveH(p, uTime, uIntensity);
          float foamWave = clamp(h * 9.0 * uIntensity, 0.0, 1.0);
          foamWave *= smoothstep(0.35, 0.85, noise(p * 22.0 - vec2(0.0, uTime * 2.2)));
          float foam = clamp(foamEdge + foamWave, 0.0, 1.0);
          col = mix(col, vec3(0.93, 0.96, 0.92), foam * 0.55);

          // カメラ至近(水面またぎ)でフェードしてちらつきを防ぐ
          float dCam = length(cameraPosition - vWorldPos);
          float alpha = (mix(0.58, 0.84, depthT) + fres * 0.07 + foam * 0.08) * smoothstep(0.06, 0.3, dCam);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.renderOrder = 10
    this.mesh.visible = false

    // 側面(外向きの半透明面 4 枚)。壁は内向き面なので外から見たときだけ見える
    this.sideMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uLevel: { value: 0 },
        uTime: { value: 0 },
        uSurfCol: { value: new THREE.Color(0x53705c) },
        uDeepCol: { value: new THREE.Color(0x1e2f24) },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform float uLevel;
        uniform float uTime;
        uniform vec3 uSurfCol;
        uniform vec3 uDeepCol;
        varying vec3 vWorldPos;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
        }
        void main(){
          float t = clamp(vWorldPos.y / max(uLevel, 0.01), 0.0, 1.0);
          vec3 col = mix(uDeepCol, uSurfCol, t * t);
          // 浮遊物のゆらぎ
          float m = noise(vec2(vWorldPos.x + vWorldPos.z, vWorldPos.y * 2.0) * 6.0 + vec2(uTime * 0.15, 0.0));
          col += vec3(0.05, 0.07, 0.05) * m;
          // 水面直下の明るい帯
          float band = smoothstep(0.06, 0.0, uLevel - vWorldPos.y);
          col += vec3(0.22, 0.26, 0.22) * band;
          gl_FragColor = vec4(col, 0.68);
        }
      `,
    })
    const hw = ROOM.width / 2
    const hd = ROOM.depth / 2
    const mk = (w: number, px: number, pz: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 1), this.sideMat)
      m.position.set(px, 0.5, pz)
      m.rotation.y = ry
      m.renderOrder = 8
      this.sides.add(m)
    }
    mk(ROOM.width, 0, hd - 0.005, 0)
    mk(ROOM.width, 0, -hd + 0.005, Math.PI)
    mk(ROOM.depth, -hw + 0.005, 0, -Math.PI / 2)
    mk(ROOM.depth, hw - 0.005, 0, Math.PI / 2)
    this.sides.visible = false
  }

  /** 光方向をシーンの DirectionalLight と揃える */
  setLightDir(dir: THREE.Vector3): void {
    ;(this.mat.uniforms.uLightDir.value as THREE.Vector3).copy(dir).normalize()
  }

  update(time: number): void {
    const lvl = this.flood.waterLevel
    this.mesh.visible = lvl > 0.008
    this.mesh.position.y = lvl
    this.sides.visible = this.mesh.visible
    for (const s of this.sides.children) {
      s.scale.y = Math.max(0.001, lvl)
      s.position.y = lvl / 2
    }
    this.mat.uniforms.uTime.value = time
    this.mat.uniforms.uLevel.value = lvl
    this.sideMat.uniforms.uLevel.value = lvl
    this.sideMat.uniforms.uTime.value = time
    // 流入が止まっても余韻を残す
    const cur = this.mat.uniforms.uIntensity.value as number
    const target = this.flood.intensity
    this.mat.uniforms.uIntensity.value = cur + (target - cur) * 0.03
  }
}
