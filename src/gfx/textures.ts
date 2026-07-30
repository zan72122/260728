// Canvas/DataTexture によるプロシージャルテクスチャ生成。外部アセットは使わない。
// seed 固定の値ノイズを全テクスチャで共用する(決定的=テスト安定)。
// アルベドは ImageData 直書き、凹凸はハイトフィールド→Sobel で法線マップ化。

import * as THREE from 'three'

let seedState = 12345
function srand(seed: number): void {
  seedState = seed >>> 0
}
function rand(): number {
  seedState ^= seedState << 13
  seedState ^= seedState >>> 17
  seedState ^= seedState << 5
  seedState >>>= 0
  return seedState / 0xffffffff
}

/** 格子乱数の双線形補間による値ノイズ(0..1) */
function makeValueNoise(size: number, seed: number): (x: number, y: number) => number {
  srand(seed)
  const grid: number[] = []
  for (let i = 0; i < size * size; i++) grid.push(rand())
  const g = (ix: number, iy: number) =>
    grid[(((iy % size) + size) % size) * size + (((ix % size) + size) % size)]
  return (x: number, y: number) => {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const fx = x - ix
    const fy = y - iy
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const a = g(ix, iy)
    const b = g(ix + 1, iy)
    const c = g(ix, iy + 1)
    const d = g(ix + 1, iy + 1)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
  }
}

function fbm(noise: (x: number, y: number) => number, x: number, y: number, oct = 4): number {
  let v = 0
  let amp = 0.5
  let f = 1
  for (let i = 0; i < oct; i++) {
    v += amp * noise(x * f, y * f)
    amp *= 0.5
    f *= 2
  }
  return v
}

/** ImageData 直書きでキャンバス生成 */
function genCanvas(
  size: number,
  fn: (x: number, y: number) => [number, number, number]
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const data = img.data
  let i = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn(x, y)
      data[i++] = r
      data[i++] = g
      data[i++] = b
      data[i++] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

function toTexture(c: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 4
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

/** ハイトフィールド(0..1)→ Sobel 法線マップ */
export function normalFromHeight(
  height: Float32Array,
  size: number,
  strength: number,
  repeat = 1
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4)
  const h = (x: number, y: number) =>
    height[(((y % size) + size) % size) * size + (((x % size) + size) % size)]
  let i = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1)) -
        (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1))
      const dy =
        (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1)) -
        (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1))
      const nx = -dx * strength
      const ny = -dy * strength
      const nz = 1
      const len = Math.hypot(nx, ny, nz)
      data[i++] = Math.round(((nx / len) * 0.5 + 0.5) * 255)
      data[i++] = Math.round(((ny / len) * 0.5 + 0.5) * 255)
      data[i++] = Math.round(((nz / len) * 0.5 + 0.5) * 255)
      data[i++] = 255
    }
  }
  const t = new THREE.DataTexture(data, size, size)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.needsUpdate = true
  return t
}

export interface PbrMaps {
  map: THREE.CanvasTexture
  rough?: THREE.CanvasTexture
  normal?: THREE.DataTexture
}

// ---------------------------------------------------------------- 床

export function floorTexture(): PbrMaps {
  const A = 1024
  const H = 512
  const noise = makeValueNoise(64, 101)
  const planks = 6
  // 共通の板・木目関数(座標は 0..1)
  const plankInfo = (u: number, v: number) => {
    const row = Math.floor(v * planks)
    const offset = (row % 2) * 0.5
    const wu = (u + offset) % 1
    const rowV = v * planks - row
    return { row, wu, rowV }
  }
  const grainAt = (u: number, v: number) => {
    const { row, wu } = plankInfo(u, v)
    return (
      fbm(noise, wu * 5 + row * 11, v * 40, 3) * 0.5 +
      0.5 * Math.abs(Math.sin(wu * 60 + fbm(noise, wu * 4, v * 8.5, 2) * 6))
    )
  }
  const gapAt = (u: number, v: number) => {
    const { rowV, wu } = plankInfo(u, v)
    const gv = Math.min(rowV, 1 - rowV) * planks * 2
    const boardLen = Math.abs(wu - 0.5)
    const gu = Math.max(0, 1 - Math.abs(boardLen - 0.5) * 90)
    return Math.max(Math.max(0, 1 - gv * 14), gu)
  }

  const albedo = genCanvas(A, (x, y) => {
    const u = x / A
    const v = y / A
    const { row } = plankInfo(u, v)
    const hueBase = 0.55 + 0.25 * noise(row * 3.7, 0.5)
    const grain = grainAt(u, v)
    const gap = gapAt(u, v)
    let l = 0.45 * hueBase + grain * 0.28
    l *= 1 - gap * 0.55
    return [Math.floor(168 * l + 62), Math.floor(120 * l + 42), Math.floor(78 * l + 26)]
  })

  const roughC = genCanvas(H, (x, y) => {
    const g = grainAt(x / H, y / H)
    const ro = Math.floor(150 + g * 70)
    return [ro, ro, ro]
  })

  const height = new Float32Array(H * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < H; x++) {
      const u = x / H
      const v = y / H
      height[y * H + x] = grainAt(u, v) * 0.25 - gapAt(u, v) * 1.0
    }
  }
  return {
    map: toTexture(albedo, 2),
    rough: toTexture(roughC, 2, false),
    normal: normalFromHeight(height, H, 2.2, 2),
  }
}

// ---------------------------------------------------------------- 壁紙

export function wallTexture(): PbrMaps {
  const S = 256
  const noise = makeValueNoise(64, 202)
  const albedo = genCanvas(S, (x, y) => {
    const n = fbm(noise, x / 18, y / 18, 3)
    const stripe = 0.03 * Math.sin((x / S) * Math.PI * 24)
    const l = 0.86 + n * 0.1 + stripe
    return [Math.floor(238 * l), Math.floor(233 * l), Math.floor(220 * l)]
  })
  const height = new Float32Array(S * S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // 織物調の細かい凹凸+うっすら縦筋
      const weave =
        0.5 * fbm(noise, x / 3.2, y / 3.2, 2) + 0.1 * Math.sin((x / S) * Math.PI * 24)
      height[y * S + x] = weave
    }
  }
  return { map: toTexture(albedo, 3), normal: normalFromHeight(height, S, 0.9, 3) }
}

// ---------------------------------------------------------------- 木目

export function woodTexture(tint = 1): PbrMaps {
  const S = 256
  const noise = makeValueNoise(64, 303)
  const ring = (x: number, y: number) => {
    const d = fbm(noise, x / 40, y / 40, 3)
    return 0.5 + 0.5 * Math.sin((x / S) * 22 + d * 9)
  }
  const albedo = genCanvas(S, (x, y) => {
    const d = fbm(noise, x / 40, y / 40, 3)
    const rings = ring(x, y)
    const l = (0.5 + rings * 0.3 + d * 0.15) * tint
    return [Math.floor(150 * l + 55), Math.floor(105 * l + 35), Math.floor(70 * l + 22)]
  })
  const height = new Float32Array(S * S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      height[y * S + x] = ring(x, y) * 0.5 + fbm(noise, x / 10, y / 60, 2) * 0.3
    }
  }
  return { map: toTexture(albedo, 1), normal: normalFromHeight(height, S, 0.8, 1) }
}

// ---------------------------------------------------------------- 小物用

export function softCircleTexture(): THREE.CanvasTexture {
  const size = 64
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30)
  grad.addColorStop(0, 'rgba(255,255,255,0.95)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  const t = new THREE.CanvasTexture(c)
  t.needsUpdate = true
  return t
}

export function causticsTexture(): THREE.CanvasTexture {
  const size = 256
  const noise = makeValueNoise(32, 404)
  const c = genCanvas(size, (x, y) => {
    const n1 = fbm(noise, x / 26, y / 26, 3)
    const n2 = fbm(noise, x / 26 + 40, y / 26 + 40, 3)
    const v = Math.pow(1 - Math.min(1, Math.abs(n1 - n2) * 6), 6)
    return [Math.floor(v * 200), Math.floor(v * 235), Math.floor(v * 220)]
  })
  return toTexture(c, 2, false)
}

export function fabricTexture(r0: number, g0: number, b0: number): THREE.CanvasTexture {
  const size = 128
  const noise = makeValueNoise(64, 505)
  const c = genCanvas(size, (x, y) => {
    const weave = 0.9 + 0.1 * ((x + y) % 4 < 2 ? 1 : 0.6)
    const n = 0.85 + fbm(noise, x / 10, y / 10, 2) * 0.3
    return [Math.floor(r0 * n * weave), Math.floor(g0 * n * weave), Math.floor(b0 * n * weave)]
  })
  return toTexture(c, 2)
}

/** ラグ(境界帯+幾何柄) */
export function rugTexture(): PbrMaps {
  const S = 512
  const noise = makeValueNoise(64, 606)
  const albedo = genCanvas(S, (x, y) => {
    const u = x / S
    const v = y / S
    const border = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v))
    const pile = 0.85 + fbm(noise, x / 7, y / 7, 2) * 0.3
    // ベース: 落ち着いた青灰
    let r = 96
    let g = 106
    let b = 118
    if (border < 0.06) {
      r = 70
      g = 76
      b = 86
    } else if (border < 0.075) {
      r = 180
      g = 172
      b = 150
    } else {
      // ひし形の幾何柄
      const du = Math.abs(((u * 6) % 1) - 0.5)
      const dv = Math.abs(((v * 4) % 1) - 0.5)
      if (du + dv < 0.22) {
        r = 132
        g = 138
        b = 146
      }
    }
    return [Math.floor(r * pile), Math.floor(g * pile), Math.floor(b * pile)]
  })
  const height = new Float32Array(64 * 64)
  const n2 = makeValueNoise(32, 607)
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) height[y * 64 + x] = n2(x / 3, y / 3)
  return { map: toTexture(albedo, 1), normal: normalFromHeight(height, 64, 1.2, 8) }
}

/** 抽象画(額縁用、文字なし) */
export function paintingTexture(seed: number): THREE.CanvasTexture {
  const S = 256
  const noise = makeValueNoise(32, 700 + seed)
  const pal: [number, number, number][] =
    seed % 2 === 0
      ? [
          [214, 197, 165],
          [122, 148, 138],
          [64, 82, 92],
          [188, 130, 96],
        ]
      : [
          [206, 214, 210],
          [96, 118, 142],
          [172, 152, 118],
          [70, 74, 80],
        ]
  const c = genCanvas(S, (x, y) => {
    const n = fbm(noise, x / 60, y / 60, 3)
    const m = fbm(noise, x / 25 + 30, y / 25, 2)
    const idx = Math.min(pal.length - 1, Math.floor((n * 1.4 + m * 0.5) * pal.length) % pal.length)
    const p = pal[idx]
    const shade = 0.88 + m * 0.24
    return [Math.floor(p[0] * shade), Math.floor(p[1] * shade), Math.floor(p[2] * shade)]
  })
  return toTexture(c, 1)
}

/** 段ボール */
export function cardboardTexture(): THREE.CanvasTexture {
  const S = 256
  const noise = makeValueNoise(64, 808)
  const c = genCanvas(S, (x, y) => {
    const n = 0.85 + fbm(noise, x / 20, y / 20, 2) * 0.3
    const flute = 1 - 0.06 * Math.abs(Math.sin((x / S) * Math.PI * 48))
    const tapeBand = Math.abs(y / S - 0.5) < 0.07 ? 0.8 : 1
    const l = n * flute
    return [
      Math.floor(196 * l * tapeBand),
      Math.floor(160 * l * tapeBand),
      Math.floor(118 * l * (tapeBand === 1 ? 1 : 0.92)),
    ]
  })
  return toTexture(c, 1)
}

/** 消灯したテレビ画面(暗い反射グラデ) */
export function tvScreenTexture(): THREE.CanvasTexture {
  const S = 256
  const c = genCanvas(S, (x, y) => {
    const u = x / S
    const v = y / S
    const g = Math.max(0, 1 - Math.hypot(u - 0.3, v - 0.25) * 1.3)
    const base = 8 + g * 26
    return [Math.floor(base), Math.floor(base + 2), Math.floor(base + 5)]
  })
  return toTexture(c, 1)
}

/** 観葉植物の葉(アルファ付き) */
export function leafTexture(): THREE.CanvasTexture {
  const S = 128
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, S, S)
  // 中心から放射する笹状の葉
  ctx.translate(S / 2, S)
  for (let i = 0; i < 7; i++) {
    const ang = (i - 3) * 0.32
    ctx.save()
    ctx.rotate(ang)
    const len = 96 - Math.abs(i - 3) * 14
    const grad = ctx.createLinearGradient(0, 0, 0, -len)
    grad.addColorStop(0, 'rgb(36,72,40)')
    grad.addColorStop(0.7, 'rgb(56,110,58)')
    grad.addColorStop(1, 'rgb(88,146,84)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(9, -len * 0.5, 0, -len)
    ctx.quadraticCurveTo(-9, -len * 0.5, 0, 0)
    ctx.fill()
    ctx.restore()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}
