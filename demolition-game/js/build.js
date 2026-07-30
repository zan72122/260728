/* build.js — 建築モード「じぶんでつくる」
 * なぞり描き（ドラッグでスタンプ連打）＋ ブラシサイズ（1/2x2/4x4/8x8）＋
 * けしゴムツール ＋ 自動柱（浮いたブロックの下を同色で充填）＋ もどす（1段階undo）
 */
(function () {
  'use strict';

  const { PALETTES, B, GROUND_Y } = window.GameLevels;
  const ui = window.GameUI;
  const audio = window.GameAudio;

  const COLS = 20, ROWS = 12;
  const PALS = [PALETTES.coral, PALETTES.lemon, PALETTES.mint, PALETTES.sky, PALETTES.lilac];
  const LEFT = -(COLS * B) / 2;

  const build = {
    layout: new Map(), /* "col,row" → パレット index */
    palIdx: 0,
    mode: 'draw',      /* 'draw' | 'erase' */
    brush: 1,          /* 1 | 2 | 4 | 8 */
    pstate: null,
    stroke: false,
    lastPt: null,
    lastCellKey: null,
    undoSnap: null,
    lastPopT: 0,
    onStartDemolition: null, /* main.js が配線 */
  };

  const keyOf = (c, r) => c + ',' + r;
  const cellX = (c) => LEFT + c * B + B / 2;
  const cellY = (r) => GROUND_Y - B / 2 - r * B;

  /* ---------- セル操作 ---------- */
  function applyCellVisual(c, r, piOrNull) {
    window.GameRender.setEditBlock(
      keyOf(c, r), cellX(c), cellY(r),
      piOrNull == null ? null : PALS[piOrNull],
      (r + c) % 2 === 0 && r > 0
    );
  }

  function setCell(c, r, piOrNull) {
    const k = keyOf(c, r);
    const cur = build.layout.has(k) ? build.layout.get(k) : null;
    if (cur === piOrNull) return false;
    if (piOrNull == null) build.layout.delete(k);
    else build.layout.set(k, piOrNull);
    applyCellVisual(c, r, piOrNull);
    return true;
  }

  function cellFromScreen(sx, sy) {
    const w = window.GameRender.worldFromScreen(sx, sy);
    const c = Math.floor((w.x - LEFT) / B);
    const r = Math.floor((GROUND_Y - w.y) / B);
    if (c < -1 || c > COLS || r < -1 || r > ROWS) return null; /* 遠すぎる */
    return {
      c: Math.max(0, Math.min(COLS - 1, c)),
      r: Math.max(0, Math.min(ROWS - 1, r)),
    };
  }

  /* ブラシサイズ分のスタンプ（描く/けす）＋ 自動柱 */
  function stampAt(c, r) {
    const n = build.brush;
    const cs = c - Math.floor((n - 1) / 2);
    const rs = r - Math.floor((n - 1) / 2);
    let changed = false;
    for (let cc = cs; cc < cs + n; cc++) {
      if (cc < 0 || cc >= COLS) continue;
      for (let rr = rs; rr < rs + n; rr++) {
        if (rr < 0 || rr >= ROWS) continue;
        if (build.mode === 'erase') {
          if (build.layout.has(keyOf(cc, rr))) changed = setCell(cc, rr, null) || changed;
        } else {
          changed = setCell(cc, rr, build.palIdx) || changed;
        }
      }
      /* 自動柱：スタンプの下の空マスを同色で地面まで充填 */
      if (build.mode === 'draw') {
        for (let rr = Math.max(0, rs) - 1; rr >= 0; rr--) {
          if (build.layout.has(keyOf(cc, rr))) break;
          changed = setCell(cc, rr, build.palIdx) || changed;
        }
      }
    }
    if (changed) {
      const now = performance.now();
      if (now - build.lastPopT > 110) {
        audio.play(build.mode === 'erase' ? 'tap' : 'pop');
        build.lastPopT = now;
      }
    }
    return changed;
  }

  function afterEdit() {
    ui.setBuildDoneEnabled(build.layout.size > 0);
  }

  /* ---------- ストローク（なぞり描き） ---------- */
  build.strokeStart = function (sx, sy) {
    const cell = cellFromScreen(sx, sy);
    if (!cell) return;
    build.undoSnap = new Map(build.layout);
    build.stroke = true;
    build.lastPt = { sx, sy };
    build.lastCellKey = keyOf(cell.c, cell.r);
    stampAt(cell.c, cell.r);
    afterEdit();
  };

  build.strokeMove = function (sx, sy) {
    if (!build.stroke) return;
    const a = build.lastPt;
    const dist = Math.hypot(sx - a.sx, sy - a.sy);
    const steps = Math.min(60, Math.ceil(dist / 10)); /* 取りこぼし防止の線分補間 */
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const cell = cellFromScreen(a.sx + (sx - a.sx) * t, a.sy + (sy - a.sy) * t);
      if (!cell) continue;
      const k = keyOf(cell.c, cell.r);
      if (k === build.lastCellKey) continue;
      build.lastCellKey = k;
      stampAt(cell.c, cell.r);
    }
    build.lastPt = { sx, sy };
    afterEdit();
  };

  build.strokeEnd = function () {
    build.stroke = false;
    build.lastCellKey = null;
  };

  /* ---------- ツール ---------- */
  build.pickColor = function (i) {
    build.palIdx = i;
    build.mode = 'draw';
    audio.play('tap');
    ui.setBuildTool('draw', i);
  };

  build.pickEraser = function () {
    build.mode = 'erase';
    audio.play('tap');
    ui.setBuildTool('erase', build.palIdx);
  };

  build.pickBrush = function (n) {
    build.brush = n;
    audio.play('tap');
    ui.setBrushSel(n);
  };

  /* もどす（1段階。もう一度おすと元に戻る） */
  build.undo = function () {
    if (!build.undoSnap) return;
    const target = build.undoSnap;
    build.undoSnap = new Map(build.layout);
    const keys = new Set([...build.layout.keys(), ...target.keys()]);
    for (const k of keys) {
      const [c, r] = k.split(',').map(Number);
      const want = target.has(k) ? target.get(k) : null;
      setCell(c, r, want);
    }
    audio.play('tap');
    afterEdit();
  };

  build.clearAll = function () {
    if (build.layout.size === 0) return;
    build.undoSnap = new Map(build.layout);
    for (const k of [...build.layout.keys()]) {
      const [c, r] = k.split(',').map(Number);
      setCell(c, r, null);
    }
    audio.play('tap');
    afterEdit();
  };

  /* ---------- レベル生成 ---------- */
  function baseLevel() {
    const blocks = [...build.layout].map(([k, pi]) => {
      const [col, row] = k.split(',').map(Number);
      return { col, row, palette: PALS[pi] };
    });
    /* 建物の実際の範囲にカメラを寄せる */
    let minC = Infinity, maxC = -Infinity, maxR = 0;
    for (const [k] of build.layout) {
      const [c, r] = k.split(',').map(Number);
      minC = Math.min(minC, c);
      maxC = Math.max(maxC, c);
      maxR = Math.max(maxR, r);
    }
    const minX = LEFT + minC * B - 60;
    const maxX = LEFT + (maxC + 1) * B + 60;
    return {
      id: 'build', name: 'じぶんの ビル', sandbox: true,
      buildings: [{ x: 0, cols: COLS, rows: ROWS, palette: PALS[0] }],
      customBlocks: blocks,
      neighbors: [],
      sockets: [],
      zone: { l: minX - 130, r: maxX + 130 },
      viewBounds: { minX, maxX, topY: GROUND_Y - (maxR + 1) * B - 230 },
      dustGreen: 60,
      maxBombs: 8,
      minBombs: 1,
      hintPlace: 'ばくだんを おきたい ところを たっぷ！',
      hintBoom: 'ばくだんを たっぷ！',
    };
  }

  /* 建築フェーズに入る（レイアウトは保持される） */
  build.enter = function () {
    build.pstate = window.GamePhysics.buildLevel({
      id: 'build-edit', name: 'じぶんの ビル', sandbox: true,
      buildings: [{ x: 0, cols: COLS, rows: ROWS, palette: PALS[0] }],
      customBlocks: [],
      neighbors: [], sockets: [],
      zone: { l: LEFT - 160, r: -LEFT + 160 },
      dustGreen: 60,
      buildGrid: { cols: COLS, rows: ROWS },
    });
    window.GameRender.buildScene(build.pstate);
    /* 既存レイアウトを描き直す */
    for (const [k, pi] of build.layout) {
      const [c, r] = k.split(',').map(Number);
      applyCellVisual(c, r, pi);
    }
    build.stroke = false;
    ui.showBuildBar({
      palettes: PALS,
      palIdx: build.palIdx,
      mode: build.mode,
      brush: build.brush,
      onColor: build.pickColor,
      onEraser: build.pickEraser,
      onBrush: build.pickBrush,
      onUndo: build.undo,
    });
    ui.message('なぞって ビルを かこう！', 3000);
    afterEdit();
  };

  build.exit = function () {
    build.stroke = false;
    ui.hideBuildBar();
    ui.hideMessage();
  };

  build.cellScreen = function (col, row) {
    return window.GameRender.screenPos(cellX(col), cellY(row));
  };

  /* できた！ → 解体フェーズへ */
  build.startDemolition = function () {
    if (build.layout.size === 0) return;
    ui.hideBuildBar();
    if (build.onStartDemolition) build.onStartDemolition(baseLevel());
  };

  window.GameBuild = build;
})();
