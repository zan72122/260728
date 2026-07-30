// 室内水位・流量の純数値モデル。Three/Rapier に依存しない。
// ドア角 θ を毎フレーム受け取り、オリフィス流で室内水位を積分する。

import { DOOR, FLOOR_AREA, ROOM, WATER } from './constants'

export class FloodSim {
  /** 室内水位 [m](床基準) */
  waterLevel = 0
  /** 現在の流入量 [m^3/s] */
  inflowRate = 0
  /** 開口部の流速 [m/s] */
  jetVelocity = 0
  /** 現在のドア開口角 [rad](外部から毎フレーム設定) */
  doorAngle = 0
  /** これまでの最高水位(壁の濡れ線用) */
  maxLevel = 0
  /** 経過時間 */
  time = 0

  get ceilingLimit(): number {
    return ROOM.height - WATER.ceilingGap
  }

  /** 開口ギャップ幅 [m](ドア自由端と枠の隙間の弦長) */
  get gapWidth(): number {
    const th = this.doorAngle
    if (th < DOOR.sealAngle) return 0
    return Math.min(DOOR.width, 2 * DOOR.width * Math.sin(th / 2))
  }

  step(dt: number): void {
    this.time += dt
    const gap = this.gapWidth
    if (gap <= 0) {
      this.inflowRate = 0
      this.jetVelocity = 0
      return
    }
    const dh = Math.max(0, WATER.headEff - this.waterLevel)
    const v = Math.sqrt(2 * WATER.g * dh)
    // 屋外は完全水没なのでドア全高が開口。ただし室内水位が開口を覆うほど
    // 上がると実効開口は減らないが流速は水頭差で自然に落ちる。
    let area = gap * DOOR.height
    let q = WATER.Cd * area * v
    // 天井空気層: 逃げ場を失った空気の圧縮を模して漸減 → ceilingLimit で停止
    const room = this.ceilingLimit - this.waterLevel
    if (room < WATER.airCompressStart) {
      q *= Math.max(0, room / WATER.airCompressStart)
    }
    this.jetVelocity = v
    this.inflowRate = q
    this.waterLevel = Math.min(this.ceilingLimit, this.waterLevel + (q / FLOOR_AREA) * dt)
    if (this.waterLevel > this.maxLevel) this.maxLevel = this.waterLevel
  }

  /** 正規化した「浸水の激しさ」0..1(波・パーティクル・音の共通入力) */
  get intensity(): number {
    return Math.min(1, this.inflowRate / 2.5)
  }

  reset(): void {
    this.waterLevel = 0
    this.inflowRate = 0
    this.jetVelocity = 0
    this.doorAngle = 0
    this.maxLevel = 0
    this.time = 0
  }
}
