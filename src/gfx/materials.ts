// マテリアルのプリセット。壁・床・家具は水位/濡れ線の uniform を仕込む。

import * as THREE from 'three'
import {
  floorTexture,
  wallTexture,
  woodTexture,
  fabricTexture,
  rugTexture,
  cardboardTexture,
  tvScreenTexture,
  leafTexture,
} from './textures'

export interface WetUniforms {
  uWaterLevel: { value: number }
  uMaxLevel: { value: number }
}

export const wetUniforms: WetUniforms = {
  uWaterLevel: { value: 0 },
  uMaxLevel: { value: 0 },
}

/**
 * 水位以下を湿らせて暗く+テカらせ、過去最高水位に濡れ線を描き、
 * 水没部分を濁水越しの色調にする onBeforeCompile を仕込む。
 */
export function makeWettable(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterLevel = wetUniforms.uWaterLevel
    shader.uniforms.uMaxLevel = wetUniforms.uMaxLevel
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosW;')
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
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          // 濡れた面はテカる
          float wetR = smoothstep(uMaxLevel + 0.015, uMaxLevel - 0.03, vWorldPosW.y);
          roughnessFactor *= mix(1.0, 0.45, wetR);
        }`
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        {
          float y = vWorldPosW.y;
          float wet = smoothstep(uMaxLevel + 0.015, uMaxLevel - 0.03, y);
          gl_FragColor.rgb *= mix(1.0, 0.66, wet);
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

interface MatCache {
  [key: string]: THREE.MeshStandardMaterial | undefined
}
const cache: MatCache = {}

export function floorMat(): THREE.MeshStandardMaterial {
  if (!cache.floor) {
    const { map, rough, normal } = floorTexture()
    cache.floor = makeWettable(
      new THREE.MeshStandardMaterial({
        map,
        roughnessMap: rough,
        normalMap: normal,
        normalScale: new THREE.Vector2(0.7, 0.7),
        roughness: 0.9,
        metalness: 0.02,
      })
    )
  }
  return cache.floor
}

export function wallMat(): THREE.MeshStandardMaterial {
  if (!cache.wall) {
    const { map, normal } = wallTexture()
    cache.wall = makeWettable(
      new THREE.MeshStandardMaterial({
        map,
        normalMap: normal,
        normalScale: new THREE.Vector2(0.45, 0.45),
        roughness: 0.95,
        metalness: 0,
      })
    )
  }
  return cache.wall
}

export function woodMat(): THREE.MeshStandardMaterial {
  if (!cache.wood) {
    const { map, normal } = woodTexture(1)
    cache.wood = makeWettable(
      new THREE.MeshStandardMaterial({
        map,
        normalMap: normal,
        normalScale: new THREE.Vector2(0.5, 0.5),
        roughness: 0.72,
        metalness: 0.05,
      })
    )
  }
  return cache.wood
}

export function woodDarkMat(): THREE.MeshStandardMaterial {
  if (!cache.woodDark) {
    const { map, normal } = woodTexture(0.55)
    cache.woodDark = makeWettable(
      new THREE.MeshStandardMaterial({
        map,
        normalMap: normal,
        normalScale: new THREE.Vector2(0.5, 0.5),
        roughness: 0.78,
        metalness: 0.05,
      })
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

export function rugMat(): THREE.MeshStandardMaterial {
  if (!cache.rug) {
    const { map, normal } = rugTexture()
    cache.rug = makeWettable(
      new THREE.MeshStandardMaterial({
        map,
        normalMap: normal,
        normalScale: new THREE.Vector2(0.6, 0.6),
        roughness: 1,
        metalness: 0,
      })
    )
  }
  return cache.rug
}

export function upholsteryMat(): THREE.MeshStandardMaterial {
  if (!cache.upholstery) {
    cache.upholstery = makeWettable(
      new THREE.MeshStandardMaterial({ map: fabricTexture(126, 138, 120), roughness: 1, metalness: 0 })
    )
  }
  return cache.upholstery
}

export function cardboardMat(): THREE.MeshStandardMaterial {
  if (!cache.cardboard) {
    cache.cardboard = makeWettable(
      new THREE.MeshStandardMaterial({ map: cardboardTexture(), roughness: 0.95, metalness: 0 })
    )
  }
  return cache.cardboard
}

export function ceramicMat(): THREE.MeshStandardMaterial {
  if (!cache.ceramic) {
    cache.ceramic = makeWettable(
      new THREE.MeshStandardMaterial({ color: 0xb46248, roughness: 0.55, metalness: 0.02 })
    )
  }
  return cache.ceramic
}

export function leafMat(): THREE.MeshStandardMaterial {
  if (!cache.leaf) {
    cache.leaf = makeWettable(
      new THREE.MeshStandardMaterial({
        map: leafTexture(),
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        roughness: 0.7,
        metalness: 0,
      })
    )
  }
  return cache.leaf
}

export function tvBodyMat(): THREE.MeshStandardMaterial {
  if (!cache.tvBody) {
    cache.tvBody = makeWettable(
      new THREE.MeshStandardMaterial({ color: 0x181a1c, roughness: 0.4, metalness: 0.3 })
    )
  }
  return cache.tvBody
}

export function tvScreenMat(): THREE.MeshStandardMaterial {
  if (!cache.tvScreen) {
    cache.tvScreen = new THREE.MeshStandardMaterial({
      map: tvScreenTexture(),
      roughness: 0.08,
      metalness: 0.4,
    })
  }
  return cache.tvScreen
}

export function plasticMat(color: number): THREE.MeshStandardMaterial {
  return makeWettable(new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.02 }))
}
