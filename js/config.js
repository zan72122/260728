// ============================================================
// みずみちラボ - 設定・定数
// ============================================================
"use strict";

const CFG = {
  GW: 52,            // グリッド横セル数
  GH: 52,            // グリッド縦セル数
  ROW: 0.78,         // 旧投影の遺物・非推奨(真アイソメでは view.th を使う)
  EH: 0.62,          // 旧投影の遺物・非推奨(真アイソメでは view.eh を使う)
  SEA_LEVEL: 1.0,    // 海面の高さ
  MAX_H: 7,          // 地形の最大高さ
  FLOW: 0.22,        // 水の流れやすさ
  WATER_ITER: 3,     // 1フレームあたりの水シミュ反復回数
  EVAP: 0.0006,      // 蒸発量/フレーム
  WET_DEPTH: 0.05,   // 「ぬれた」と判定する水深
  POUR_RATE: 0.22,   // みずツールの注水量/フレーム
};

// 地形タイプ
const T_SAND = 0, T_GRASS = 1, T_ROCK = 2, T_RIVER = 3,
      T_DITCH = 4, T_LEVEE = 5, T_PLAT = 6, T_SEA = 7;

// パレット(やわらかいパステル・ジオラマ調)
const PAL = {
  wood1: "#e3bd8c", wood2: "#d8af7c", wood3: "#caa06c",
  tray:  "#fdf8ec", trayEdge: "#efe2c6", trayShadow: "rgba(120,85,40,.28)",

  sand:      [247, 227, 176],
  sandLow:   [240, 214, 152],
  grass:     [176, 222, 134],
  grassHigh: [140, 200, 116],
  rock:      [206, 186, 158],
  rockHigh:  [228, 216, 196],
  snow:      [252, 250, 244],
  riverbed:  [168, 214, 216],
  ditch:     [172, 186, 128],
  levee:     [235, 235, 232],
  plat:      [186, 226, 148],
  seafloor:  [120, 200, 216],

  wallSoil:  [214, 182, 130],
  wallSoil2: [188, 152, 102],
  wallRock:  [186, 168, 144],
  wallLevee: [210, 210, 208],
  wallPlat:  [222, 190, 136],

  waterShallow: [100, 205, 234],
  waterDeep:    [46, 166, 214],
  seaShallow:   [124, 224, 234],
  seaDeep:      [36, 158, 208],
  foam: "rgba(255,255,255,0.85)",
};

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function mixRGB(c1, c2, t) {
  return [lerp(c1[0], c2[0], t) | 0, lerp(c1[1], c2[1], t) | 0, lerp(c1[2], c2[2], t) | 0];
}
function rgb(c, mul) {
  mul = mul === undefined ? 1 : mul;
  return "rgb(" + clamp(c[0] * mul, 0, 255 | 0) + "," + clamp(c[1] * mul, 0, 255) + "," + clamp(c[2] * mul, 0, 255) + ")";
}
function rgba(c, a, mul) {
  mul = mul === undefined ? 1 : mul;
  return "rgba(" + clamp(c[0] * mul, 0, 255) + "," + clamp(c[1] * mul, 0, 255) + "," + clamp(c[2] * mul, 0, 255) + "," + a + ")";
}
// シード付き乱数(マップ生成の再現用)
function makeRand(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
