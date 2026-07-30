// WebGLRenderer の生成と iOS Safari 向け設定(DPRキャップ・リサイズ・
// コンテキストロスト対応)。

import * as THREE from 'three'

export class Renderer {
  renderer: THREE.WebGLRenderer
  canvas: HTMLCanvasElement
  dprCap = 2
  onResize: ((w: number, h: number) => void) | null = null
  onContextRestored: (() => void) | null = null

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'scene'
    parent.appendChild(this.canvas)
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap)
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: dpr < 2,
      powerPreference: 'high-performance',
      stencil: false,
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.applySize()

    const doResize = () => requestAnimationFrame(() => this.applySize())
    window.addEventListener('resize', doResize)
    window.visualViewport?.addEventListener('resize', doResize)
    window.addEventListener('orientationchange', doResize)

    this.canvas.addEventListener('webglcontextlost', (e) => e.preventDefault())
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.applySize()
      this.onContextRestored?.()
    })
  }

  setQuality(hi: boolean): void {
    this.dprCap = hi ? 2 : 1.35
    this.applySize()
  }

  private applySize(): void {
    const w = window.visualViewport?.width ?? window.innerWidth
    const h = window.visualViewport?.height ?? window.innerHeight
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.dprCap))
    this.renderer.setSize(w, h)
    this.onResize?.(w, h)
  }
}
