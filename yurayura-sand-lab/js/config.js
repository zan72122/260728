// ゲーム全体で共有する定数・カタログ定義。
// 数値はすべてステージ論理座標(900x1200)基準。

export const STAGE = { W: 900, H: 1200 };

/** 床に敷く「かみ」の領域 */
export const PAPER = { x: 80, y: 250, w: 740, h: 880, r: 40 };

/** カップを吊るすフックの位置 */
export const ANCHOR = { x: STAGE.W / 2, y: 44 };

/** カップの静止位置(かみの中心) */
export const HOME = { x: PAPER.x + PAPER.w / 2, y: PAPER.y + PAPER.h / 2 };

/** 振り子の可動範囲(かみの内側に収める楕円半径) */
export const LIMITS = { rx: PAPER.w / 2 - 45, ry: PAPER.h / 2 - 45 };

/** カップをつかめる判定半径(子ども向けに大きめ) */
export const GRAB_RADIUS = 110;

/** そっと押すときの強さと上限速度 */
export const PUSH = { impulse: 240, maxSpeed: 1500, cooldownSec: 0.25 };

export const CUP = { w: 66, h: 64 };

/** すなの種類。kind が描画スタイルを決める。
 *  kind: 'sand'=色砂 / 'rainbow'=色が巡る / 'star'=きらきら星くず / 'sugar'=粉砂糖 */
export const SAND_TYPES = [
  { id: 'strawberry', label: 'いちご',   emoji: '🍓', color: '#f97ba8', kind: 'sand' },
  { id: 'soda',       label: 'そーだ',   emoji: '🫧', color: '#54b8ef', kind: 'sand' },
  { id: 'lemon',      label: 'れもん',   emoji: '🍋', color: '#f7c948', kind: 'sand' },
  { id: 'melon',      label: 'めろん',   emoji: '🍈', color: '#6fd695', kind: 'sand' },
  { id: 'grape',      label: 'ぶどう',   emoji: '🍇', color: '#a58ae0', kind: 'sand' },
  { id: 'rainbow',    label: 'にじ',     emoji: '🌈', color: '#ff9ecb', kind: 'rainbow' },
  { id: 'stardust',   label: 'ほしくず', emoji: '⭐', color: '#f3c045', kind: 'star' },
  { id: 'sugar',      label: 'こなゆき', emoji: '❄️', color: '#ffffff', kind: 'sugar' },
];

/** かみ(床の紙)。dark な紙では砂を明るく重ねる。 */
export const PAPERS = [
  { id: 'cream',  label: 'くりーむ', bg: '#fbf0dc', dark: false },
  { id: 'mizu',   label: 'みずいろ', bg: '#e0f1fb', dark: false },
  { id: 'sakura', label: 'さくら',   bg: '#fbe7ef', dark: false },
  { id: 'mint',   label: 'みんと',   bg: '#e3f6e9', dark: false },
  { id: 'yoru',   label: 'よるのそら', bg: '#252a52', dark: true },
];

/** あそびの小目標(ほしバッジ)。条件判定は main.js 側。 */
export const BADGES = [
  { id: 'first',  label: 'はじめての もよう', emoji: '🌀' },
  { id: 'colors', label: 'いろを みっつ',     emoji: '🎨' },
  { id: 'mist',   label: 'きりの まほう',     emoji: '🌫️' },
  { id: 'empty',  label: 'カップ からっぽ',   emoji: '🥤' },
  { id: 'five',   label: 'いっぱい ゆらした', emoji: '⭐' },
];

/** すなの流量・堆積のチューニング値 */
export const SAND_TUNING = {
  maxAmount: 100,          // カップ満タン時の砂量
  flowMin: 4.2,            // 1秒あたりの流出量(最小)
  flowMax: 6.5,            // 1秒あたりの流出量(最大)
  dotSpacing: 2.6,         // 堆積ドットの間隔(px)
  alphaScale: 3.2,         // 流出量→ドット不透明度の係数
  fallTimeSec: 0.3,        // 粒が床に届くまでの時間
  bleedChance: 0.07,       // にじみハロが出る確率
};
