/* build.js — 建築モード「じぶんでつくる」
 * なぞり描き（ドラッグでスタンプ連打）＋ ブラシサイズ（1/2x2/4x4/8x8）＋
 * けしゴムツール ＋ 自動柱（浮いたブロックの下を同色で充填）＋ もどす（1段階undo）
 * ＋ かたち（四角/三角/丸）＋ そざい（いろ/いし/き/ゴム/ガラス）＋ 3レイヤー（おく/なか/まえ）
 */
(function () {
  'use strict';

  const { BRUSHES, B, GROUND_Y } = window.GameLevels;
  const ui = window.GameUI;
  const audio = window.GameAudio;

  const COLS = 48, ROWS = 24, LAYERS = 3;
  const MAX_BLOCKS = 600;
  const LEFT = -(COLS * B) / 2;
  const DEFAULT_LAYER = 1; /* 「なか」から始める */

  const build = {
    layout: new Map(), /* "col,row,layer" → { p: ブラシindex(0..8), s: かたち('sq'|'tri'|'cir') } */
    palIdx: 0,
    shape: 'sq',
    mode: 'draw',      /* 'draw' | 'erase' */
    brush: 1,          /* 1 | 2 | 4 | 8 */
    activeLayer: DEFAULT_LAYER,
    pstate: null,
    stroke: false,
    lastPt: null,
    lastCellKey: null,
    undoSnap: null,
    lastPopT: 0,
    lastFullMsgT: 0,
    onStartDemolition: null, /* main.js が配線 */

    /* 公開定数（他エージェント用の契約） */
    COLS, ROWS, LAYERS,
  };

  const keyOf = (c, r, l) => c + ',' + r + ',' + l;
  const cellX = (c) => LEFT + c * B + B / 2;
  const cellY = (r) => GROUND_Y - B / 2 - r * B;
  const layerZ = (l) => (l - 1) * B * 1.12;

  /* ---------- セル操作 ---------- */
  function applyCellVisual(c, r, layer, brushOrNull) {
    let hasWindow = false;
    if (brushOrNull) {
      const look = BRUSHES[brushOrNull.p] || BRUSHES[0];
      hasWindow = (!look.material || look.material === 'normal') && (r + c) % 2 === 0 && r > 0;
    }
    window.GameRender.setEditBlock(
      keyOf(c, r, layer), cellX(c), cellY(r), layer,
      brushOrNull, hasWindow
    );
  }

  function warnFull() {
    const now = performance.now();
    if (now - build.lastFullMsgT > 1000) {
      ui.message('ブロックが いっぱい！', 1500);
      build.lastFullMsgT = now;
    }
  }

  function setCell(c, r, layer, brushOrNull) {
    const k = keyOf(c, r, layer);
    const cur = build.layout.has(k) ? build.layout.get(k) : null;
    if (!cur && !brushOrNull) return false;
    if (cur && brushOrNull && cur.p === brushOrNull.p && cur.s === brushOrNull.s) return false;
    if (brushOrNull == null) {
      build.layout.delete(k);
    } else {
      if (!cur && build.layout.size >= MAX_BLOCKS) {
        warnFull();
        return false;
      }
      build.layout.set(k, { p: brushOrNull.p, s: brushOrNull.s });
    }
    applyCellVisual(c, r, layer, brushOrNull);
    return true;
  }

  function cellFromScreen(sx, sy) {
    const w = window.GameRender.worldFromScreen(sx, sy, layerZ(build.activeLayer));
    const c = Math.floor((w.x - LEFT) / B);
    const r = Math.floor((GROUND_Y - w.y) / B);
    if (c < -1 || c > COLS || r < -1 || r > ROWS) return null; /* 遠すぎる */
    return {
      c: Math.max(0, Math.min(COLS - 1, c)),
      r: Math.max(0, Math.min(ROWS - 1, r)),
    };
  }

  /* ブラシサイズ分のスタンプ（描く/けす）＋ 自動柱（アクティブレイヤーに対して機能） */
  function stampAt(c, r) {
    const n = build.brush;
    const layer = build.activeLayer;
    const brush = { p: build.palIdx, s: build.shape };
    const cs = c - Math.floor((n - 1) / 2);
    const rs = r - Math.floor((n - 1) / 2);
    let changed = false;
    for (let cc = cs; cc < cs + n; cc++) {
      if (cc < 0 || cc >= COLS) continue;
      for (let rr = rs; rr < rs + n; rr++) {
        if (rr < 0 || rr >= ROWS) continue;
        if (build.mode === 'erase') {
          if (build.layout.has(keyOf(cc, rr, layer))) changed = setCell(cc, rr, layer, null) || changed;
        } else {
          changed = setCell(cc, rr, layer, brush) || changed;
        }
      }
      /* 自動柱：スタンプの下の空マスを同じブラシで地面まで充填（アクティブレイヤーのみ） */
      if (build.mode === 'draw') {
        for (let rr = Math.max(0, rs) - 1; rr >= 0; rr--) {
          if (build.layout.has(keyOf(cc, rr, layer))) break;
          changed = setCell(cc, rr, layer, brush) || changed;
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
    build.saveUndo();
    build.stroke = true;
    build.lastPt = { sx, sy };
    build.lastCellKey = keyOf(cell.c, cell.r, build.activeLayer);
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
      const k = keyOf(cell.c, cell.r, build.activeLayer);
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

  build.pickShape = function (s) {
    build.shape = s;
    audio.play('tap');
    ui.setShapeSel(s);
  };

  build.pickLayer = function (layer) {
    if (layer === build.activeLayer) return;
    build.activeLayer = layer;
    audio.play('tap');
    window.GameRender.setActiveLayer(layer);
    ui.setLayerSel(layer);
  };

  /* もどす（1段階。もう一度おすと元に戻る） */
  build.saveUndo = function () {
    build.undoSnap = new Map(build.layout);
  };

  build.undo = function () {
    if (!build.undoSnap) return;
    const target = build.undoSnap;
    build.undoSnap = new Map(build.layout);
    const keys = new Set([...build.layout.keys(), ...target.keys()]);
    for (const k of keys) {
      const [c, r, layer] = k.split(',').map(Number);
      const want = target.has(k) ? target.get(k) : null;
      setCell(c, r, layer, want);
    }
    audio.play('tap');
    afterEdit();
  };

  build.clearAll = function () {
    if (build.layout.size === 0) return;
    build.saveUndo();
    for (const k of [...build.layout.keys()]) {
      const [c, r, layer] = k.split(',').map(Number);
      setCell(c, r, layer, null);
    }
    audio.play('tap');
    afterEdit();
  };

  /* ---------- 公開API（他エージェント用の契約） ---------- */
  build.setCellAt = function (c, r, layer, brushOrNull) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS || layer < 0 || layer >= LAYERS) return false;
    const changed = setCell(c, r, layer, brushOrNull);
    if (changed) afterEdit(); /* できた!ボタンの有効状態も更新 */
    return changed;
  };

  build.getCell = function (c, r, layer) {
    const v = build.layout.get(keyOf(c, r, layer));
    return v ? { p: v.p, s: v.s } : null;
  };

  build.cellScreen = function (col, row, layer) {
    if (layer == null) layer = build.activeLayer;
    return window.GameRender.screenPos(cellX(col), cellY(row), layerZ(layer));
  };

  /* ---------- レベル生成 ---------- */
  function baseLevel() {
    const blocks = [...build.layout].map(([k, v]) => {
      const [col, row, layer] = k.split(',').map(Number);
      return { col, row, layer, brushP: v.p, shape: v.s };
    });
    /* 建物の実際の範囲にカメラを寄せる（レイヤーに関わらず col/row の範囲で判定） */
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
      buildings: [{ x: 0, cols: COLS, rows: ROWS, palette: BRUSHES[0] }],
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
      buildings: [{ x: 0, cols: COLS, rows: ROWS, palette: BRUSHES[0] }],
      customBlocks: [],
      neighbors: [], sockets: [],
      zone: { l: LEFT - 160, r: -LEFT + 160 },
      dustGreen: 60,
      buildGrid: { cols: COLS, rows: ROWS },
    });
    window.GameRender.buildScene(build.pstate);
    window.GameRender.setActiveLayer(build.activeLayer);
    /* 既存レイアウトを描き直す（全レイヤー） */
    for (const [k, v] of build.layout) {
      const [c, r, layer] = k.split(',').map(Number);
      applyCellVisual(c, r, layer, v);
    }
    build.stroke = false;
    ui.showBuildBar({
      brushes: BRUSHES,
      palIdx: build.palIdx,
      mode: build.mode,
      brush: build.brush,
      shape: build.shape,
      layer: build.activeLayer,
      onColor: build.pickColor,
      onEraser: build.pickEraser,
      onBrush: build.pickBrush,
      onShape: build.pickShape,
      onLayer: build.pickLayer,
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

  /* できた！ → 解体フェーズへ */
  build.startDemolition = function () {
    if (build.layout.size === 0) return;
    ui.hideBuildBar();
    if (build.onStartDemolition) build.onStartDemolition(baseLevel());
  };

  window.GameBuild = build;
})();
