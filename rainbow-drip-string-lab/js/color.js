// 色のユーティリティ。
// しずくの色は RYB(絵の具の三原色)ベクトル [red, yellow, blue] で保持し、
// 混色すると 赤+黄=橙 / 黄+青=緑 / 青+赤=紫 が自然に生まれる。
// 表示時に RYB → RGB へ変換する(Gossett & Chen のトリリニア補間を明るめに調整)。

// RYB 立方体の 8 頂点に対応する RGB(子ども向けにやや明るく調整)
const RYB_CORNERS = [
  //            R      G      B
  /* 000 */ [1.0, 1.0, 1.0],   // 白(無色)
  /* 100 */ [1.0, 0.22, 0.24], // 赤
  /* 010 */ [1.0, 0.86, 0.15], // 黄
  /* 110 */ [1.0, 0.55, 0.10], // 橙
  /* 001 */ [0.16, 0.42, 0.94],// 青
  /* 101 */ [0.62, 0.28, 0.86],// 紫
  /* 011 */ [0.18, 0.74, 0.28],// 緑
  /* 111 */ [0.58, 0.40, 0.26],// 混色の泥(可愛い茶色に留める)
];

function lerp(a, b, t) { return a + (b - a) * t; }

/** RYB ベクトル [0..1]^3 を RGB [0..255]^3 に変換する */
export function rybToRgb(ryb) {
  const [r, y, b] = ryb.map((v) => Math.min(1, Math.max(0, v)));
  const c = RYB_CORNERS;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    // トリリニア補間: 000..111 の8頂点を r, y, b で補間
    const c00 = lerp(c[0][i], c[1][i], r);
    const c10 = lerp(c[2][i], c[3][i], r);
    const c01 = lerp(c[4][i], c[5][i], r);
    const c11 = lerp(c[6][i], c[7][i], r);
    const c0 = lerp(c00, c10, y);
    const c1 = lerp(c01, c11, y);
    out[i] = Math.round(255 * lerp(c0, c1, b));
  }
  return out;
}

/** 体積を重みとして2つの RYB 色を混ぜる。鮮やかさが薄まりすぎないよう補正する */
export function mixRyb(rybA, volA, rybB, volB) {
  const total = Math.max(volA + volB, 1e-6);
  const mixed = [0, 1, 2].map((i) => (rybA[i] * volA + rybB[i] * volB) / total);
  const maxIn = Math.max(...rybA, ...rybB);
  const maxOut = Math.max(...mixed);
  if (maxOut > 1e-6 && maxIn > maxOut) {
    // 平均で彩度が沈んだ分を 85% ほど戻す(水彩らしい深みは少し残す)
    const boost = lerp(1, maxIn / maxOut, 0.85);
    return mixed.map((v) => Math.min(1, v * boost));
  }
  return mixed;
}

/** CSS 色文字列を作る */
export function rgbCss(rgb, alpha = 1) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

export function rybCss(ryb, alpha = 1) {
  return rgbCss(rybToRgb(ryb), alpha);
}

/** RGB を明るく/暗くする(見た目のハイライト・影用) */
export function shade(rgb, k) {
  if (k >= 0) return rgb.map((v) => Math.round(v + (255 - v) * k));
  return rgb.map((v) => Math.round(v * (1 + k)));
}

// --- パレット(UIボタンとしずく色) ---
export const PALETTE = [
  { id: 'red',     ryb: [1, 0, 0],       label: 'あか' },
  { id: 'orange',  ryb: [1, 0.85, 0],    label: 'だいだい' },
  { id: 'yellow',  ryb: [0, 1, 0],       label: 'きいろ' },
  { id: 'green',   ryb: [0, 0.85, 1],    label: 'みどり' },
  { id: 'blue',    ryb: [0, 0, 1],       label: 'あお' },
  { id: 'purple',  ryb: [0.85, 0, 1],    label: 'むらさき' },
  { id: 'rainbow', ryb: null,            label: 'にじ' },
];

const RAINBOW_SEQ = [
  [1, 0, 0], [1, 0.85, 0], [0, 1, 0], [0, 0.85, 1], [0, 0, 1], [0.85, 0, 1],
];

/** 虹モード: フェーズ(0..1循環)からその瞬間の RYB を返す */
export function rainbowRyb(phase) {
  const p = ((phase % 1) + 1) % 1;
  const f = p * RAINBOW_SEQ.length;
  const i = Math.floor(f) % RAINBOW_SEQ.length;
  const j = (i + 1) % RAINBOW_SEQ.length;
  const t = f - Math.floor(f);
  return [0, 1, 2].map((k) => lerp(RAINBOW_SEQ[i][k], RAINBOW_SEQ[j][k], t));
}
