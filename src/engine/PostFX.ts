// ポストプロセスパイプライン: N8AO(接地陰影) + Bloom + Vignette + ACES。
// three はレンダーターゲット描画時に renderer 側のトーンマッピングを
// スキップするため、最終 EffectPass の ToneMappingEffect で ACES を適用する。
// 構築に失敗した環境では supported=false になり直接描画へフォールバックする。

import * as THREE from 'three'
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  VignetteEffect,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing'
import { N8AOPostPass } from 'n8ao'

export class PostFX {
  supported = false
  private enabled = true
  private composer: EffectComposer | null = null

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera
  ) {
    this.build()
  }

  private build(): void {
    try {
      if (!this.renderer.capabilities.isWebGL2) {
        this.supported = false
        return
      }
      const dpr = this.renderer.getPixelRatio()
      const composer = new EffectComposer(this.renderer, {
        frameBufferType: THREE.HalfFloatType,
        multisampling: dpr < 2 ? 4 : 0,
      })
      composer.addPass(new RenderPass(this.scene, this.camera))

      const size = new THREE.Vector2()
      this.renderer.getSize(size)
      const n8ao = new N8AOPostPass(this.scene, this.camera, size.x, size.y)
      n8ao.configuration.halfRes = true
      n8ao.configuration.aoRadius = 0.35
      n8ao.configuration.intensity = 2.6
      n8ao.configuration.distanceFalloff = 0.4
      n8ao.setQualityMode('Performance')
      composer.addPass(n8ao)

      const bloom = new BloomEffect({
        mipmapBlur: true,
        luminanceThreshold: 0.72,
        intensity: 0.3,
      })
      const vignette = new VignetteEffect({ darkness: 0.34, offset: 0.28 })
      const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })
      composer.addPass(new EffectPass(this.camera, bloom, vignette, tone))

      this.composer = composer
      this.supported = true
    } catch (e) {
      console.warn('PostFX unavailable, falling back to direct rendering', e)
      this.supported = false
      this.composer = null
    }
  }

  get active(): boolean {
    return this.supported && this.enabled
  }

  setEnabled(on: boolean): void {
    this.enabled = on
  }

  setSize(w: number, h: number): void {
    this.composer?.setSize(w, h)
  }

  render(dt: number): void {
    this.composer?.render(dt)
  }

  rebuild(): void {
    this.composer?.dispose()
    this.composer = null
    this.build()
  }
}
