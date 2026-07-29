// ゲーム全体で共有するカタログ定義(座標は layout.js が担当)。

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
  maxAmount: 100,
  flowMin: 4.2,
  flowMax: 6.5,
  dotSpacing: 2.4,
  alphaScale: 4.6,
  fallTimeSec: 0.3,
  bleedChance: 0.07,
};
