/* ═══════════════════════════════════════════════════════════
   config.js — 素材・鏡・物理のチューニング定数
   ═══════════════════════════════════════════════════════════ */
"use strict";

const KKM = window.KKM = {};

/* 論理チャンバー半径（物理はこの単位系で動く） */
KKM.CHAMBER_R = 100;

/* 鏡の枚数 → 基本セクター角（ラジアン）
   2まい: 6分割のおおらかな模様 / 3まい: 10分割の花 / 4まい: 16分割のレース */
KKM.MIRROR_SECTOR = {
  2: Math.PI / 3,
  3: Math.PI / 5,
  4: Math.PI / 8,
};

/* ずらしスライダー(-1..1) → 1セクターあたりの角度誤差（ラジアン）
   最大 ±3.2度。積み重なって「つなぎ目の破れ」になる */
KKM.SKEW_MAX = 3.2 * Math.PI / 180;

/* 素材ごとの定義 */
KKM.MATERIALS = {
  beads: {
    label: "びーず",
    scoop: 5,             // ひとすくいの個数
    weight: 3,            // 満杯ゲージへの寄与
    rMin: 6.2, rMax: 10.8,
    restitution: 0.46,
    drag: 0.25,           // 空気中の抵抗（1/s）
    liquidDrag: 3.1,      // 液体中の抵抗
    gravScale: 1.0,
    liquidGravScale: 0.34,
    collides: true,
    colors: [
      ["#ffb7cf", "#ff8fb3", "#d95c8a"],   // [明, 中, 暗] ガラスの層
      ["#ffe3a1", "#ffd166", "#d9a53a"],
      ["#a8ecd8", "#7be0c4", "#43b394"],
      ["#b3ddff", "#7cc8ff", "#4a95d9"],
      ["#ddccff", "#c6a8ff", "#9673e0"],
      ["#ffc4ad", "#ff9e7d", "#e0704a"],
    ],
  },
  glitter: {
    label: "きらきら",
    scoop: 30,
    weight: 0.35,
    rMin: 1.7, rMax: 3.1,
    restitution: 0.2,
    drag: 1.35,
    liquidDrag: 5.2,
    gravScale: 0.82,
    liquidGravScale: 0.10,   // 液中ではほぼ漂う
    collides: false,
    colors: [
      ["#fff3c9", "#ffd75e", "#e0a92e"],
      ["#ffffff", "#e8f4ff", "#9fc4e8"],   // シルバー
      ["#ffd4ea", "#ff9ec9", "#e06aa8"],
      ["#c9f4ff", "#8fd8ff", "#4aa8e0"],
      ["#e3d4ff", "#c9adff", "#9b78e8"],
    ],
  },
  petals: {
    label: "はなびら",
    scoop: 4,
    weight: 2.2,
    rMin: 8.5, rMax: 13.5,
    restitution: 0.05,
    drag: 2.4,             // ひらひら落ちる
    liquidDrag: 4.6,
    gravScale: 0.5,
    liquidGravScale: 0.12,
    collides: false,
    colors: [
      ["#ffe3ec", "#ffc7dd", "#f39cbe"],
      ["#ffd1e3", "#ffb3cf", "#ea8bb2"],
      ["#fff7d6", "#fff2b8", "#ecd982"],
      ["#ffe8d9", "#ffd9c2", "#f0ac8a"],
      ["#ffffff", "#fdeef4", "#e8c2d2"],
    ],
  },
  stars: {
    label: "おほしさま",
    scoop: 4,
    weight: 2.6,
    rMin: 7.0, rMax: 10.5,
    restitution: 0.38,
    drag: 0.35,
    liquidDrag: 3.0,
    gravScale: 0.95,
    liquidGravScale: 0.3,
    collides: true,
    colors: [
      ["#fff3c9", "#ffd75e", "#e0a92e"],
      ["#ffd4ea", "#ff9ec9", "#e06aa8"],
      ["#c9f4ff", "#8fd8ff", "#4aa8e0"],
      ["#e3d4ff", "#c9b1ff", "#9b78e8"],
      ["#d2f5e3", "#93e6bb", "#4ec290"],
    ],
  },
};

/* ゲージ満杯の重さ */
KKM.FULL_WEIGHT = 190;

/* 物理 */
KKM.PHYSICS = {
  GRAVITY: 300,          // 単位/s²（乾いた状態の基準）
  MAX_DT: 1 / 30,
  SUBSTEPS: 2,
  WALL_FRICTION: 0.86,   // 壁衝突時の接線速度の残存率
  CENTRIFUGAL: 0.11,     // 遠心力係数（回すと外に寄る）
  EULER_COUPLING: 0.55,  // 回し始め/止めで中身が遅れてついてくる係数
  SLEEP_SPEED: 2.2,
  TILT_GAIN: 1.35,       // 端末チルト → 重力方向の効き
};

/* 最初から入っているおためしレシピ */
KKM.STARTER = [
  ["beads", 2],
  ["glitter", 2],
  ["stars", 1],
];

/* localStorage キー */
KKM.SAVE_KEY = "kkm-recipe-v1";
KKM.SOUND_KEY = "kkm-sound-v1";
KKM.COACH_KEY = "kkm-coach-v1";
