/* levels.js — 6ステージのレベルデータ
 * 座標はワールド座標（地面 y=600、x=0 がシーン中央）。
 * building: cols×rows のブロック積み。socket の row は 0 が最下段、col は小数で中間位置も可。
 */
(function () {
  'use strict';

  const B = 44; /* ブロック1個の大きさ */

  const PALETTES = {
    cream:  { wall: '#f6d78b', shade: '#e0b95e', win: '#8fd3f4' },
    mint:   { wall: '#a8e6cf', shade: '#7fc8a9', win: '#fff6c9' },
    coral:  { wall: '#ffb3a7', shade: '#e58f83', win: '#d3f1ff' },
    lilac:  { wall: '#cdb4f0', shade: '#a98fd6', win: '#fff1b8' },
    sky:    { wall: '#a3d5ff', shade: '#7cb4e8', win: '#fffbe0' },
    lemon:  { wall: '#fdf3a6', shade: '#e3d777', win: '#bfe9ff' },
  };

  const LEVELS = [
    {
      id: 1, name: 'ちいさなビル', emoji: '🏠',
      buildings: [{ x: 0, cols: 3, rows: 4, palette: PALETTES.cream }],
      neighbors: [],
      sockets: [{ b: 0, col: 1, row: 0 }],
      zone: { l: -300, r: 300 },
      dustGreen: 55,
      hintPlace: 'ひかるところを たっぷ！',
      hintBoom: 'ばくだんを たっぷ！',
      tutorial: true,
    },
    {
      id: 2, name: 'のっぽビル', emoji: '🏢',
      buildings: [{ x: 0, cols: 2, rows: 8, palette: PALETTES.mint }],
      neighbors: [],
      sockets: [{ b: 0, col: 0.5, row: 0 }, { b: 0, col: 0.5, row: 4 }],
      zone: { l: -320, r: 320 },
      dustGreen: 80,
      hintPlace: 'ひかるところを たっぷ！',
      hintBoom: 'したから じゅんばんに！',
    },
    {
      id: 3, name: 'となりにおうち', emoji: '🏡',
      buildings: [{ x: -70, cols: 3, rows: 6, palette: PALETTES.coral }],
      neighbors: [{ x: 270, w: 170, h: 140, color: '#ffe0a3', roof: '#e07a5f' }],
      sockets: [{ b: 0, col: 0, row: 0 }, { b: 0, col: 0, row: 3 }],
      zone: { l: -460, r: 118 },
      dustGreen: 60,
      clearRatio: 0.5, /* がれきの山を少しゆるめに許容 */
      hintPlace: 'ひかるところを たっぷ！',
      hintBoom: 'おうちの ないほうへ たおそう！',
    },
    {
      id: 4, name: 'ふたごタワー', emoji: '🏢',
      buildings: [
        { x: -200, cols: 2, rows: 6, palette: PALETTES.lilac },
        { x: 200, cols: 2, rows: 6, palette: PALETTES.sky },
      ],
      neighbors: [],
      sockets: [{ b: 0, col: 0.5, row: 0 }, { b: 1, col: 0.5, row: 0 }],
      zone: { l: -420, r: 420 },
      dustGreen: 70,
      clearRatio: 0.58, /* 爆弾1個/棟なので高さ判定はゆるめ */
      hintPlace: 'ひかるところを たっぷ！',
      hintBoom: 'ひとつずつ ゆっくりね！',
    },
    {
      id: 5, name: 'はさまれビル', emoji: '🏬',
      buildings: [{ x: 0, cols: 2, rows: 8, palette: PALETTES.lemon }],
      neighbors: [
        { x: -225, w: 160, h: 205, color: "#d9f2c8", roof: "#5a9367" },
        { x: 225, w: 160, h: 205, color: "#ffd9e8", roof: "#c05780" },
      ],
      sockets: [{ b: 0, col: 0.5, row: 0 }, { b: 0, col: 0.5, row: 4 }],
      zone: { l: -128, r: 128 },
      dustGreen: 60,
      hintPlace: 'ひかるところを たっぷ！',
      hintBoom: 'まんなかから まっすぐ したへ！',
    },
    {
      id: 6, name: 'おおきなタワー', emoji: '🏙️',
      buildings: [{ x: -60, cols: 4, rows: 9, palette: PALETTES.sky }],
      neighbors: [{ x: 420, w: 170, h: 150, color: '#ffe0a3', roof: '#e07a5f' }],
      sockets: [
        { b: 0, col: 1.5, row: 0 },
        { b: 0, col: 1.5, row: 3 },
        { b: 0, col: 1.5, row: 6 },
      ],
      zone: { l: -440, r: 260 },
      dustGreen: 110,
      clearRatio: 0.5, /* がれきの山を少しゆるめに許容 */
      hintPlace: 'ひかるところを たっぷ！',
      hintBoom: 'したから じゅんばんに ゆっくり！',
    },
  ];

  /* ---------- そざい（マテリアル）と ブラシ ----------
   * ブラシID: 0..4 = いろいたブロック（normal素材、いろちがい）
   *           5..8 = そざいブロック（いし・き・ゴム・ガラス）
   * MATERIALS: 物理特性（density/friction/restitution）と くだけやすさ(crumble)
   *   crumble はぶつかった速さがこれを超えると砕けてほこりになる（Infinity＝くだけない） */
  const MATERIALS = {
    normal: { density: 0.001,  friction: 0.9, restitution: 0.02, crumble: 6 },
    stone:  { density: 0.002,  friction: 1.0, restitution: 0.01, crumble: 9 },
    wood:   { density: 0.0006, friction: 0.8, restitution: 0.05, crumble: 7 },
    rubber: { density: 0.0008, friction: 0.9, restitution: 0.75, crumble: Infinity },
    glass:  { density: 0.001,  friction: 0.4, restitution: 0.05, crumble: 2.5 },
  };

  /* BRUSHES[p].material が無ければ 'normal'（見た目は PALETTES と同じ色情報） */
  const BRUSHES = [
    PALETTES.coral, PALETTES.lemon, PALETTES.mint, PALETTES.sky, PALETTES.lilac,
    { wall: '#9a9a94', shade: '#7d7d78', win: '#cfe6f5', material: 'stone' },
    { wall: '#b98352', shade: '#96693f', win: '#e8c99a', material: 'wood' },
    { wall: '#ff9ec7', shade: '#e078a8', win: '#ffd6ea', material: 'rubber' },
    { wall: '#bfe6ef', shade: '#8fc7d8', win: '#e8f8fb', material: 'glass' },
  ];

  window.GameLevels = { LEVELS, PALETTES, MATERIALS, BRUSHES, B, GROUND_Y: 600 };
})();
