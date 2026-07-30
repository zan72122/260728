// タッチ位置に出現する動的バーチャルジョイスティック(DOM 描画)。

export class Joystick {
  /** 正規化済み入力 (-1..1)。x=右, y=上 */
  value = { x: 0, y: 0 }
  active = false
  private base: HTMLDivElement
  private knob: HTMLDivElement
  private cx = 0
  private cy = 0
  private readonly R = 56

  constructor(parent: HTMLElement) {
    this.base = document.createElement('div')
    this.base.style.cssText = `
      position: fixed; width: ${this.R * 2}px; height: ${this.R * 2}px;
      border-radius: 50%; border: 2px solid rgba(255,255,255,0.45);
      background: rgba(255,255,255,0.08); backdrop-filter: blur(2px);
      transform: translate(-50%, -50%); pointer-events: none; display: none; z-index: 30;
    `
    this.knob = document.createElement('div')
    this.knob.style.cssText = `
      position: absolute; width: 52px; height: 52px; border-radius: 50%;
      background: rgba(255,255,255,0.55); left: 50%; top: 50%;
      transform: translate(-50%, -50%); box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    `
    this.base.appendChild(this.knob)
    parent.appendChild(this.base)
  }

  start(x: number, y: number): void {
    this.active = true
    this.cx = x
    this.cy = y
    this.base.style.display = 'block'
    this.base.style.left = `${x}px`
    this.base.style.top = `${y}px`
    this.move(x, y)
  }

  move(x: number, y: number): void {
    if (!this.active) return
    let dx = x - this.cx
    let dy = y - this.cy
    const len = Math.hypot(dx, dy)
    if (len > this.R) {
      dx = (dx / len) * this.R
      dy = (dy / len) * this.R
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
    this.value.x = dx / this.R
    this.value.y = -dy / this.R
  }

  end(): void {
    this.active = false
    this.value.x = 0
    this.value.y = 0
    this.base.style.display = 'none'
  }
}
