// js/game/breads.js — Agent E
// 18品のパン定義。SPEC.md の表を厳守（id順・preset割当・forest kind割当）。
// このファイルは他モジュールに依存しない（純粋なデータ+アクセサ）。

/**
 * @typedef {Object} Bread
 * @property {string} id
 * @property {string} name         ひらがな表示名
 * @property {string} emoji        選択ボタン用
 * @property {string} presetId     DOUGH_PRESETS のキー
 * @property {'bake'|'fry'|'steam'} method
 * @property {string[]} fillings   絞り器に入る材料（空なら絞り器非表示）
 * @property {boolean} toppingable メロンパンのみ true
 * @property {string} hint         ひらがな1行のヒント
 * @property {{kind:string}} forest 森での役割
 */

/** @type {Bread[]} */
export const BREADS = [
  {
    id: 'shokupan',
    name: 'しょくぱん',
    emoji: '🍞',
    presetId: 'shokupan',
    method: 'bake',
    fillings: [],
    toppingable: false,
    hint: 'たいらに まとめて やいてみよう',
    forest: { kind: 'house' },
  },
  {
    id: 'yamashoku',
    name: 'やまがたしょくぱん',
    emoji: '🍞',
    presetId: 'shokupan',
    method: 'bake',
    fillings: [],
    toppingable: false,
    hint: 'ふたつに わけて やまがたに しよう',
    forest: { kind: 'mountain' },
  },
  {
    id: 'rollpan',
    name: 'ロールパン',
    emoji: '🥖',
    presetId: 'soft_yeast',
    method: 'bake',
    fillings: [],
    toppingable: false,
    hint: 'くるくる まるめて かたちを つくろう',
    forest: { kind: 'hill' },
  },
  {
    id: 'butterroll',
    name: 'バターロール',
    emoji: '🧈',
    presetId: 'soft_yeast',
    method: 'bake',
    fillings: ['butter'],
    toppingable: false,
    hint: 'しぼりきで バターを いれてね',
    forest: { kind: 'hill' },
  },
  {
    id: 'milkpan',
    name: 'ミルクパン',
    emoji: '🥛',
    presetId: 'soft_yeast',
    method: 'bake',
    fillings: [],
    toppingable: false,
    hint: 'やさしく まるめて ふっくら やこう',
    forest: { kind: 'cloud' },
  },
  {
    id: 'creampan',
    name: 'クリームパン',
    emoji: '🍮',
    presetId: 'soft_yeast',
    method: 'bake',
    fillings: ['cream'],
    toppingable: false,
    hint: 'しぼりきで クリームを いれてね',
    forest: { kind: 'flower' },
  },
  {
    id: 'anpan',
    name: 'あんパン',
    emoji: '🍥',
    presetId: 'soft_yeast',
    method: 'bake',
    fillings: ['anko'],
    toppingable: false,
    hint: 'しぼりきで あんこを いれてね',
    forest: { kind: 'stone' },
  },
  {
    id: 'jampan',
    name: 'ジャムパン',
    emoji: '🍓',
    presetId: 'soft_yeast',
    method: 'bake',
    fillings: ['jam'],
    toppingable: false,
    hint: 'しぼりきで ジャムを いれてね',
    forest: { kind: 'berry' },
  },
  {
    id: 'chocopan',
    name: 'チョコパン',
    emoji: '🍫',
    presetId: 'soft_yeast',
    method: 'bake',
    fillings: ['choco'],
    toppingable: false,
    hint: 'しぼりきで チョコを いれてね',
    forest: { kind: 'stump' },
  },
  {
    id: 'cheesepan',
    name: 'チーズパン',
    emoji: '🧀',
    presetId: 'soft_yeast',
    method: 'bake',
    fillings: ['cheese'],
    toppingable: false,
    hint: 'しぼりきで チーズを のせてね',
    forest: { kind: 'lantern' },
  },
  {
    id: 'raisinpan',
    name: 'レーズンパン',
    emoji: '🍇',
    presetId: 'soft_yeast',
    method: 'bake',
    fillings: ['raisin'],
    toppingable: false,
    hint: 'しぼりきで レーズンを ちらしてね',
    forest: { kind: 'pebbles' },
  },
  {
    id: 'animalpan',
    name: 'どうぶつパン',
    emoji: '🐻',
    presetId: 'soft_yeast',
    method: 'bake',
    fillings: ['choco'],
    toppingable: false,
    hint: 'みみを つくって どうぶつに しよう',
    forest: { kind: 'friend' },
  },
  {
    id: 'melonpan',
    name: 'メロンパン',
    emoji: '🍈',
    presetId: 'soft_yeast',
    method: 'bake',
    fillings: [],
    toppingable: true,
    hint: 'うわがけに もようを かいてね',
    forest: { kind: 'path' },
  },
  {
    id: 'croissant',
    name: 'クロワッサン',
    emoji: '🥐',
    presetId: 'croissant',
    method: 'bake',
    fillings: [],
    toppingable: false,
    hint: 'おりたたんで さんかくに のばそう',
    forest: { kind: 'moon' },
  },
  {
    id: 'cinnamonroll',
    name: 'シナモンロール',
    emoji: '🌀',
    presetId: 'croissant',
    method: 'bake',
    fillings: ['cinnamon'],
    toppingable: false,
    hint: 'くるくる まいて うずまきに しよう',
    forest: { kind: 'swirl' },
  },
  {
    id: 'donut',
    name: 'ドーナツ',
    emoji: '🍩',
    presetId: 'donut',
    method: 'fry',
    fillings: ['choco'],
    toppingable: false,
    hint: 'まんなかを ぎゅっと おして あなを あけよう',
    forest: { kind: 'pond' },
  },
  {
    id: 'pizza',
    name: 'ピザ',
    emoji: '🍕',
    presetId: 'bagel_pizza',
    method: 'bake',
    fillings: ['cheese'],
    toppingable: false,
    hint: 'まるく のばして チーズを のせよう',
    forest: { kind: 'sun' },
  },
  {
    id: 'mushipan',
    name: 'むしパン',
    emoji: '♨️',
    presetId: 'steamed',
    method: 'steam',
    fillings: [],
    toppingable: false,
    hint: 'ふっくら むして ふくらまそう',
    forest: { kind: 'mushroom' },
  },
];

/**
 * id からパン定義を取得する。
 * @param {string} id
 * @returns {Bread|undefined}
 */
export function getBread(id) {
  return BREADS.find((b) => b.id === id);
}
