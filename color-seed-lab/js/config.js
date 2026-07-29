// ゲーム全体で共有する定数と色の定義

// 種の色パレット。deco は領域の中に生まれる「下流の変化」の種類。
export const COLORS = [
  { name: 'red',    hex: '#ff5a6e', rgb: [255, 90, 110],  deco: 'flower'    },
  { name: 'orange', hex: '#ff9f43', rgb: [255, 159, 67],  deco: 'butterfly' },
  { name: 'yellow', hex: '#ffd23f', rgb: [255, 210, 63],  deco: 'bubbler'   },
  { name: 'green',  hex: '#6fd66a', rgb: [111, 214, 106], deco: 'sprout'    },
  { name: 'blue',   hex: '#4fc3f7', rgb: [79, 195, 247],  deco: 'pond'      },
  { name: 'purple', hex: '#b388ff', rgb: [179, 136, 255], deco: 'star'      },
];

// フィールド（ボロノイ計算グリッド）
export const FIELD = {
  CELL: 6,              // 1セルの大きさ（CSSピクセル）。小さいほど滑らか・重い
  NOISE_AMP: 7,         // 境界を有機的に波打たせる静的ノイズの振幅（px）
  JIGGLE_BASE: 1.6,     // 常時のぷるぷる振幅（px）
  JIGGLE_MAX: 7,        // 種を置いた直後・泡の時の最大ぷるぷる振幅（px）
  EDGE_SOFT: 6,         // 領域同士の境目とみなすスコア差（px）
  RIM_SOFT: 3.5,        // 成長中の外周リムの幅（px）
};

// 種の成長パラメータ（minDim = 画面の短辺に対する比率）
export const SEED = {
  MAX_COUNT: 12,        // 同時に置ける種の数（超えたら一番古い種がポンと弾ける）
  START_R: 10,          // 置いた瞬間の半径（px）
  BASE_RMAX_RATIO: 0.30,  // 基本の最大半径 / minDim
  CAP_RMAX_RATIO: 0.48,   // 水やりで伸ばせる上限 / minDim
  GROW_SPEED_RATIO: 0.055, // 成長速度 / minDim（毎秒）
  WATER_RMAX_BONUS_RATIO: 0.045, // 水やり1回で増える最大半径 / minDim
  WATER_RADIUS_RATIO: 0.22,      // 水が届く範囲 / minDim
  DRAW_R: 15,           // 種そのものの描画半径（px）
  GRAB_R: 46,           // 種をつかめる距離（px）
};

export const TOOLS = {
  SEED: 'seed',      // 置く・動かす
  WATER: 'water',    // 水をかける（成長ブースト）
  BUBBLE: 'bubble',  // 泡を増やす（ぷるぷる＋泡）
};

// 装飾（下流の変化）の密度など
export const DECO = {
  SPAWN_INTERVAL: 0.22,   // 何秒ごとに湧きを試すか
  MAX_PER_SEED: 7,        // 種1つあたりの装飾数の目安
  MIN_DEPTH: 8,           // 領域の内側と判定するスコア深さ（px）
  MIN_GAP: 46,            // 装飾同士の最小間隔（px）
};

export const MAX_PARTICLES = 420;

// 背景（浅い水たまり）の色
export const BG = {
  TOP: [224, 245, 250],
  BOTTOM: [196, 231, 240],
};
