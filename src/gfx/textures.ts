// Canvas 2D によるプロシージャルテクスチャ生成。外部アセットは使わない。
// seed 固定の値ノイズを全テクスチャで共用する。

import * as THREE from 'three'

let seedState = 12345
function srand(seed: number): void {
  seedState = seed >>> 0
}
function rand(): number {
  // xorshift32
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
  const g = (ix: number, iy: number) => grid[((iy % size) + size) % size * size + (((ix % size) + size) % size)]
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

/** 複数オクターブ合成 */
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

function canvas2d(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  return [c, ctx]
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

/** フローリング(板割り+木目) */
export function floorTexture(): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const size = 512
  const [c, ctx] = canvas2d(size)
  const [cr, ctxR] = canvas2d(size)
  const noise = makeValueNoise(64, 101)
  const plankH = size / 6
  for (let py = 0; py < 6; py++) {
    const offset = (py % 2) * size * 0.5
    const hueBase = 0.55 + 0.25 * noise(py * 3.7, 0.5)
    for (let y = py * plankH; y < (py + 1) * plankH; y++) {
      for (let x = 0; x < size; x++) {
        const wx = (x + offset) / size
        // 木目: 低周波の帯 + 細かい筋
        const grain =
          fbm(noise, wx * 5 + py * 11, (y / size) * 40, 3) * 0.5 +
          0.5 * Math.abs(Math.sin(wx * 60 + fbm(noise, wx * 4, y / 60, 2) * 6))
        const l = 0.45 * hueBase + grain * 0.28
        const r = Math.floor(168 * l + 62)
        const g = Math.floor(120 * l + 42)
        const b = Math.floor(78 * l + 26)
        ctx.fillStyle = `rgb(${r},${g},${b})`
        ctx.fillRect(x, y, 1, 1)
        const ro = Math.floor(150 + grain * 70)
        ctxR.fillStyle = `rgb(${ro},${ro},${ro})`
        ctxR.fillRect(x, y, 1, 1)
      }
    }
    // 目地
    ctx.fillStyle = 'rgba(40,26,16,0.9)'
    ctx.fillRect(0, py * plankH, size, 2)
    ctx.fillRect((offset + size * 0.5) % size, py * plankH, 2, plankH)
  }
  return { map: toTexture(c, 2), rough: toTexture(cr, 2, false) }
}

/** 壁紙(微細ノイズ+薄い縦筋) */
export function wallTexture(): THREE.CanvasTexture {
  const size = 256
  const [c, ctx] = canvas2d(size)
  const noise = makeValueNoise(64, 202)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(noise, x / 18, y / 18, 3)
      const stripe = 0.03 * Math.sin((x / size) * Math.PI * 24)
      const l = 0.86 + n * 0.1 + stripe
      const r = Math.floor(238 * l)
      const g = Math.floor(233 * l)
      const b = Math.floor(220 * l)
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return toTexture(c, 3)
}

/** 木目(家具用) */
export function woodTexture(tint = 1): THREE.CanvasTexture {
  const size = 256
  const [c, ctx] = canvas2d(size)
  const noise = makeValueNoise(64, 303)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = fbm(noise, x / 40, y / 40, 3)
      const rings = 0.5 + 0.5 * Math.sin((x / size) * 22 + d * 9)
      const l = (0.5 + rings * 0.3 + d * 0.15) * tint
      const r = Math.floor(150 * l + 55)
      const g = Math.floor(105 * l + 35)
      const b = Math.floor(70 * l + 22)
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return toTexture(c, 1)
}

/** ソフト円スプライト(パーティクル用) */
export function softCircleTexture(): THREE.CanvasTexture {
  const size = 64
  const [c, ctx] = canvas2d(size)
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

/** コースティクス風の揺らぎ模様(天井投影用) */
export function causticsTexture(): THREE.CanvasTexture {
  const size = 256
  const [c, ctx] = canvas2d(size)
  const noise = makeValueNoise(32, 404)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n1 = fbm(noise, x / 26, y / 26, 3)
      const n2 = fbm(noise, x / 26 + 40, y / 26 + 40, 3)
      // 2つのノイズの近接部を光筋にする
      const v = Math.pow(1 - Math.min(1, Math.abs(n1 - n2) * 6), 6)
      const a = Math.floor(v * 255)
      ctx.fillStyle = `rgba(200,235,220,${a / 255})`
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return toTexture(c, 2, false)
}

/** 布(クッション) */
export function fabricTexture(r0: number, g0: number, b0: number): THREE.CanvasTexture {
  const size = 128
  const [c, ctx] = canvas2d(size)
  const noise = makeValueNoise(64, 505)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const weave = 0.9 + 0.1 * (((x + y) % 4 < 2) ? 1 : 0.6)
      const n = 0.85 + fbm(noise, x / 10, y / 10, 2) * 0.3
      ctx.fillStyle = `rgb(${Math.floor(r0 * n * weave)},${Math.floor(g0 * n * weave)},${Math.floor(b0 * n * weave)})`
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return toTexture(c, 2)
}
