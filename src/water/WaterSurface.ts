// 室内の上昇する水面。sin波 + ドアを波源とするリング波。
// 波の荒れは流入量に比例し、開け方の激しさが文字なしで伝わる。

import * as THREE from 'three'
import { ROOM, WATER } from '../sim/constants'
import { FloodSim } from '../sim/FloodSim'

export class WaterSurface {
  mesh: THREE.Mesh
  /** 部屋の外から見たときの水の側面(水槽方式)。外向き面のみ */
  sides = new THREE.Group()
  private mat: THREE.ShaderMaterial

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
        uDoorPos: { value: new THREE.Vector2(-0.3, -ROOM.depth / 2) },
        uSurfCol: { value: new THREE.Color(WATER.surfaceColor) },
        uDeepCol: { value: new THREE.Color(WATER.deepColor) },
        uSkyCol: { value: new THREE.Color(0xb8c4b2) },
        uLightDir: { value: new THREE.Vector3(0.35, 0.8, 0.45).normalize() },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uIntensity;
        uniform vec2 uDoorPos;
        varying vec3 vWorldPos;
        varying float vFoam;

        float waveH(vec2 p, float t, float inten){
          float h = 0.0;
          h += sin(p.x * 5.0 + t * 2.2) * 0.5;
          h += sin((p.x * 0.6 + p.y) * 7.3 - t * 2.9) * 0.32;
          h += sin((p.y - p.x * 0.3) * 11.0 + t * 4.1) * 0.18;
          h += sin((p.x + p.y) * 17.0 - t * 5.3) * 0.1;
          h *= (0.008 + 0.045 * inten);
          // ドアからのリング波
          float r = length(p - uDoorPos);
          h += sin(r * 14.0 - t * 8.0) * exp(-r * 1.1) * 0.07 * inten;
          return h;
        }

        void main(){
          vec3 pos = position;
          float h = waveH(pos.xz, uTime, uIntensity);
          pos.y += h;
          vFoam = clamp(h * 20.0 * uIntensity, 0.0, 1.0);
          vec4 wp = modelMatrix * vec4(pos, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uSurfCol;
        uniform vec3 uDeepCol;
        uniform vec3 uSkyCol;
        uniform vec3 uLightDir;
        uniform float uIntensity;
        varying vec3 vWorldPos;
        varying float vFoam;

        void main(){
          vec3 dx = dFdx(vWorldPos);
          vec3 dy = dFdy(vWorldPos);
          vec3 n = normalize(cross(dx, dy));
          if (n.y < 0.0) n = -n;
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fres = pow(1.0 - max(0.0, dot(viewDir, n)), 3.0);
          vec3 col = mix(uDeepCol, uSurfCol, 0.5 + 0.5 * n.y);
          col = mix(col, uSkyCol, fres * 0.75);
          // 光の反射
          vec3 halfv = normalize(uLightDir + viewDir);
          float spec = pow(max(0.0, dot(n, halfv)), 90.0);
          col += vec3(spec) * 0.6;
          // 荒れているときの泡
          col = mix(col, vec3(0.92, 0.95, 0.9), vFoam * 0.5);
          // カメラ至近(水面またぎ)でフェードしてちらつきを防ぐ
          float dCam = length(cameraPosition - vWorldPos);
          float alpha = (0.72 + fres * 0.2) * smoothstep(0.06, 0.3, dCam);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.renderOrder = 10
    this.mesh.visible = false

    // 側面(外向きの半透明面 4 枚)。壁は内向き面なので外から見たときだけ見える
    const sideMat = new THREE.MeshStandardMaterial({
      color: 0x3d5a44,
      transparent: true,
      opacity: 0.62,
      roughness: 0.3,
      metalness: 0.05,
      depthWrite: false,
    })
    const hw = ROOM.width / 2
    const hd = ROOM.depth / 2
    const mk = (w: number, px: number, pz: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 1), sideMat)
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
    // 流入が止まっても余韻を残す
    const cur = this.mat.uniforms.uIntensity.value as number
    const target = this.flood.intensity
    this.mat.uniforms.uIntensity.value = cur + (target - cur) * 0.03
  }
}
