// Pointer Events を canvas 1枚で一元受信し、pointerdown 時に役割を確定する。
// 役割: ドアスワイプ(最優先) / 左半分=ジョイスティック / 右半分=カメラ /
// カメラ2本目=ピンチズーム。SWIM 中は右ドラッグの縦成分を潜行/浮上に配分。

import { CameraRig } from './CameraRig'
import { Joystick } from './Joystick'
import { DoorSwipe } from './DoorSwipe'

type Role = 'door' | 'joystick' | 'camera'

interface Tracked {
  role: Role
  x: number
  y: number
}

export class GestureRouter {
  /** SWIM/AIR_POCKET 中 true(カメラ縦ドラッグ→潜行/浮上) */
  swimMode = false
  /** 泳ぎの上下入力 -1..1 */
  swimVertical = 0
  private pointers = new Map<number, Tracked>()
  private pinchDist = 0

  constructor(
    private el: HTMLCanvasElement,
    private rig: CameraRig,
    private joystick: Joystick,
    private doorSwipe: DoorSwipe
  ) {
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerup', this.onUp)
    el.addEventListener('pointercancel', this.onUp)
    // Safari のページピンチ抑止
    document.addEventListener('gesturestart', (e) => e.preventDefault())
    el.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private ndc(x: number, y: number): [number, number] {
    const r = this.el.getBoundingClientRect()
    return [((x - r.left) / r.width) * 2 - 1, -(((y - r.top) / r.height) * 2 - 1)]
  }

  private onDown = (e: PointerEvent): void => {
    this.el.setPointerCapture(e.pointerId)
    const [nx, ny] = this.ndc(e.clientX, e.clientY)
    let role: Role
    if (!this.doorSwipe.active && this.doorSwipe.hitTest(nx, ny)) {
      role = 'door'
      this.doorSwipe.start(nx, ny)
    } else if (e.clientX < window.innerWidth / 2 && !this.joystick.active) {
      role = 'joystick'
      this.joystick.start(e.clientX, e.clientY)
    } else {
      role = 'camera'
      const cams = this.cameraPointers()
      if (cams.length === 1) {
        // ピンチ開始
        this.pinchDist = Math.hypot(cams[0].x - e.clientX, cams[0].y - e.clientY)
      }
    }
    this.pointers.set(e.pointerId, { role, x: e.clientX, y: e.clientY })
  }

  private cameraPointers(): Tracked[] {
    return [...this.pointers.values()].filter((p) => p.role === 'camera')
  }

  private onMove = (e: PointerEvent): void => {
    const t = this.pointers.get(e.pointerId)
    if (!t) return
    const dx = e.clientX - t.x
    const dy = e.clientY - t.y
    t.x = e.clientX
    t.y = e.clientY
    if (t.role === 'door') {
      const [nx, ny] = this.ndc(e.clientX, e.clientY)
      this.doorSwipe.moveTo(nx, ny)
    } else if (t.role === 'joystick') {
      this.joystick.move(e.clientX, e.clientY)
    } else {
      const cams = this.cameraPointers()
      if (cams.length >= 2) {
        // ピンチズーム
        const d = Math.hypot(cams[0].x - cams[1].x, cams[0].y - cams[1].y)
        if (this.pinchDist > 0) this.rig.zoomBy(d / this.pinchDist)
        this.pinchDist = d
      } else {
        const w = Math.min(window.innerWidth, window.innerHeight)
        if (this.swimMode) {
          // 縦成分は潜行/浮上、横成分はカメラ回転
          this.swimVertical = Math.max(-1, Math.min(1, this.swimVertical - (dy / w) * 6))
          this.rig.rotateBy(dx / w, 0)
        } else {
          this.rig.rotateBy(dx / w, dy / w)
        }
      }
    }
  }

  private onUp = (e: PointerEvent): void => {
    const t = this.pointers.get(e.pointerId)
    this.pointers.delete(e.pointerId)
    if (!t) return
    if (t.role === 'door') this.doorSwipe.end()
    else if (t.role === 'joystick') this.joystick.end()
    else {
      this.swimVertical = 0
      const cams = this.cameraPointers()
      this.pinchDist = cams.length >= 2 ? Math.hypot(cams[0].x - cams[1].x, cams[0].y - cams[1].y) : 0
    }
  }

  /** 泳いでいないときに縦入力が残らないように */
  update(): void {
    if (!this.swimMode) this.swimVertical = 0
    else {
      // ドラッグしていないときは減衰
      const cams = this.cameraPointers()
      if (cams.length === 0) this.swimVertical *= 0.85
    }
  }
}
