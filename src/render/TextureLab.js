/**
 * TextureLab.js (A5 ENVIRONMENT)
 * -------------------------------------------------------------------------
 * プロシージャルテクスチャ工房。外部画像は一切使わない。
 * すべて CPU 側の value-noise / fbm と Canvas2D 描画から CanvasTexture /
 * DataTexture を合成する。生成コストが高いので、同じテクスチャセットは
 * `cached()` でメモ化して使い回す。
 *
 * 返却される各 `*Textures()` は { map, normalMap, roughnessMap } の組。
 * map は SRGBColorSpace、normal/roughness は NoColorSpace のまま。
 */
import * as THREE from 'three';

// ===========================================================================
// CPU ノイズ
// ===========================================================================

/** 整数格子のハッシュ (0..1 の疑似乱数、決定的)。 */
function hashInt(ix, iy, seed) {
	let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (seed | 0) * 2147483647;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h = (h ^ (h >>> 16)) >>> 0;
	return h / 4294967295;
}

/** 2D value noise（非タイリング / 任意座標）。 */
export function valueNoise2D(x, y, seed = 0) {
	const x0 = Math.floor(x), y0 = Math.floor(y);
	const xf = x - x0, yf = y - y0;
	const sx = xf * xf * (3 - 2 * xf);
	const sy = yf * yf * (3 - 2 * yf);
	const h00 = hashInt(x0, y0, seed);
	const h10 = hashInt(x0 + 1, y0, seed);
	const h01 = hashInt(x0, y0 + 1, seed);
	const h11 = hashInt(x0 + 1, y0 + 1, seed);
	const a = h00 + (h10 - h00) * sx;
	const b = h01 + (h11 - h01) * sx;
	return a + (b - a) * sy;
}

/** Fractal Brownian Motion（非タイリング）。戻り値はおおよそ 0..1。 */
export function fbm(x, y, octaves = 4, opts = {}) {
	const { lacunarity = 2.02, gain = 0.5, seed = 0 } = opts;
	let amp = 0.5, freq = 1, sum = 0, norm = 0;
	for (let i = 0; i < octaves; i++) {
		sum += amp * valueNoise2D(x * freq, y * freq, seed + i * 101);
		norm += amp;
		amp *= gain;
		freq *= lacunarity;
	}
	return norm > 0 ? sum / norm : 0;
}

/** 周期 period でラップするハッシュ（シームレスタイリング用）。 */
function hashIntWrapped(ix, iy, seed, periodX, periodY) {
	const px = ((ix % periodX) + periodX) % periodX;
	const py = ((iy % periodY) + periodY) % periodY;
	return hashInt(px, py, seed);
}

function tileableValueNoise(x, y, seed, periodX, periodY) {
	const x0 = Math.floor(x), y0 = Math.floor(y);
	const xf = x - x0, yf = y - y0;
	const sx = xf * xf * (3 - 2 * xf);
	const sy = yf * yf * (3 - 2 * yf);
	const h00 = hashIntWrapped(x0, y0, seed, periodX, periodY);
	const h10 = hashIntWrapped(x0 + 1, y0, seed, periodX, periodY);
	const h01 = hashIntWrapped(x0, y0 + 1, seed, periodX, periodY);
	const h11 = hashIntWrapped(x0 + 1, y0 + 1, seed, periodX, periodY);
	const a = h00 + (h10 - h00) * sx;
	const b = h01 + (h11 - h01) * sx;
	return a + (b - a) * sy;
}

/**
 * シームレスにタイリングする fbm。u,v は 0..1。freqX/freqY はベース周波数
 * (整数の見た目にする必要はないが、内部で周波数=周期として使うため
 * オクターブを重ねても常に厳密にタイリングする)。
 */
function tileableFbm(u, v, opts = {}) {
	const { octaves = 4, seed = 0, freqX = 4, freqY = 4, gain = 0.5 } = opts;
	let amp = 0.5, mul = 1, sum = 0, norm = 0;
	for (let i = 0; i < octaves; i++) {
		const fx = Math.max(1, Math.round(freqX * mul));
		const fy = Math.max(1, Math.round(freqY * mul));
		sum += amp * tileableValueNoise(u * fx, v * fy, seed + i * 101, fx, fy);
		norm += amp;
		amp *= gain;
		mul *= 2;
	}
	return norm > 0 ? sum / norm : 0;
}

// ===========================================================================
// キャッシュ
// ===========================================================================

const _cache = new Map();
function cached(key, factory) {
	if (_cache.has(key)) return _cache.get(key);
	const value = factory();
	_cache.set(key, value);
	return value;
}

// ===========================================================================
// 汎用ヘルパ
// ===========================================================================

function makeCanvas(w, h = w) {
	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	return c;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function toByte(v) { return Math.round(clamp01(v) * 255); }
function clampByte(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

/** "#rrggbb" を 0..1 の sRGB 値のまま（色管理を経由せず）取り出す。 */
function hexToRgb01(hex) {
	let h = hex.replace('#', '');
	if (h.length === 3) h = h.split('').map((c) => c + c).join('');
	const n = parseInt(h, 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mixRgb(a, b, t) {
	return [
		a[0] + (b[0] - a[0]) * t,
		a[1] + (b[1] - a[1]) * t,
		a[2] + (b[2] - a[2]) * t,
	];
}

function shade(rgb, k) {
	return [clamp01(rgb[0] * k), clamp01(rgb[1] * k), clamp01(rgb[2] * k)];
}

function finalizeColorTexture(tex) {
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	tex.anisotropy = 8;
	tex.generateMipmaps = true;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.needsUpdate = true;
	return tex;
}

function finalizeDataTexture(tex) {
	tex.colorSpace = THREE.NoColorSpace;
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	tex.anisotropy = 8;
	tex.generateMipmaps = true;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.needsUpdate = true;
	return tex;
}

/**
 * 既存のテクスチャセット（または単体テクスチャ）を複製し、独自の repeat を
 * 設定する。TextureLab のセットはキャッシュされ使い回されるため、
 * メッシュごとに違う repeat を与えたい場合は必ずこれを経由すること
 * （でないと他の利用箇所の repeat まで書き換えてしまう）。
 */
export function cloneTextureSet(set, repeatX = 1, repeatY = repeatX) {
	const out = {};
	for (const key of Object.keys(set)) {
		const tex = set[key];
		if (tex && tex.isTexture) {
			const c = tex.clone();
			c.repeat.set(repeatX, repeatY);
			c.needsUpdate = true;
			out[key] = c;
		} else {
			out[key] = tex;
		}
	}
	return out;
}

/**
 * 高さマップ (Canvas, R チャンネル = 高さ 0..1、タイリング前提で
 * ラップサンプリングする) から接空間法線マップを生成する。
 */
export function normalFromHeight(heightCanvas, strength = 1.5) {
	const w = heightCanvas.width, h = heightCanvas.height;
	const hctx = heightCanvas.getContext('2d');
	const src = hctx.getImageData(0, 0, w, h).data;
	const heightAt = (x, y) => {
		const xx = ((x % w) + w) % w;
		const yy = ((y % h) + h) % h;
		return src[(yy * w + xx) * 4] / 255;
	};

	const out = makeCanvas(w, h);
	const octx = out.getContext('2d');
	const img = octx.createImageData(w, h);
	const d = img.data;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const hl = heightAt(x - 1, y);
			const hr = heightAt(x + 1, y);
			const hd = heightAt(x, y - 1);
			const hu = heightAt(x, y + 1);
			const dx = (hl - hr) * strength;
			const dy = (hd - hu) * strength;
			const dz = 1.0;
			const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
			const idx = (y * w + x) * 4;
			d[idx] = toByte(dx / len * 0.5 + 0.5);
			d[idx + 1] = toByte(dy / len * 0.5 + 0.5);
			d[idx + 2] = toByte(dz / len * 0.5 + 0.5);
			d[idx + 3] = 255;
		}
	}
	octx.putImageData(img, 0, 0);
	return finalizeDataTexture(new THREE.CanvasTexture(out));
}

/**
 * 汎用テクスチャセットビルダ。color/height/rough は (u,v,x,y) => number
 * (color は [r,g,b]) を返す関数。afterDraw で Canvas2D の追加描画
 * (目地線・継ぎ目など) をベイク後に行える。
 */
function buildTextureSet({ size = 512, color, height, rough, afterDraw, normalStrength = 1.4 }) {
	const colorCanvas = makeCanvas(size);
	const heightCanvas = makeCanvas(size);
	const roughCanvas = makeCanvas(size);
	const cctx = colorCanvas.getContext('2d');
	const hctx = heightCanvas.getContext('2d');
	const rctx = roughCanvas.getContext('2d');
	const cImg = cctx.createImageData(size, size);
	const hImg = hctx.createImageData(size, size);
	const rImg = rctx.createImageData(size, size);

	for (let y = 0; y < size; y++) {
		const v = y / size;
		for (let x = 0; x < size; x++) {
			const u = x / size;
			const idx = (y * size + x) * 4;

			const rgb = color(u, v, x, y);
			cImg.data[idx] = toByte(rgb[0]);
			cImg.data[idx + 1] = toByte(rgb[1]);
			cImg.data[idx + 2] = toByte(rgb[2]);
			cImg.data[idx + 3] = 255;

			const hv = toByte(height(u, v, x, y));
			hImg.data[idx] = hv; hImg.data[idx + 1] = hv; hImg.data[idx + 2] = hv; hImg.data[idx + 3] = 255;

			const rv = toByte(rough(u, v, x, y));
			rImg.data[idx] = rv; rImg.data[idx + 1] = rv; rImg.data[idx + 2] = rv; rImg.data[idx + 3] = 255;
		}
	}
	cctx.putImageData(cImg, 0, 0);
	hctx.putImageData(hImg, 0, 0);
	rctx.putImageData(rImg, 0, 0);

	if (afterDraw) afterDraw({ cctx, hctx, rctx, size });

	const map = finalizeColorTexture(new THREE.CanvasTexture(colorCanvas));
	const roughnessMap = finalizeDataTexture(new THREE.CanvasTexture(roughCanvas));
	const normalMap = normalFromHeight(heightCanvas, normalStrength);
	return { map, normalMap, roughnessMap };
}

// ===========================================================================
// DataTexture ノイズ（汎用ユーティリティ）
// ===========================================================================

/** シームレスにタイリングする RGBA DataTexture を生成する。 */
export function noiseTexture(size = 256, opts = {}) {
	const { freqX = 6, freqY = 6, octaves = 4, seed = 0 } = opts;
	const key = `noiseTex:${size}:${freqX}:${freqY}:${octaves}:${seed}`;
	return cached(key, () => {
		const data = new Uint8Array(size * size * 4);
		for (let y = 0; y < size; y++) {
			const v = y / size;
			for (let x = 0; x < size; x++) {
				const u = x / size;
				const n1 = tileableFbm(u, v, { octaves, seed, freqX, freqY });
				const n2 = tileableFbm(u, v, { octaves, seed: seed + 97, freqX, freqY });
				const idx = (y * size + x) * 4;
				data[idx] = toByte(n1);
				data[idx + 1] = toByte(n2);
				data[idx + 2] = toByte((n1 + n2) * 0.5);
				data[idx + 3] = 255;
			}
		}
		const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
		return finalizeDataTexture(tex);
	});
}

// ===========================================================================
// マテリアル・テクスチャセット (map + normalMap + roughnessMap)
// ===========================================================================

/** FRP（樋・滑り台）向けのつや消し〜半光沢プラスチック。 */
export function fiberglassTextures(color = '#22b6c8') {
	return cached(`fiberglass:${color}`, () => {
		const base = hexToRgb01(color);
		const dark = shade(base, 0.74);
		const light = shade(base, 1.22);
		return buildTextureSet({
			size: 512,
			color: (u, v) => {
				const n = tileableFbm(u, v, { octaves: 3, seed: 4, freqX: 5, freqY: 5 });
				const streak = tileableFbm(u, v, { octaves: 2, seed: 17, freqX: 2, freqY: 24 });
				const t = clamp01(0.5 + (n - 0.5) * 0.3 + (streak - 0.5) * 0.12);
				return mixRgb(dark, light, t);
			},
			height: (u, v) => 0.5 + (tileableFbm(u, v, { octaves: 3, seed: 4, freqX: 5, freqY: 5 }) - 0.5) * 0.4,
			rough: (u, v) => 0.16 + tileableFbm(u, v, { octaves: 2, seed: 23, freqX: 9, freqY: 9 }) * 0.22,
			normalStrength: 0.5,
		});
	});
}

/** 打ちっぱなしコンクリート。伸縮目地入り。 */
export function concreteTextures() {
	return cached('concrete', () => {
		const base = [0.60, 0.59, 0.56];
		return buildTextureSet({
			size: 512,
			color: (u, v) => {
				const big = tileableFbm(u, v, { octaves: 4, seed: 1, freqX: 4, freqY: 4 });
				const fine = tileableFbm(u, v, { octaves: 2, seed: 31, freqX: 20, freqY: 20 });
				const stain = tileableFbm(u, v, { octaves: 3, seed: 55, freqX: 3, freqY: 3 });
				const shadeAmt = 0.80 + big * 0.32 + fine * 0.08 - Math.max(0, stain - 0.62) * 0.5;
				return shade(base, shadeAmt);
			},
			height: (u, v) => {
				const big = tileableFbm(u, v, { octaves: 4, seed: 1, freqX: 4, freqY: 4 });
				const fine = tileableFbm(u, v, { octaves: 2, seed: 31, freqX: 24, freqY: 24 });
				return clamp01(big * 0.7 + fine * 0.3);
			},
			rough: (u, v) => 0.78 + tileableFbm(u, v, { octaves: 3, seed: 61, freqX: 16, freqY: 16 }) * 0.18,
			afterDraw: ({ hctx, cctx, size }) => {
				const step = size / 4;
				for (const [ctx, style] of [[hctx, 'rgba(0,0,0,0.55)'], [cctx, 'rgba(25,22,18,0.22)']]) {
					ctx.strokeStyle = style;
					ctx.lineWidth = Math.max(1, size * 0.0035);
					for (let k = 1; k < 4; k++) {
						ctx.beginPath(); ctx.moveTo(k * step, 0); ctx.lineTo(k * step, size); ctx.stroke();
						ctx.beginPath(); ctx.moveTo(0, k * step); ctx.lineTo(size, k * step); ctx.stroke();
					}
				}
			},
			normalStrength: 1.6,
		});
	});
}

/** プールタイル：目地入りの正方タイル + わずかな色ムラ。 */
export function tileTextures() {
	return cached('tile', () => {
		const size = 512;
		const tilesPerSide = 8;
		const cellPx = size / tilesPerSide;
		const groutPx = Math.max(2, cellPx * 0.07);
		const palette = [[0.08, 0.46, 0.56], [0.12, 0.53, 0.62], [0.06, 0.40, 0.50], [0.16, 0.58, 0.64]];

		function groutMask(u, v) {
			const px = (u * size) % cellPx;
			const py = (v * size) % cellPx;
			return (px < groutPx || py < groutPx) ? 1 : 0;
		}
		function tileColor(u, v) {
			const ix = Math.floor(u * tilesPerSide), iy = Math.floor(v * tilesPerSide);
			const hh = hashInt(ix, iy, 777);
			return palette[Math.floor(hh * palette.length) % palette.length];
		}

		return buildTextureSet({
			size,
			color: (u, v) => {
				if (groutMask(u, v)) return [0.80, 0.82, 0.83];
				const base = tileColor(u, v);
				const ix = Math.floor(u * tilesPerSide), iy = Math.floor(v * tilesPerSide);
				const jitter = 0.9 + hashInt(ix * 13 + 3, iy * 7 + 9, 42) * 0.22;
				const glaze = tileableFbm(u, v, { octaves: 2, seed: 9, freqX: 60, freqY: 60 }) * 0.06;
				return shade(base, jitter + glaze);
			},
			height: (u, v) => groutMask(u, v) ? 0.18 : 0.75 + tileableFbm(u, v, { octaves: 2, seed: 9, freqX: 60, freqY: 60 }) * 0.05,
			rough: (u, v) => groutMask(u, v) ? 0.72 : 0.10 + tileableFbm(u, v, { octaves: 2, seed: 15, freqX: 40, freqY: 40 }) * 0.08,
			normalStrength: 2.4,
		});
	});
}

/** ビーチの砂。細粒 + 貝殻/クォーツの微細な光り粒。 */
export function sandTextures() {
	return cached('sand', () => {
		const base = [0.85, 0.75, 0.55];
		return buildTextureSet({
			size: 512,
			color: (u, v) => {
				const big = tileableFbm(u, v, { octaves: 3, seed: 2, freqX: 3, freqY: 3 });
				const grain = tileableFbm(u, v, { octaves: 2, seed: 71, freqX: 60, freqY: 60 });
				const speck = tileableFbm(u, v, { octaves: 1, seed: 91, freqX: 128, freqY: 128 });
				let shadeAmt = 0.88 + big * 0.18 + (grain - 0.5) * 0.12;
				if (speck > 0.9) shadeAmt *= 1.25;
				return shade(base, shadeAmt);
			},
			height: (u, v) => {
				const grain = tileableFbm(u, v, { octaves: 3, seed: 71, freqX: 70, freqY: 70 });
				const ripple = Math.sin(u * Math.PI * 2 * 6) * 0.12;
				return clamp01(0.5 + grain * 0.35 + ripple);
			},
			rough: () => 0.92,
			normalStrength: 1.1,
		});
	});
}

/** デッキ材の木目板。板間の目地溝つき。 */
export function woodTextures() {
	return cached('wood', () => {
		const size = 512;
		const planks = 8;
		const plankPx = size / planks;
		const seamPx = Math.max(1.5, plankPx * 0.05);
		function seamAmount(v) {
			const py = (v * size) % plankPx;
			const d = Math.min(py, plankPx - py);
			return d < seamPx ? 1 : 0;
		}
		function plankIdx(v) { return Math.floor(v * planks); }

		return buildTextureSet({
			size,
			color: (u, v) => {
				const base = [0.50, 0.33, 0.18];
				const grain = tileableFbm(u, v, { octaves: 3, seed: 12, freqX: 8, freqY: 80 });
				const plankShade = 0.85 + hashInt(3, plankIdx(v), 501) * 0.3;
				let shadeAmt = plankShade * (0.85 + grain * 0.25);
				if (seamAmount(v)) shadeAmt *= 0.4;
				return shade(base, shadeAmt);
			},
			height: (u, v) => {
				const grain = tileableFbm(u, v, { octaves: 3, seed: 12, freqX: 8, freqY: 80 });
				let h = 0.55 + grain * 0.3;
				if (seamAmount(v)) h -= 0.35;
				return clamp01(h);
			},
			rough: (u, v) => 0.42 + tileableFbm(u, v, { octaves: 2, seed: 44, freqX: 8, freqY: 80 }) * 0.25,
			normalStrength: 1.8,
		});
	});
}

/** 芝生。乾いたパッチと健康な緑のムラ。 */
export function grassTextures() {
	return cached('grass', () => {
		const base = [0.24, 0.42, 0.16];
		const dry = [0.45, 0.42, 0.15];
		return buildTextureSet({
			size: 512,
			color: (u, v) => {
				const n = tileableFbm(u, v, { octaves: 4, seed: 8, freqX: 10, freqY: 10 });
				const patch = tileableFbm(u, v, { octaves: 3, seed: 71, freqX: 3, freqY: 3 });
				const c = mixRgb(base, dry, clamp01(patch * 1.3 - 0.15));
				return shade(c, 0.82 + n * 0.32);
			},
			height: (u, v) => tileableFbm(u, v, { octaves: 4, seed: 8, freqX: 24, freqY: 24 }),
			rough: (u, v) => 0.75 + tileableFbm(u, v, { octaves: 2, seed: 33, freqX: 10, freqY: 10 }) * 0.15,
			normalStrength: 1.3,
		});
	});
}

/** 遠景の岩肌用。 */
export function rockTextures() {
	return cached('rock', () => {
		const base = [0.42, 0.40, 0.37];
		return buildTextureSet({
			size: 512,
			color: (u, v) => {
				const n = tileableFbm(u, v, { octaves: 5, seed: 19, freqX: 6, freqY: 6 });
				const crack = tileableFbm(u, v, { octaves: 2, seed: 44, freqX: 14, freqY: 14 });
				const shadeAmt = 0.7 + n * 0.5 - Math.max(0, crack - 0.7) * 0.4;
				return shade(base, shadeAmt);
			},
			height: (u, v) => {
				const n = tileableFbm(u, v, { octaves: 5, seed: 19, freqX: 6, freqY: 6 });
				const fine = tileableFbm(u, v, { octaves: 3, seed: 52, freqX: 20, freqY: 20 });
				return clamp01(n * 0.7 + fine * 0.3);
			},
			rough: () => 0.88,
			normalStrength: 2.0,
		});
	});
}

/** 塗装/ガルバナイズ金属（手すり・脚部・支柱用）。 */
export function metalTextures(color = '#8f9aa3') {
	return cached(`metal:${color}`, () => {
		const base = hexToRgb01(color);
		return buildTextureSet({
			size: 512,
			color: (u, v) => {
				const brushed = tileableFbm(u, v, { octaves: 2, seed: 6, freqX: 2, freqY: 60 });
				const speck = tileableFbm(u, v, { octaves: 3, seed: 81, freqX: 30, freqY: 30 });
				const rust = tileableFbm(u, v, { octaves: 2, seed: 12, freqX: 8, freqY: 8 });
				const shadeAmt = 0.85 + brushed * 0.2 + (speck - 0.5) * 0.1;
				let c = shade(base, shadeAmt);
				if (rust > 0.7) c = mixRgb(c, [0.32, 0.19, 0.11], (rust - 0.7) * 1.5);
				return c;
			},
			height: (u, v) => 0.5 + (tileableFbm(u, v, { octaves: 2, seed: 6, freqX: 2, freqY: 60 }) - 0.5) * 0.5,
			rough: (u, v) => 0.28 + tileableFbm(u, v, { octaves: 2, seed: 81, freqX: 30, freqY: 30 }) * 0.35,
			normalStrength: 0.7,
		});
	});
}

/** 地形の汎用ディテール（ほぼ中立色 = 頂点カラーの色味を殺さない）。 */
export function terrainDetailTextures() {
	return cached('terrainDetail', () => buildTextureSet({
		size: 512,
		color: (u, v) => {
			const n = tileableFbm(u, v, { octaves: 5, seed: 3, freqX: 24, freqY: 24 });
			const patch = tileableFbm(u, v, { octaves: 3, seed: 88, freqX: 6, freqY: 6 });
			const shadeAmt = 0.80 + n * 0.28 + (patch - 0.5) * 0.1;
			return [shadeAmt, shadeAmt, shadeAmt];
		},
		height: (u, v) => tileableFbm(u, v, { octaves: 5, seed: 3, freqX: 30, freqY: 30 }),
		rough: (u, v) => 0.75 + tileableFbm(u, v, { octaves: 3, seed: 14, freqX: 18, freqY: 18 }) * 0.2,
		normalStrength: 1.4,
	}));
}

/** 椰子の幹の樹皮。縦方向の深い溝。 */
export function barkTexture() {
	return cached('bark', () => buildTextureSet({
		size: 512,
		color: (u, v) => {
			const base = [0.32, 0.22, 0.14];
			const ridge = tileableFbm(u, v, { octaves: 4, seed: 5, freqX: 16, freqY: 5 });
			const patch = tileableFbm(u, v, { octaves: 3, seed: 66, freqX: 6, freqY: 6 });
			const shadeAmt = 0.62 + ridge * 0.6 + (patch - 0.5) * 0.2;
			return shade(base, shadeAmt);
		},
		height: (u, v) => {
			const ridge = tileableFbm(u, v, { octaves: 4, seed: 5, freqX: 16, freqY: 5 });
			const ridged = Math.abs(ridge * 2 - 1);
			return clamp01(1.0 - ridged * 0.9);
		},
		rough: () => 0.9,
		normalStrength: 2.6,
	}));
}

/** 遠景の海面用の簡易な波の法線 + 粗さ（map は持たず、色はマテリアル側で付ける）。 */
export function seaWaveTextures() {
	return cached('seaWave', () => {
		const base = [0.07, 0.28, 0.36];
		const crest = [0.16, 0.46, 0.52];
		return buildTextureSet({
			size: 512,
			color: (u, v) => {
				const swell = tileableFbm(u, v, { octaves: 3, seed: 3, freqX: 5, freqY: 2 });
				const ripple = tileableFbm(u, v, { octaves: 3, seed: 41, freqX: 22, freqY: 22 });
				const hv = clamp01(swell * 0.6 + ripple * 0.4);
				return mixRgb(base, crest, hv * 0.6 + ripple * 0.15);
			},
			height: (u, v) => {
				const swell = tileableFbm(u, v, { octaves: 3, seed: 3, freqX: 5, freqY: 2 });
				const ripple = tileableFbm(u, v, { octaves: 3, seed: 41, freqX: 22, freqY: 22 });
				return clamp01(swell * 0.6 + ripple * 0.4);
			},
			rough: (u, v) => {
				const ripple = tileableFbm(u, v, { octaves: 3, seed: 41, freqX: 22, freqY: 22 });
				return 0.16 + ripple * 0.3;
			},
			normalStrength: 1.2,
		});
	});
}

// ===========================================================================
// 単体テクスチャ（装飾・カード類）
// ===========================================================================

/** 椰子の葉：アルファ付きで葉の形に切り抜いた frond カード。 */
export function foliageTexture() {
	return cached('foliage', () => {
		const w = 512, h = 640;
		const canvas = makeCanvas(w, h);
		const ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, w, h);

		const baseX = w / 2, baseY = h - 8, tipY = 24;
		const ribLen = baseY - tipY;
		const pairs = 16;
		const greens = ['#3f7a2d', '#4f8f34', '#6aa93f', '#2f6323'];

		for (let i = pairs; i >= 1; i--) {
			const along = 1 - i / pairs; // 0 = base, 1 = tip
			const cy = baseY - along * ribLen * 0.94;
			const bladeLen = (0.60 - along * 0.42) * w;
			const bladeWidth = (0.22 - along * 0.14) * h * 0.16;
			const droop = 0.18 + along * 0.55;

			for (const side of [-1, 1]) {
				const angle = side * (0.30 + along * 0.62) - droop * side * 0.15;
				ctx.save();
				ctx.translate(baseX, cy);
				ctx.rotate(angle);
				const grad = ctx.createLinearGradient(0, 0, bladeLen, 0);
				grad.addColorStop(0, greens[i % greens.length]);
				grad.addColorStop(1, greens[(i + 2) % greens.length]);
				ctx.fillStyle = grad;
				ctx.beginPath();
				ctx.moveTo(0, 0);
				ctx.quadraticCurveTo(bladeLen * 0.45, -bladeWidth, bladeLen, -bladeWidth * 0.08);
				ctx.quadraticCurveTo(bladeLen * 0.5, bladeWidth * 0.9, 0, 0);
				ctx.closePath();
				ctx.fill();
				ctx.restore();
			}
		}

		ctx.strokeStyle = 'rgba(68,104,40,0.9)';
		ctx.lineWidth = 5;
		ctx.beginPath();
		ctx.moveTo(baseX, baseY);
		ctx.quadraticCurveTo(baseX + 10, (baseY + tipY) / 2, baseX, tipY);
		ctx.stroke();

		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.wrapS = THREE.ClampToEdgeWrapping;
		tex.wrapT = THREE.ClampToEdgeWrapping;
		tex.anisotropy = 8;
		tex.generateMipmaps = true;
		tex.needsUpdate = true;
		return tex;
	});
}

/** ソフトな雲のビルボード用アルファテクスチャ。 */
export function cloudTexture() {
	return cached('cloud', () => {
		const size = 256;
		const canvas = makeCanvas(size);
		const ctx = canvas.getContext('2d');
		const img = ctx.createImageData(size, size);
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const u = x / size, v = y / size;
				const dx = u - 0.5, dy = v - 0.5;
				const d = Math.sqrt(dx * dx + dy * dy) * 2.1;
				const n = fbm(x * 0.045, y * 0.045, 4);
				let a = clamp01((1 - d) * 1.35 - 0.12);
				a *= clamp01(0.35 + n * 0.95);
				const idx = (y * size + x) * 4;
				img.data[idx] = 255; img.data[idx + 1] = 255; img.data[idx + 2] = 255;
				img.data[idx + 3] = toByte(a);
			}
		}
		ctx.putImageData(img, 0, 0);
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.wrapS = THREE.ClampToEdgeWrapping;
		tex.wrapT = THREE.ClampToEdgeWrapping;
		tex.anisotropy = 4;
		tex.generateMipmaps = true;
		tex.needsUpdate = true;
		return tex;
	});
}

/** トンネル内の光の筋用：縦グラデーションの柔らかいビーム。 */
export function lightBeamTexture() {
	return cached('lightBeam', () => {
		const w = 64, h = 256;
		const canvas = makeCanvas(w, h);
		const ctx = canvas.getContext('2d');
		const img = ctx.createImageData(w, h);
		for (let y = 0; y < h; y++) {
			const v = y / h;
			const vertical = Math.pow(1 - v, 1.5);
			for (let x = 0; x < w; x++) {
				const u = x / w;
				const horiz = Math.max(0, 1 - Math.abs(u - 0.5) * 2);
				const a = clamp01(vertical * Math.pow(horiz, 1.2));
				const idx = (y * w + x) * 4;
				img.data[idx] = 255; img.data[idx + 1] = 249; img.data[idx + 2] = 222;
				img.data[idx + 3] = toByte(a * 0.85);
			}
		}
		ctx.putImageData(img, 0, 0);
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.wrapS = THREE.ClampToEdgeWrapping;
		tex.wrapT = THREE.ClampToEdgeWrapping;
		tex.anisotropy = 4;
		tex.generateMipmaps = true;
		tex.needsUpdate = true;
		return tex;
	});
}

/** 警告サイン用: 日本語テキストをプロシージャルに描く。 */
export function signTexture(lines, opts = {}) {
	const { width = 512, height = 256, bg = '#fdd835', fg = '#1a1a1a', border = '#c62828', icon = true } = opts;
	const key = `sign:${JSON.stringify(lines)}:${width}:${height}:${bg}:${fg}:${border}:${icon}`;
	return cached(key, () => {
		const canvas = makeCanvas(width, height);
		const ctx = canvas.getContext('2d');
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, width, height);

		for (let i = 0; i < 26; i++) {
			ctx.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.03})`;
			ctx.beginPath();
			ctx.arc(Math.random() * width, Math.random() * height, 10 + Math.random() * 40, 0, Math.PI * 2);
			ctx.fill();
		}

		const bw = Math.round(height * 0.06);
		ctx.strokeStyle = border;
		ctx.lineWidth = bw;
		ctx.strokeRect(bw / 2, bw / 2, width - bw, height - bw);

		let textX = width * 0.5;
		if (icon) {
			ctx.save();
			ctx.translate(width * 0.16, height * 0.5);
			const s = height * 0.28;
			ctx.beginPath();
			ctx.moveTo(0, -s); ctx.lineTo(s * 0.9, s * 0.75); ctx.lineTo(-s * 0.9, s * 0.75); ctx.closePath();
			ctx.fillStyle = border;
			ctx.fill();
			ctx.fillStyle = bg;
			ctx.font = `bold ${Math.round(s * 1.1)}px sans-serif`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText('!', 0, s * 0.12);
			ctx.restore();
			textX = width * 0.6;
		}

		ctx.fillStyle = fg;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const lineH = height / (lines.length + 1);
		const fontSize = Math.round(Math.min(lineH * 0.78, width * 0.095));
		ctx.font = `bold ${fontSize}px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif`;
		lines.forEach((line, i) => ctx.fillText(line, textX, lineH * (i + 1)));

		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.wrapS = THREE.ClampToEdgeWrapping;
		tex.wrapT = THREE.ClampToEdgeWrapping;
		tex.anisotropy = 8;
		tex.generateMipmaps = true;
		tex.needsUpdate = true;
		return tex;
	});
}

/** 旗（ストライプ）。 */
export function flagTexture(colorA = '#e63946', colorB = '#f1faee') {
	return cached(`flag:${colorA}:${colorB}`, () => {
		const w = 256, h = 160;
		const canvas = makeCanvas(w, h);
		const ctx = canvas.getContext('2d');
		const stripes = 5;
		for (let i = 0; i < stripes; i++) {
			ctx.fillStyle = i % 2 === 0 ? colorA : colorB;
			ctx.fillRect(0, Math.floor(i * h / stripes), w, Math.ceil(h / stripes) + 1);
		}
		const img = ctx.getImageData(0, 0, w, h);
		for (let i = 0; i < img.data.length; i += 4) {
			const n = (Math.random() - 0.5) * 14;
			img.data[i] = clampByte(img.data[i] + n);
			img.data[i + 1] = clampByte(img.data[i + 1] + n);
			img.data[i + 2] = clampByte(img.data[i + 2] + n);
		}
		ctx.putImageData(img, 0, 0);
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.wrapS = THREE.ClampToEdgeWrapping;
		tex.wrapT = THREE.ClampToEdgeWrapping;
		tex.anisotropy = 4;
		tex.generateMipmaps = true;
		tex.needsUpdate = true;
		return tex;
	});
}

/** ブイの赤白ストライプ。 */
export function buoyStripeTexture() {
	return cached('buoyStripe', () => {
		const w = 256, h = 128;
		const canvas = makeCanvas(w, h);
		const ctx = canvas.getContext('2d');
		ctx.fillStyle = '#f2f2ee';
		ctx.fillRect(0, 0, w, h);
		ctx.fillStyle = '#d1272d';
		const bands = 4;
		for (let i = 0; i < bands; i++) {
			ctx.fillRect(i * 2 * (w / (bands * 2)), 0, w / (bands * 2), h);
		}
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.wrapS = THREE.RepeatWrapping;
		tex.wrapT = THREE.ClampToEdgeWrapping;
		tex.anisotropy = 4;
		tex.generateMipmaps = true;
		tex.needsUpdate = true;
		return tex;
	});
}
