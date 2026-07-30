// ドア開口からの流速場(解析的モデル)。
// ジェット中心線: 開口ギャップ中点から、壁法線とドア法線の中間方向。
// 距離・横方向・高さで減衰する。

import * as THREE from 'three'
import { FloodSim } from '../sim/FloodSim'
import { DOOR, ROOM } from '../sim/constants'

export class FlowField {
  private origin = new THREE.Vector3()
  private dir = new THREE.Vector3(0, 0, 1)
  private tmp = new THREE.Vector3()

  constructor(private flood: FloodSim) {}

  updateGeometry(): void {
    const th = this.flood.doorAngle
    const hd = ROOM.depth / 2
    const w = DOOR.width
    // ドア自由端
    const fx = DOOR.hingeX + w * Math.cos(th)
    const fz = -hd + w * Math.sin(th)
    // 開口の反対側の枠
    const jx = DOOR.hingeX + w
    const jz = -hd
    this.origin.set((fx + jx) / 2, 0, (fz + jz) / 2)
    this.dir.set(-Math.sin(th) * 0.5, 0, (1 + Math.cos(th)) * 0.5).normalize()
  }

  /** 点 p における流速 [m/s] を out に書き込む */
  velocityAt(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const v0 = this.flood.jetVelocity
    const gap = this.flood.gapWidth
    if (v0 <= 0.01 || gap <= 0) return out.set(0, 0, 0)
    // 水面より上には流れなし
    if (p.y > this.flood.waterLevel + 0.25) return out.set(0, 0, 0)
    this.tmp.set(p.x - this.origin.x, 0, p.z - this.origin.z)
    const s = this.tmp.dot(this.dir) // 軸方向距離
    if (s < -0.2) return out.set(0, 0, 0)
    // 横方向距離
    const lateral = Math.hypot(
      this.tmp.x - this.dir.x * s,
      this.tmp.z - this.dir.z * s
    )
    const spread = 0.35 + 0.55 * Math.max(0, s) + gap
    const lat = Math.exp(-(lateral * lateral) / (2 * spread * spread))
    const axial = Math.min(1, 1.1 / (Math.max(0, s) + 1.1))
    // 開口高さの範囲(ほぼ全高から噴くが、水面近傍が最も強い)
    const hFade = p.y < DOOR.height ? 1 : Math.max(0, 1 - (p.y - DOOR.height) / 0.5)
    const mag = v0 * lat * axial * hFade * Math.min(1, gap / 0.25 + 0.35)
    return out.set(this.dir.x * mag, 0, this.dir.z * mag)
  }
}
