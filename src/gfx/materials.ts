// マテリアルのプリセット。壁・床は水位/濡れ線の uniform を仕込む。

import * as THREE from 'three'
import { floorTexture, wallTexture, woodTexture, fabricTexture } from './textures'

export interface WetUniforms {
  uWaterLevel: { value: number }
  uMaxLevel: { value: number }
}

export const wetUniforms: WetUniforms = {
  uWaterLevel: { value: 0 },
  uMaxLevel: { value: 0 },
}

/** 水位以下を湿らせ、過去最高水位に濡れ線を描く onBeforeCompile を仕込む */
export function makeWettable(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterLevel = wetUniforms.uWaterLevel
    shader.uniforms.uMaxLevel = wetUniforms.uMaxLevel
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWorldPosW;'
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWorldPosW = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWorldPosW;\nuniform float uWaterLevel;\nuniform float uMaxLevel;'
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        {
          float y = vWorldPosW.y;
          float wet = smoothstep(uMaxLevel + 0.015, uMaxLevel - 0.03, y);
          gl_FragColor.rgb *= mix(1.0, 0.62, wet);
          // 現水位の喫水線を少し強調
          float line = smoothstep(0.02, 0.0, abs(y - uWaterLevel)) * step(0.01, uWaterLevel);
          gl_FragColor.rgb *= mix(1.0, 0.5, line * 0.6);
          // 水没している部分は濁水越しの色に(外から見ても水中とわかる)
          float subm = smoothstep(uWaterLevel + 0.01, uWaterLevel - 0.18, y) * step(0.02, uWaterLevel);
          vec3 murk = gl_FragColor.rgb * vec3(0.5, 0.68, 0.55) * 0.75 + vec3(0.045, 0.075, 0.055);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, murk, subm * 0.9);
        }`
      )
  }
  return mat
}

let cache: {
  floor?: THREE.MeshStandardMaterial
  wall?: THREE.MeshStandardMaterial
  wood?: THREE.MeshStandardMaterial
  woodDark?: THREE.MeshStandardMaterial
  white?: THREE.MeshStandardMaterial
  metal?: THREE.MeshStandardMaterial
  fabric?: THREE.MeshStandardMaterial
} = {}

export function floorMat(): THREE.MeshStandardMaterial {
  if (!cache.floor) {
    const { map, rough } = floorTexture()
    cache.floor = makeWettable(
      new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 0.9, metalness: 0.02 })
    )
  }
  return cache.floor
}

export function wallMat(): THREE.MeshStandardMaterial {
  if (!cache.wall) {
    cache.wall = makeWettable(
      new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.95, metalness: 0 })
    )
  }
  return cache.wall
}

export function woodMat(): THREE.MeshStandardMaterial {
  if (!cache.wood) {
    cache.wood = makeWettable(
      new THREE.MeshStandardMaterial({ map: woodTexture(1), roughness: 0.75, metalness: 0.05 })
    )
  }
  return cache.wood
}

export function woodDarkMat(): THREE.MeshStandardMaterial {
  if (!cache.woodDark) {
    cache.woodDark = makeWettable(
      new THREE.MeshStandardMaterial({ map: woodTexture(0.55), roughness: 0.8, metalness: 0.05 })
    )
  }
  return cache.woodDark
}

export function whiteMat(): THREE.MeshStandardMaterial {
  if (!cache.white) {
    cache.white = makeWettable(
      new THREE.MeshStandardMaterial({ color: 0xf2f3f0, roughness: 0.45, metalness: 0.1 })
    )
  }
  return cache.white
}

export function metalMat(): THREE.MeshStandardMaterial {
  if (!cache.metal) {
    cache.metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.35, metalness: 0.85 })
  }
  return cache.metal
}

export function fabricMat(): THREE.MeshStandardMaterial {
  if (!cache.fabric) {
    cache.fabric = makeWettable(
      new THREE.MeshStandardMaterial({ map: fabricTexture(210, 120, 90), roughness: 1, metalness: 0 })
    )
  }
  return cache.fabric
}
