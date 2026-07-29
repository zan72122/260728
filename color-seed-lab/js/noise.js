// 軽量な2Dバリューノイズ。境界の「にじみ」「ゆらぎ」に使う。

const PERM = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 1234567;
  const rand = () => {
    // xorshift による決定的な擬似乱数
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1000000) / 1000000;
  };
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

function hash2(ix, iy) {
  return PERM[(PERM[ix & 255] + iy) & 255] / 255;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

// 戻り値は約 [-1, 1]
export function valueNoise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  const u = smooth(fx), v = smooth(fy);
  const val = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  return val * 2 - 1;
}

// 2オクターブ重ねたフラクタルノイズ
export function fbm2(x, y) {
  return valueNoise2(x, y) * 0.68 + valueNoise2(x * 2.13 + 31.7, y * 2.13 + 17.3) * 0.32;
}
