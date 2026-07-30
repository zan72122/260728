declare module 'n8ao' {
  import type { Scene, Camera } from 'three'
  import { Pass } from 'postprocessing'

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number)
    configuration: {
      aoRadius: number
      distanceFalloff: number
      intensity: number
      color: unknown
      halfRes: boolean
      screenSpaceRadius: boolean
      depthAwareUpsampling: boolean
      gammaCorrection: boolean
    }
    setQualityMode(
      mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'
    ): void
    dispose(): void
  }
}
