/* build.js — 建築モード「じぶんでつくる」
 * マス目をタップしてブロックを積み、できた建物を自由設置の爆弾で解体する。
 */
(function () {
  'use strict';

  const { PALETTES, B, GROUND_Y } = window.GameLevels;
  const ui = window.GameUI;
  const audio = window.GameAudio;

  const COLS = 12, ROWS = 9;
  const PALS = [PALETTES.coral, PALETTES.lemon, PALETTES.mint, PALETTES.sky, PALETTES.lilac];
  const LEFT = -(COLS * B) / 2;

  const build = {
    layout: new Map(), /* "col,row" → パレット index */
    palIdx: 0,
    pstate: null,
    onStartDemolition: null, /* main.js が配線 */
  };

  const keyOf = (c, r) => c + ',' + r;

  function entries() {
    return [...build.layout].map(([k, pi]) => {
      const [col, row] = k.split(',').map(Number);
      return { col, row, palette: PALS[pi] };
    });
  }

  function baseLevel() {
    return {
      id: 'build', name: 'じぶんの ビル', sandbox: true,
      buildings: [{ x: 0, cols: COLS, rows: ROWS, palette: PALS[0] }],
      customBlocks: entries(),
      neighbors: [],
      sockets: [],
      zone: { l: LEFT - 160, r: -LEFT + 160 },
      dustGreen: 60,
      maxBombs: 5,
      minBombs: 1,
      hintPlace: 'ばくだんを おきたい ところを たっぷ！',
      hintBoom: 'ばくだんを たっぷ！',
    };
  }

  function refreshScene() {
    build.pstate = window.GamePhysics.buildLevel(
      Object.assign(baseLevel(), { buildGrid: { cols: COLS, rows: ROWS } }));
    window.GameRender.buildScene(build.pstate);
    ui.setBuildDoneEnabled(build.layout.size > 0);
  }

  /* 建築フェーズに入る（レイアウトは保持される） */
  build.enter = function () {
    refreshScene();
    ui.showBuildBar(PALS, build.palIdx, (i) => {
      build.palIdx = i;
      audio.play('tap');
    });
    ui.message('ますめを たっぷして ビルを たてよう！', 3000);
  };

  build.exit = function () {
    ui.hideBuildBar();
    ui.hideMessage();
  };

  build.clearAll = function () {
    build.layout.clear();
    refreshScene();
    audio.play('tap');
  };

  build.cellScreen = function (col, row) {
    return window.GameRender.screenPos(
      LEFT + col * B + B / 2,
      GROUND_Y - B / 2 - row * B
    );
  };

  function supported(col, row) {
    return row === 0 || build.layout.has(keyOf(col, row - 1));
  }

  build.tap = function (sx, sy) {
    let best = null, bestD = 46;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = build.cellScreen(c, r);
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (d < bestD) { best = { c, r }; bestD = d; }
      }
    }
    if (!best) return;
    const k = keyOf(best.c, best.r);
    if (build.layout.has(k)) {
      build.layout.delete(k);
      audio.play('tap');
    } else if (supported(best.c, best.r)) {
      build.layout.set(k, build.palIdx);
      audio.play('pop');
    } else {
      ui.message('したから じゅんばんに つもう！', 1600);
      return;
    }
    refreshScene();
  };

  /* できた！ → 解体フェーズへ */
  build.startDemolition = function () {
    if (build.layout.size === 0) return;
    ui.hideBuildBar();
    if (build.onStartDemolition) build.onStartDemolition(baseLevel());
  };

  window.GameBuild = build;
})();
