import * as THREE from 'three';

// 木目＋パステルの色見本。ここを変えると部屋全体の印象が変わる。
export const PALETTE = {
  woodLight: 0xe3c298,
  wood: 0xd2a874,
  woodDark: 0xb4864f,

  wallStone: 0xf3ece0,
  wallStoneAlt: 0xeae0d0,

  pink: 0xf9c9d6,
  mint: 0xbfe6d5,
  sky: 0xc7e3f7,
  lilac: 0xdccff1,
  butter: 0xfbe6a8,
  cream: 0xfdf6ea,
  peach: 0xfad6bd,

  skin: 0xfbdbc2,
  blush: 0xf6b3ac,
  hair: 0x9a7455,
  eye: 0x5b4636,
  mouth: 0xc9645f,

  water: 0x9ed3f0,
  foam: 0xffffff,
  star: 0xffd166,
  dirt: 0xbfa07a,
};

// トゥーン用の 4 段グラデーション。段差をゆるめにして絵本の塗りに近づける。
let gradientMap = null;
function getGradientMap() {
  if (!gradientMap) {
    const steps = new Uint8Array([118, 168, 214, 255]);
    gradientMap = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
    gradientMap.needsUpdate = true;
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
  }
  return gradientMap;
}

const cache = new Map();

/** 絵本寄りのやわらかい塗り。同じ設定は使い回してドローコールを節約する。 */
export function toon(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (cache.has(key)) return cache.get(key);
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: getGradientMap(),
    transparent: opts.opacity !== undefined && opts.opacity < 1,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    depthWrite: opts.depthWrite ?? true,
  });
  cache.set(key, mat);
  return mat;
}

/** 使い捨て（色や透明度を個別に動かす）マテリアル。 */
export function toonUnique(color, opts = {}) {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: getGradientMap(),
    transparent: opts.transparent ?? (opts.opacity !== undefined && opts.opacity < 1),
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    depthWrite: opts.depthWrite ?? true,
  });
}

/** 背面をすこし膨らませた輪郭線。赤ちゃんなど主役だけに付ける。 */
export function outlineMaterial(thickness = 0.012) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x8a7360, side: THREE.BackSide });
  mat.userData.thickness = thickness;
  return mat;
}
