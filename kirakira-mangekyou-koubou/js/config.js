/* ═══════════════════════════════════════════════════════════
   config.js — 部品・素材・物理のチューニング定数
   「対称性・光・物体運動・不完全さを調整する」ための約40変数を
   すべてここに集約する。UI にはひらがなカードとしてだけ見せる。
   ═══════════════════════════════════════════════════════════ */
"use strict";

const KKM = window.KKM = {};

/* 論理チャンバー半径（物理はこの単位系で動く） */
KKM.CHAMBER_R = 100;

/* ── つつ（＝オブジェクト室の断面形。なかみの動きが変わる） ── */
KKM.TUBES = {
  round:  { label: "まるつつ",   desc: "ころころ" },
  square: { label: "しかくつつ", desc: "かどで カタン" },
  flat:   { label: "ぺちゃんこ", desc: "ぎゅっと つまる" },
  star:   { label: "ほしつつ",   desc: "くぼみに たまる" },
};

/* ── かがみのまい数 → 基本セクター角
   "p" は平行鏡（ずーっと鏡）：放射ではなく無限廊下モード ── */
KKM.MIRRORS = {
  2:   { label: "おほしさま鏡", desc: "おおきな もよう", sector: Math.PI / 3 },
  3:   { label: "いっぱい鏡",   desc: "おはな いっぱい", sector: Math.PI / 5 },
  4:   { label: "おへや鏡",     desc: "こまかい レース",  sector: Math.PI / 8 },
  p:   { label: "ずーっと鏡",   desc: "むげんの ろうか",  sector: null },
};
KKM.MIRROR_ORDER = ["2", "3", "4", "p"];

/* ── かがみのせいかく（光学特性）
   keep: 1回反射するごとに残る明るさ（減衰）
   tint: 反射のたびに寄っていく色
   ghost: 二重像 / blur: ぼかし / wave: 波打ち曲面 /
   scratch: キズの光線 / seethrough: 半透明ゴースト ── */
KKM.SKINS = {
  pika:   { label: "ぴかぴか鏡",   desc: "くっきり",  keep: 0.985, tint: null },
  fuwa:   { label: "ふわふわ鏡",   desc: "だぶって みえる",    keep: 0.93,  tint: [255, 234, 244], ghost: true },
  koori:  { label: "こおり鏡",     desc: "こおりの せかい",    keep: 0.90,  tint: [118, 168, 235] },
  oukan:  { label: "おうかん鏡",   desc: "きんの せかい",  keep: 0.90,  tint: [238, 182, 82] },
  yume:   { label: "ゆめ鏡",       desc: "ふんわり ゆめ",  keep: 0.94,  tint: [242, 222, 242], blur: true },
  kirari: { label: "きらり鏡",   desc: "ひかりの せん", keep: 0.95, tint: null, scratch: true },
  gunya:  { label: "ぐにゃ鏡",   desc: "ゆらゆら ゆれる", keep: 0.95, tint: null, wave: true },
  obake:  { label: "おばけ鏡",     desc: "すけて かさなる",    keep: 0.84,  tint: [188, 198, 226], seethrough: true },
};
KKM.SKIN_ORDER = ["pika", "fuwa", "koori", "oukan", "yume", "kirari", "gunya", "obake"];

/* ── ひかりのフタ ── */
KKM.LIGHTS = {
  asa:    { label: "あさのひかり", desc: "しろい ひかり" },
  yuyake: { label: "ゆうやけ",     desc: "きんいろの そら" },
  yoru:   { label: "よるのひかり", desc: "ラメが ひかる" },
  niji:   { label: "にじのひかり", desc: "にじが まわる" },
  yoko:   { label: "よこのひかり", desc: "かげが のびる" },
};
KKM.LIGHT_ORDER = ["asa", "yuyake", "yoru", "niji", "yoko"];

/* ── のぞきあな（視野の枠） ── */
KKM.HOLES = {
  maru:  { label: "まるいあな",  desc: "まんまる" },
  hoshi: { label: "ほしのあな",  desc: "ほしの まど" },
  heart: { label: "はーとのあな", desc: "はーとの まど" },
};

/* ── レンズ ── */
KKM.LENSES = {
  futsu:   { label: "ふつうレンズ", desc: "そのまま" },
  mushi:   { label: "むしめがね",   desc: "おおきく みえる" },
  sakana:  { label: "さかなめ",     desc: "まんなか ぷくっ" },
  pinboke: { label: "ぴんぼけ",     desc: "ゆめみたい" },
};

/* ずらしスライダー(-1..1) → 1セクターあたりの角度誤差（ラジアン）
   最大 ±3.2度。積み重なって「つなぎ目の破れ」になる */
KKM.SKEW_MAX = 3.2 * Math.PI / 180;

/* 素材ごとの定義 */
KKM.MATERIALS = {
  beads: {
    label: "びーず",
    scoop: 5,
    weight: 3,
    rMin: 6.2, rMax: 10.8,
    restitution: 0.46,
    drag: 0.25,
    liquidDrag: 3.1,
    gravScale: 1.0,
    liquidGravScale: 0.34,
    collides: true,
    colors: [
      ["#ffb7cf", "#ff8fb3", "#d95c8a"],
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
    liquidGravScale: 0.10,
    collides: false,
    colors: [
      ["#fff3c9", "#ffd75e", "#e0a92e"],
      ["#ffffff", "#e8f4ff", "#9fc4e8"],
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
    drag: 2.4,
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
  GRAVITY: 300,
  MAX_DT: 1 / 30,
  SUBSTEPS: 2,
  WALL_FRICTION: 0.86,
  CENTRIFUGAL: 0.11,
  EULER_COUPLING: 0.55,
  SLEEP_SPEED: 2.2,
  TILT_GAIN: 1.35,
};

/* 組み立てガイドの順番（はじめてのときだけ光る） */
KKM.GUIDE_ORDER = ["tube", "mirror", "skin", "fill", "light", "hole"];

/* 最初から入っているおためしレシピ */
KKM.STARTER = [
  ["beads", 2],
  ["glitter", 2],
  ["stars", 1],
];

/* localStorage キー */
KKM.SAVE_KEY = "kkm-recipe-v2";
KKM.SOUND_KEY = "kkm-sound-v1";
KKM.COACH_KEY = "kkm-coach-v1";
KKM.GUIDE_KEY = "kkm-guide-v1";
