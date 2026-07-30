/* ============================================================
   voxels.js — 巨大モチーフのボクセル生成
   純粋モジュール（three.js / DOM に依存しない。Node でも動く）。

   すべてのモチーフは「数式（陰関数）」または「手続き」で作るので、
   ブロック予算（budget）に応じて解像度が滑らかにスケールする。

   buildStageSpec(stage, seed, budget, rasterizeChar?) が返すもの：
   {
     blocks: [{ p:[x,y,z], g:[gx,gy,gz], c:[r,g,b], front:bool }],
     V,            // 1ブロックの一辺（ワールド単位）
     name, icon,
     devices,      // 置ける装置の数
     height, radius, count, motif,
   }
   rasterizeChar(char, rows) はブラウザ側が渡す文字ドット化関数
   （無ければ内蔵の数字ビットマップにフォールバック）。
   ============================================================ */

import { gridKey, keyToGxGyGz, findUnsupported } from './demolition.js';

// ---- シード付き乱数 ----
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- HSL → RGB（0..1）----
export function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  return [r + m, g + m, b + m];
}

/* ============================================================
   2D 陰関数シェイプ → 押し出し
   fn(u, v) は タグ文字列 か null を返す。v は上が正。
   ============================================================ */
function sampleShape(fn, uMin, uMax, vMin, vMax, rows) {
  const cellH = (vMax - vMin) / rows;
  const cols = Math.round((uMax - uMin) / cellH);
  const cells = [];
  for (let row = 0; row < rows; row++) {
    const v = vMin + (row + 0.5) * cellH;          // row 0 が下
    for (let col = 0; col < cols; col++) {
      const u = uMin + (col + 0.5) * ((uMax - uMin) / cols);
      const tag = fn(u, v);
      if (tag) cells.push({ gx: col, gy: row, tag });
    }
  }
  return { cells, cols, rows };
}

// 予算に合う rows を探して押し出す
function fitExtruded(fn, uMin, uMax, vMin, vMax, budget, depth) {
  let rows = 20;
  let flat = sampleShape(fn, uMin, uMax, vMin, vMax, rows);
  for (let i = 0; i < 3; i++) {
    const count = flat.cells.length * depth;
    const next = Math.max(10, Math.min(46, Math.round(rows * Math.sqrt(budget / Math.max(count, 1)))));
    if (next === rows) break;
    rows = next;
    flat = sampleShape(fn, uMin, uMax, vMin, vMax, rows);
  }
  const cells = [];
  for (const c of flat.cells) {
    for (let gz = 0; gz < depth; gz++) {
      cells.push({ gx: c.gx, gy: c.gy, gz, tag: c.tag, front: gz === depth - 1 });
    }
  }
  return { cells, cols: flat.cols, rows: flat.rows, depth };
}

const inCircle = (u, v, cx, cy, r) => (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
const inEllipse = (u, v, cx, cy, rx, ry) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1;

/* ============================================================
   モチーフ定義
   各関数は (budget, rng, opt) → { cells, cols, rows, depth, colorOf, name, icon, targetH }
   ============================================================ */

// 💖 ハート：陰関数 (x²+y²-1)³ - x²y³ ≤ 0
function motifHeart(budget, rng) {
  const fn = (u, v) => {
    const q = (u * u + v * v - 1) ** 3 - u * u * v * v * v;
    return q <= 0 ? 'body' : null;
  };
  const g = fitExtruded(fn, -1.25, 1.25, -1.05, 1.35, budget, 4);
  const baseHue = 335 + rng() * 20;
  return {
    ...g, name: 'おおきなハート', icon: '💖', targetH: 10,
    colorOf: (c, dims, jr) =>
      hsl(baseHue + jr * 10, 0.72, 0.5 + 0.22 * (c.gy / dims.rows) + jr * 0.04),
  };
}

// ⭐ おほしさま：5角星ポリゴンの内外判定
function makeStarPoly() {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.44;
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    pts.push([Math.sin(a) * r, -Math.cos(a) * r]);   // v は上が正
  }
  return pts;
}
function pointInPoly(pts, u, v) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > v) !== (yj > v) &&
        u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function motifStar(budget, rng) {
  const poly = makeStarPoly();
  const fn = (u, v) => (pointInPoly(poly, u, v) ? 'body' : null);
  const g = fitExtruded(fn, -1.05, 1.05, -0.9, 1.1, budget, 4);
  const baseHue = 44 + rng() * 8;
  return {
    ...g, name: 'おほしさま', icon: '⭐', targetH: 10.5,
    colorOf: (c, dims, jr) =>
      hsl(baseHue + jr * 8, 0.85, 0.58 + 0.12 * (c.gy / dims.rows) + jr * 0.05),
  };
}

// 🌈 にじのアーチ：半円の帯 6 本
const RAINBOW_HUES = [0, 30, 55, 130, 210, 275];
function motifRainbow(budget, rng) {
  const fn = (u, v) => {
    if (v < 0) return null;
    const r = Math.hypot(u, v);
    if (r < 0.52 || r > 1.0) return null;
    const band = Math.min(5, Math.floor((1.0 - r) / 0.08));
    return 'band' + band;
  };
  const g = fitExtruded(fn, -1.05, 1.05, 0, 1.05, budget, 4);
  return {
    ...g, name: 'にじのアーチ', icon: '🌈', targetH: 9,
    colorOf: (c, dims, jr) => {
      const band = parseInt(c.tag.slice(4), 10);
      return hsl(RAINBOW_HUES[band] + jr * 8, 0.78, 0.62 + jr * 0.04);
    },
  };
}

// 🌸 おはな：花びら6枚 + まんなか + くき + はっぱ
function motifFlower(budget, rng) {
  const headY = 0.42;
  const fn = (u, v) => {
    if (inCircle(u, v, 0, headY, 0.26)) return 'center';
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i / 6) * Math.PI * 2;
      if (inCircle(u, v, Math.cos(a) * 0.42, headY + Math.sin(a) * 0.42, 0.3))
        return 'petal' + (i % 2);
    }
    if (Math.abs(u) < 0.055 && v <= headY && v >= -1.0) return 'stem';
    // はっぱ：くき に ちゃんと つながる ように 内側まで のばす
    if (inEllipse(Math.abs(u), v, 0.24, -0.58, 0.3, 0.12)) return 'leaf';
    return null;
  };
  const g = fitExtruded(fn, -0.95, 0.95, -1.0, 1.2, budget, 3);
  const petalHueA = 325 + rng() * 15, petalHueB = 280 + rng() * 15;
  return {
    ...g, name: 'おおきなおはな', icon: '🌸', targetH: 11,
    colorOf: (c, dims, jr) => {
      if (c.tag === 'petal0') return hsl(petalHueA + jr * 8, 0.75, 0.68);
      if (c.tag === 'petal1') return hsl(petalHueB + jr * 8, 0.72, 0.7);
      if (c.tag === 'center') return hsl(47, 0.9, 0.62 + jr * 0.05);
      if (c.tag === 'leaf')   return hsl(125 + jr * 10, 0.55, 0.55);
      return hsl(125 + jr * 10, 0.5, 0.44);        // stem
    },
  };
}

// 🦋 ちょうちょ：4枚の羽 + 胴 + 模様
function motifButterfly(budget, rng) {
  const fn = (u, v) => {
    if (Math.abs(u) < 0.075 && v > -0.62 && v < 0.62) return 'body';
    const au = Math.abs(u);
    if (inCircle(au, v, 0.52, 0.32, 0.2)) return 'spot';
    if (inEllipse(au, v, 0.5, 0.3, 0.46, 0.4)) return 'wingU';
    if (inEllipse(au, v, 0.4, -0.34, 0.36, 0.33)) return 'wingL';
    return null;
  };
  const g = fitExtruded(fn, -1.0, 1.0, -0.75, 0.8, budget, 3);
  const hueU = 315 + rng() * 25, hueL = 260 + rng() * 20;
  return {
    ...g, name: 'ちょうちょ', icon: '🦋', targetH: 8.5,
    colorOf: (c, dims, jr) => {
      if (c.tag === 'body')  return hsl(28, 0.45, 0.36);
      if (c.tag === 'spot')  return hsl(48, 0.9, 0.66);
      if (c.tag === 'wingU') return hsl(hueU + jr * 10, 0.75, 0.66);
      return hsl(hueL + jr * 10, 0.68, 0.68);
    },
  };
}

// 🐰 うさぎ：あたま + からだ + みみ + かお
function motifBunny(budget, rng) {
  const fn = (u, v) => {
    const au = Math.abs(u);
    if (inCircle(au, v, 0.15, 0.22, 0.055)) return 'eye';
    if (inCircle(u, v, 0, 0.1, 0.05)) return 'nose';
    if (inCircle(au, v, 0.3, 0.06, 0.07)) return 'cheek';
    if (inEllipse(au, v, 0.17, 0.72, 0.1, 0.32)) return 'earIn';
    if (inEllipse(au, v, 0.17, 0.7, 0.16, 0.42)) return 'ear';
    if (inCircle(u, v, 0, 0.16, 0.42)) return 'head';
    if (inEllipse(u, v, 0, -0.52, 0.5, 0.42)) return 'body';
    return null;
  };
  const g = fitExtruded(fn, -0.75, 0.75, -0.95, 1.15, budget, 4);
  return {
    ...g, name: 'うさぎさん', icon: '🐰', targetH: 10.5,
    colorOf: (c, dims, jr) => {
      if (c.tag === 'eye')   return hsl(340, 0.2, 0.22);
      if (c.tag === 'nose')  return hsl(340, 0.75, 0.62);
      if (c.tag === 'cheek') return hsl(348, 0.85, 0.78);
      if (c.tag === 'earIn') return hsl(345, 0.8, 0.8);
      return hsl(28, 0.25, 0.9 + jr * 0.03);       // 白いからだ
    },
  };
}

/* ---- 3D 手続き系：セル集合を直接作る ---- */
function fit3D(genFn, budget) {
  let s = 0.8;
  let out = genFn(s);
  for (let i = 0; i < 3; i++) {
    const next = s * Math.cbrt(budget / Math.max(out.cells.length, 1));
    if (Math.abs(next - s) < 0.02) break;
    s = Math.max(0.45, Math.min(1.8, next));
    out = genFn(s);
  }
  return out;
}

// 🏰 巨大なおしろ：城壁 + 門 + 四隅の塔 + 天守
function motifCastle(budget, rng) {
  const gen = (s) => {
    const cells = [];
    const set = new Set();
    const put = (gx, gy, gz, tag) => {
      const k = gridKey(gx, gy, gz);
      if (gx < 0 || gy < 0 || gz < 0 || set.has(k)) return;
      set.add(k);
      cells.push({ gx, gy, gz, tag });
    };
    const S = Math.round(20 * s);            // 城壁の一辺
    const wallH = Math.round(4 * s) + 1;
    const gateW = Math.max(2, Math.round(2.4 * s));
    const gateH = Math.min(wallH - 1, Math.round(3 * s));
    // 城壁（正方形の外周、前面に門の穴）
    for (let i = 0; i < S; i++) {
      for (const [gx, gz] of [[i, 0], [i, S - 1], [0, i], [S - 1, i]]) {
        for (let gy = 0; gy < wallH; gy++) {
          const inGate = gz === S - 1 &&
            Math.abs(gx - (S - 1) / 2) <= gateW / 2 && gy < gateH;
          if (!inGate) put(gx, gy, gz, 'wall');
        }
        if ((i % 2) === 0) put(gx, wallH, gz, 'crenel');   // 狭間
      }
    }
    // 四隅の塔
    const tw = Math.max(3, Math.round(3.2 * s));
    const th = Math.round(9 * s);
    const corners = [[0, 0], [S - tw, 0], [0, S - tw], [S - tw, S - tw]];
    for (const [cx, cz] of corners) {
      for (let gx = cx; gx < cx + tw; gx++) {
        for (let gz = cz; gz < cz + tw; gz++) {
          for (let gy = 0; gy < th; gy++) put(gx, gy, gz, 'tower');
        }
      }
      // ピラミッド屋根
      for (let lvl = 0; lvl <= Math.ceil(tw / 2); lvl++) {
        for (let gx = cx + lvl; gx < cx + tw - lvl; gx++) {
          for (let gz = cz + lvl; gz < cz + tw - lvl; gz++) {
            put(gx, th + lvl, gz, 'roof');
          }
        }
      }
    }
    // 中央の天守（2段）
    const kw = Math.max(4, Math.round(6 * s));
    const kx = Math.round((S - kw) / 2);
    const kh = Math.round(7 * s);
    for (let gx = kx; gx < kx + kw; gx++) {
      for (let gz = kx; gz < kx + kw; gz++) {
        for (let gy = 0; gy < kh; gy++) put(gx, gy, gz, 'keep');
      }
    }
    const kw2 = Math.max(3, Math.round(3.5 * s));
    const kx2 = Math.round((S - kw2) / 2);
    const kh2 = Math.round(12 * s);
    for (let gx = kx2; gx < kx2 + kw2; gx++) {
      for (let gz = kx2; gz < kx2 + kw2; gz++) {
        for (let gy = kh; gy < kh2; gy++) put(gx, gy, gz, 'keep');
      }
    }
    for (let lvl = 0; lvl <= Math.ceil(kw2 / 2); lvl++) {
      for (let gx = kx2 + lvl; gx < kx2 + kw2 - lvl; gx++) {
        for (let gz = kx2 + lvl; gz < kx2 + kw2 - lvl; gz++) {
          put(gx, kh2 + lvl, gz, 'roof');
        }
      }
    }
    let maxY = 0, maxX = 0, maxZ = 0;
    for (const c of cells) {
      maxY = Math.max(maxY, c.gy); maxX = Math.max(maxX, c.gx); maxZ = Math.max(maxZ, c.gz);
    }
    return { cells, cols: maxX + 1, rows: maxY + 1, depth: maxZ + 1 };
  };
  const g = fit3D(gen, budget);
  return {
    ...g, name: 'おおきなおしろ', icon: '🏰', targetH: 11,
    colorOf: (c, dims, jr) => {
      if (c.tag === 'roof')   return hsl(338 + jr * 8, 0.65, 0.66);
      if (c.tag === 'crenel') return hsl(40, 0.25, 0.9);
      if (c.tag === 'keep')   return hsl(38 + jr * 6, 0.42, 0.8 + jr * 0.03);
      if (c.tag === 'tower')  return hsl(30 + jr * 6, 0.4, 0.74 + jr * 0.03);
      return hsl(42 + jr * 6, 0.38, 0.78 + jr * 0.03);   // wall
    },
  };
}

// 🗼 ちょうこうそうタワー：だんだん細くなる塔 + とんがり
function motifTower(budget, rng) {
  const gen = (s) => {
    const cells = [];
    const tiers = [
      { w: Math.round(8 * s), h: Math.round(8 * s) },
      { w: Math.round(6 * s), h: Math.round(8 * s) },
      { w: Math.round(4 * s), h: Math.round(7 * s) },
      { w: Math.max(2, Math.round(2 * s)), h: Math.round(5 * s) },
    ];
    const cx = Math.round(8 * s / 2);
    let y = 0;
    for (const t of tiers) {
      const x0 = cx - Math.floor(t.w / 2);
      for (let gy = y; gy < y + t.h; gy++) {
        for (let gx = x0; gx < x0 + t.w; gx++) {
          for (let gz = x0; gz < x0 + t.w; gz++) {
            // 中まで ぎっしり：爆弾のクレーターが 断面を けずって
            // 上の階が まるごと 落ちる「パンケーキ崩壊」ができる
            cells.push({ gx, gy, gz, tag: 'body' });
          }
        }
      }
      y += t.h;
    }
    // とんがり
    for (let lvl = 0; lvl < 3; lvl++) {
      cells.push({ gx: cx, gy: y + lvl, gz: cx, tag: 'spire' });
    }
    let maxX = 0, maxZ = 0;
    for (const c of cells) { maxX = Math.max(maxX, c.gx); maxZ = Math.max(maxZ, c.gz); }
    return { cells, cols: maxX + 1, rows: y + 3, depth: maxZ + 1 };
  };
  const g = fit3D(gen, budget);
  return {
    ...g, name: 'のっぽタワー', icon: '🗼', targetH: 13,
    colorOf: (c, dims, jr) => {
      if (c.tag === 'spire') return hsl(47, 0.9, 0.62);
      return hsl((c.gy / dims.rows) * 300 + jr * 10, 0.72, 0.64 + jr * 0.03);
    },
  };
}

/* ---- 文字・数字 ---- */
// 内蔵 5x7 数字フォント（Node テスト用フォールバック）
const DIGIT_FONT = {
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '..##.', '.#...', '#....', '#####'],
  '3': ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
};
function bitmapToGrid(lines, rows) {
  // lines（上から下）→ rows 行に最近傍拡大した boolean[row][col]（上から下）
  const h = lines.length, w = lines[0].length;
  const k = Math.max(1, Math.floor(rows / h));
  const grid = [];
  for (let r = 0; r < h * k; r++) {
    const src = lines[Math.floor(r / k)];
    const rowArr = [];
    for (let c = 0; c < w * k; c++) rowArr.push(src[Math.floor(c / k)] === '#');
    grid.push(rowArr);
  }
  return grid;
}
const CHAR_LIST = ['あ', '1', 'い', '2', 'う', '3'];
function motifChar(budget, rng, opt) {
  const ch = CHAR_LIST[(opt.cycle || 0) % CHAR_LIST.length];
  const depth = 3;
  const makeGrid = (rows) => {
    let grid = null;
    if (opt.rasterizeChar) grid = opt.rasterizeChar(ch, rows);
    if (!grid) grid = bitmapToGrid(DIGIT_FONT[ch] || DIGIT_FONT['1'], rows);
    return grid;
  };
  const countOf = (grid) => {
    let n = 0;
    for (const row of grid) for (const cell of row) if (cell) n++;
    return n * depth;
  };
  // 文字ごとに 埋まり率が ちがうので、いちど作ってから 解像度を あわせる
  let rows = Math.max(12, Math.min(46, Math.round(Math.sqrt(budget / (0.32 * depth)))));
  let grid = makeGrid(rows);
  for (let i = 0; i < 2; i++) {
    const count = countOf(grid);
    if (count >= budget * 0.55 && count <= budget * 1.2) break;
    const next = Math.max(12, Math.min(46, Math.round(rows * Math.sqrt(budget / Math.max(count, 1)))));
    if (next === rows) break;
    rows = next;
    grid = makeGrid(rows);
  }
  const h = grid.length, w = grid[0].length;
  const cells = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!grid[r][c]) continue;
      const gy = h - 1 - r;                              // 上下反転（gy は上が大）
      for (let gz = 0; gz < depth; gz++) {
        cells.push({ gx: c, gy, gz, tag: 'body', front: gz === depth - 1 });
      }
    }
  }
  return {
    cells, cols: w, rows: h, depth,
    name: `「${ch}」`, icon: '🔤', targetH: 10,
    colorOf: (c, dims, jr) =>
      hsl((c.gy / dims.rows) * 300 + jr * 8, 0.75, 0.63 + jr * 0.03),
  };
}

/* ============================================================
   組み立て
   ============================================================ */
const MOTIFS = [
  motifHeart, motifStar, motifRainbow, motifFlower,
  motifButterfly, motifCastle, motifTower, motifBunny, motifChar,
];

/* ------------------------------------------------------------
   ゆりかご式展示台：
   ・全モチーフを 幅広の白い台座（PLATFORM_ROWS 段・輪郭+2 マス）にのせる
   ・さらに 形の下面の曲線に沿って 台を盛り上げ、形の すべての列を
     真下から支える（ハートの下すぼみも 星の谷も 台が受ける）
   → 1点接地が なくなり、厳格な支え判定でも 初期形状は崩れない。
   台座も ふつうに 壊せる積み木。
   ------------------------------------------------------------ */
const PLATFORM_ROWS = 2;
const PLATFORM_MARGIN = 2;

function addStand(cells) {
  const P = PLATFORM_ROWS, M = PLATFORM_MARGIN;
  // 列ごとの 形の最下段
  const colKey = (gx, gz) => gx * 4096 + gz;
  const colMin = new Map();
  for (const c of cells) {
    const k = colKey(c.gx, c.gz);
    const cur = colMin.get(k);
    if (cur === undefined || c.gy < cur) colMin.set(k, c.gy);
  }
  // 形を 上へ P、横へ M ずらして 台座ぶんの すきまを あける
  for (const c of cells) { c.gx += M; c.gz += M; c.gy += P; }
  const stand = [];
  // 台座（輪郭を M マス ふくらませた 板）
  const platCols = new Set();
  for (const k of colMin.keys()) {
    const gx = Math.floor(k / 4096), gz = k % 4096;
    for (let dx = -M; dx <= M; dx++) {
      for (let dz = -M; dz <= M; dz++) {
        platCols.add(colKey(gx + M + dx, gz + M + dz));
      }
    }
  }
  for (const k of platCols) {
    const gx = Math.floor(k / 4096), gz = k % 4096;
    if (gx < 0 || gz < 0) continue;
    for (let gy = 0; gy < P; gy++) stand.push({ gx, gy, gz, tag: 'stand' });
  }
  // ゆりかご（形の下面まで 台を盛り上げる）
  for (const [k, minGy] of colMin) {
    const gx = Math.floor(k / 4096) + M, gz = (k % 4096) + M;
    for (let gy = P; gy < minGy + P; gy++) stand.push({ gx, gy, gz, tag: 'stand' });
  }
  return stand;
}

/* 列の中に 縦の すきまが ある形（おはなの 葉と花びらの間 など）では、
   ゆりかごは 最下段までしか 届かない。のこった宙吊りセルの 真下に
   白い支え柱を 1段ずつ 伸ばして、すべてのセルを 支える。
   （博物館の 標本マウントの 支持棒の イメージ） */
function addSupportPillars(cells, stand) {
  const map = new Map();
  for (const c of cells) map.set(gridKey(c.gx, c.gy, c.gz), c);
  for (const c of stand) map.set(gridKey(c.gx, c.gy, c.gz), c);
  for (let iter = 0; iter < 60; iter++) {
    const orphans = findUnsupported(map);
    if (orphans.length === 0) break;
    let added = false;
    for (const key of orphans) {
      const [gx, gy, gz] = keyToGxGyGz(key);
      if (gy === 0) continue;
      const belowKey = gridKey(gx, gy - 1, gz);
      if (!map.has(belowKey)) {
        const cell = { gx, gy: gy - 1, gz, tag: 'stand' };
        map.set(belowKey, cell);
        stand.push(cell);
        added = true;
      }
    }
    if (!added) break;   // これ以上 伸ばせない（次の反復で 解決するはず）
  }
}

export function buildStageSpec(stage, seed, budget, rasterizeChar) {
  const idx = (stage - 1) % MOTIFS.length;
  const cycle = Math.floor((stage - 1) / MOTIFS.length);

  // 台座ぶんも 含めて 予算に収める（超えたら 形を少し小さくして 作り直し）
  let rng, m, stand;
  let effBudget = budget;
  for (let attempt = 0; attempt < 2; attempt++) {
    rng = mulberry32(seed);
    m = MOTIFS[idx](effBudget, rng, { cycle, rasterizeChar });
    let minY = Infinity;
    for (const c of m.cells) minY = Math.min(minY, c.gy);
    if (minY > 0) for (const c of m.cells) c.gy -= minY;
    stand = addStand(m.cells);
    addSupportPillars(m.cells, stand);
    const total = m.cells.length + stand.length;
    if (total <= budget * 1.3) break;
    effBudget = Math.max(250, Math.round((budget * budget) / total));
  }

  const P = PLATFORM_ROWS;
  const dims = { cols: m.cols, rows: m.rows, depth: m.depth };
  const V = Math.max(0.28, Math.min(0.8, m.targetH / m.rows));
  const all = [...stand, ...m.cells];

  // 中心合わせ用の 範囲
  let maxGx = 0, maxGz = 0;
  for (const c of all) {
    maxGx = Math.max(maxGx, c.gx);
    maxGz = Math.max(maxGz, c.gz);
  }

  const blocks = [];
  let maxYw = 0, maxRw = 0;
  for (const c of all) {
    const jr = rng() - 0.5;
    const x = (c.gx - maxGx / 2) * V;
    const y = c.gy * V + V / 2;
    const z = (c.gz - maxGz / 2) * V;
    const color = c.tag === 'stand'
      ? hsl(45, 0.16, 0.9 + jr * 0.04)
      : m.colorOf({ ...c, gy: c.gy - P }, dims, jr);
    blocks.push({
      p: [x, y, z],
      g: [c.gx, c.gy, c.gz],
      c: color,
      front: !!c.front,
      faceRoll: rng(),
    });
    maxYw = Math.max(maxYw, y + V / 2);
    maxRw = Math.max(maxRw, Math.hypot(x, z) + V);
  }

  return {
    blocks,
    V,
    name: m.name,
    icon: m.icon,
    devices: Math.max(10, Math.min(16, Math.round(blocks.length / 170))),
    height: maxYw,
    radius: maxRw,
    count: blocks.length,
    motif: idx,
    stage,
    seed,
  };
}
