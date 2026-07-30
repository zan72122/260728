// 常時表示はメニュー(≡)とリセット(⟲)の2アイコンのみ。
// リセットは 0.6 秒ホールドで発動(リング進捗)。メニューから品質切替とヘルプ。
// 文字は使わない。

export interface HudCallbacks {
  onReset: () => void
  onQualityToggle: () => boolean // 戻り値: 高品質かどうか
}

const BTN_STYLE = `
  width: 46px; height: 46px; border-radius: 14px;
  background: rgba(20, 28, 24, 0.42); backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border: 1px solid rgba(255,255,255,0.22);
  display: flex; align-items: center; justify-content: center;
  touch-action: none; position: relative; overflow: visible;
`

export class Hud {
  private menuOpen = false
  private menuCol: HTMLDivElement
  private holdTimer = 0
  private holding = false
  private ring: SVGCircleElement | null = null
  private helpOverlay: HTMLDivElement | null = null

  constructor(parent: HTMLElement, private cb: HudCallbacks) {
    const bar = document.createElement('div')
    bar.style.cssText = `
      position: fixed; top: calc(env(safe-area-inset-top, 0px) + 10px);
      right: calc(env(safe-area-inset-right, 0px) + 10px);
      display: flex; flex-direction: column; gap: 10px; z-index: 40;
    `
    parent.appendChild(bar)

    // リセット(ホールド)
    const reset = this.makeButton(this.resetIcon())
    reset.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      this.holding = true
      this.holdTimer = 0
      reset.setPointerCapture(e.pointerId)
    })
    const cancel = () => {
      this.holding = false
      this.holdTimer = 0
      this.updateRing(0)
    }
    reset.addEventListener('pointerup', cancel)
    reset.addEventListener('pointercancel', cancel)
    bar.appendChild(reset)

    // メニュー
    const menu = this.makeButton(this.menuIcon())
    menu.addEventListener('pointerdown', (e) => e.stopPropagation())
    menu.addEventListener('click', () => this.toggleMenu())
    bar.appendChild(menu)

    // 展開列
    this.menuCol = document.createElement('div')
    this.menuCol.style.cssText = `display: none; flex-direction: column; gap: 10px;`
    bar.appendChild(this.menuCol)

    const quality = this.makeButton(this.qualityIcon(true))
    quality.addEventListener('pointerdown', (e) => e.stopPropagation())
    quality.addEventListener('click', () => {
      const hi = this.cb.onQualityToggle()
      quality.innerHTML = ''
      quality.appendChild(this.qualityIcon(hi))
    })
    this.menuCol.appendChild(quality)

    const help = this.makeButton(this.helpIcon())
    help.addEventListener('pointerdown', (e) => e.stopPropagation())
    help.addEventListener('click', () => this.showHelp(parent))
    this.menuCol.appendChild(help)

    // 初回はヘルプを自動表示(テスト実行時は抑止)
    try {
      const testMode = new URLSearchParams(location.search).has('test')
      if (!testMode && !localStorage.getItem('flood-sim-helped')) {
        setTimeout(() => this.showHelp(parent), 700)
        localStorage.setItem('flood-sim-helped', '1')
      }
    } catch {
      /* private mode */
    }
  }

  private makeButton(icon: SVGElement): HTMLDivElement {
    const b = document.createElement('div')
    b.style.cssText = BTN_STYLE
    b.appendChild(icon)
    return b
  }

  private svg(vb: string, inner: string): SVGElement {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    s.setAttribute('viewBox', vb)
    s.setAttribute('width', '26')
    s.setAttribute('height', '26')
    s.innerHTML = inner
    return s
  }

  private menuIcon(): SVGElement {
    return this.svg(
      '0 0 24 24',
      `<g stroke="#fff" stroke-width="2.2" stroke-linecap="round">
        <line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>
      </g>`
    )
  }

  private resetIcon(): SVGElement {
    const s = this.svg(
      '0 0 24 24',
      `<path d="M4 12a8 8 0 1 0 2.4-5.7" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
       <path d="M6 2.5v4.2h4.2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
       <circle class="hold-ring" cx="12" cy="12" r="10.4" fill="none" stroke="#7fd4a8" stroke-width="2"
         stroke-dasharray="65.3" stroke-dashoffset="65.3" transform="rotate(-90 12 12)"/>`
    )
    this.ring = s.querySelector('.hold-ring')
    return s
  }

  private qualityIcon(hi: boolean): SVGElement {
    // 高品質: 塗り潰しダイヤ / 低品質: 輪郭のみ
    return this.svg(
      '0 0 24 24',
      `<path d="M12 3l7 9-7 9-7-9z" fill="${hi ? '#fff' : 'none'}" stroke="#fff" stroke-width="2"/>`
    )
  }

  private helpIcon(): SVGElement {
    return this.svg(
      '0 0 24 24',
      `<circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-width="2"/>
       <path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.7c-.8.4-1 1-1 1.8" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
       <circle cx="12" cy="17" r="1.2" fill="#fff"/>`
    )
  }

  private toggleMenu(): void {
    this.menuOpen = !this.menuOpen
    this.menuCol.style.display = this.menuOpen ? 'flex' : 'none'
  }

  private updateRing(frac: number): void {
    if (this.ring) this.ring.setAttribute('stroke-dashoffset', String(65.3 * (1 - frac)))
  }

  /** 毎フレーム呼ぶ(ホールド進捗) */
  update(dt: number): void {
    if (this.holding) {
      this.holdTimer += dt
      this.updateRing(Math.min(1, this.holdTimer / 0.6))
      if (this.holdTimer >= 0.6) {
        this.holding = false
        this.holdTimer = 0
        this.updateRing(0)
        this.cb.onReset()
      }
    }
  }

  /** 操作ヘルプ(ピクトグラムのみ) */
  private showHelp(parent: HTMLElement): void {
    if (this.helpOverlay) return
    const o = document.createElement('div')
    o.style.cssText = `
      position: fixed; inset: 0; z-index: 50; background: rgba(8, 14, 12, 0.72);
      display: flex; align-items: center; justify-content: center;
    `
    const c = document.createElement('canvas')
    const w = Math.min(window.innerWidth, 720)
    const h = Math.min(window.innerHeight, 460)
    c.width = w * 2
    c.height = h * 2
    c.style.width = `${w}px`
    c.style.height = `${h}px`
    const ctx = c.getContext('2d')!
    ctx.scale(2, 2)
    ctx.strokeStyle = '#eaf2ec'
    ctx.fillStyle = '#eaf2ec'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'

    const cx = w / 2
    // 1) ドアノブスワイプ(中央上): ドア + 手 + 弧矢印
    const dy = h * 0.24
    ctx.strokeRect(cx - 30, dy - 55, 60, 100)
    ctx.beginPath()
    ctx.arc(cx + 18, dy, 5, 0, Math.PI * 2)
    ctx.fill()
    // 弧矢印
    ctx.beginPath()
    ctx.arc(cx - 30, dy + 45, 85, -0.55, 0.35)
    ctx.stroke()
    const ax = cx - 30 + 85 * Math.cos(0.35)
    const ay = dy + 45 + 85 * Math.sin(0.35)
    ctx.beginPath()
    ctx.moveTo(ax - 10, ay - 8)
    ctx.lineTo(ax, ay)
    ctx.lineTo(ax - 2, ay - 13)
    ctx.stroke()
    // 手(丸+指)
    ctx.beginPath()
    ctx.arc(cx + 40, dy + 14, 9, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx + 40, dy + 5)
    ctx.lineTo(cx + 40, dy - 8)
    ctx.stroke()

    // 2) 左: ジョイスティック
    const jy = h * 0.72
    const jx = w * 0.25
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    ctx.arc(jx, jy, 34, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.arc(jx - 8, jy - 8, 15, 0, Math.PI * 2)
    ctx.fill()
    // 四方向矢印
    for (const [mx, my] of [
      [0, -52],
      [0, 52],
      [-52, 0],
      [52, 0],
    ]) {
      ctx.beginPath()
      ctx.moveTo(jx + mx * 0.7, jy + my * 0.7)
      ctx.lineTo(jx + mx, jy + my)
      ctx.stroke()
    }

    // 3) 右: カメラ回転(円弧の両矢印)
    const ry = h * 0.72
    const rx = w * 0.75
    ctx.beginPath()
    ctx.arc(rx, ry, 38, Math.PI * 0.15, Math.PI * 0.85)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(rx, ry, 38, Math.PI * 1.15, Math.PI * 1.85)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(rx, ry, 10, 0, Math.PI * 2)
    ctx.fill()

    o.appendChild(c)
    o.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      o.remove()
      this.helpOverlay = null
    })
    parent.appendChild(o)
    this.helpOverlay = o
  }
}
