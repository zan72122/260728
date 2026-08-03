// ============================================================
// みずみちラボ - 地形 (ハイトマップ・マップ生成・編集ツール)
// ============================================================
"use strict";

const World = {
  h: null, type: null,        // 現在の地形
  baseH: null, baseType: null,// 初期状態(けしゴムで戻す先)
  seaMask: null,              // 海のセル(水位を海面に固定)
  stairs: null,               // かいだんを描く列
  buildings: [],              // {kind, x, y, wet, happy}
  trees: [], flowers: [],     // デコ {x, y, s, c}
  springs: [],                // 湧き水 {x, y, rate}
  variant: "free",            // マップの種類
  undoStack: [],
  terrainRev: 0,               // 地形(h/type)が変わるたびに増える。render.js のセルいろキャッシュの無効化に使う
};

function idx(x, y) { return y * CFG.GW + x; }
function inGrid(x, y) { return x >= 0 && x < CFG.GW && y >= 0 && y < CFG.GH; }

// ---------- マップ生成 ----------
// FULLSCREEN_SPEC §2: 構図は Render.view(スクリーン空間)を基準に決める。
// d = x + y は「おくゆき」(0に近いほど画面いちばん奥=山なみ、大きいほど画面手前=海)、
// u = x - y は「よこはば」(画面横方向。u が同じセルはだいたい同じ画面x)。
// 画面の高さに対する割合で各地形帯の位置を決めるので、画面の縦横比が変わっても
// 構図(海岸線の高さ・山の帯など)の見た目の比率が保たれる。

function addMound(h, cx, cy, r, amp) {
  for (let y = 0; y < CFG.GH; y++) for (let x = 0; x < CFG.GW; x++) {
    const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy) * 1.35;
    h[idx(x, y)] += amp * Math.exp(-d2 / (r * r));
  }
}

// たかだい: まんなかは平ら、ふちはすとんと落ちる
function addPlateau(h, type, cx, cy, r, top, stairs) {
  for (let y = 0; y < CFG.GH; y++) for (let x = 0; x < CFG.GW; x++) {
    const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy) * 1.3);
    if (d < r + 1.6) {
      const i = idx(x, y);
      const t = clamp((r + 1.6 - d) / 1.6, 0, 1); // ふち → 上面
      const target = lerp(h[i], top, Math.min(1, t * t * 1.25));
      if (target > h[i]) h[i] = target;
      if (d < r + 0.7 && h[i] > CFG.SEA_LEVEL + 0.4) type[i] = T_PLAT;
    }
  }
  // かいだんの列 (みなみがわ)
  if (stairs) {
    const sx = Math.round(cx);
    for (let y = Math.round(cy); y <= Math.min(CFG.GH - 1, Math.round(cy + r + 2)); y++) {
      stairs[idx(sx, y)] = 1;
    }
  }
}

function carveRiver(h, type, pts, width, bedFrom, bedTo) {
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const bed = lerp(bedFrom, bedTo, k / (n - 1));
    const px = pts[k][0], py = pts[k][1];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = Math.round(px + dx), y = Math.round(py + dy);
      if (!inGrid(x, y)) continue;
      const d = Math.hypot(px - x, py - y);
      if (d > width + 0.8) continue;
      const i = idx(x, y);
      const t = clamp((width + 0.8 - d) / 0.9, 0, 1);
      const target = lerp(h[i], bed, Math.min(1, t));
      if (target < h[i]) h[i] = target;
      if (d <= width && type[i] !== T_SEA) type[i] = T_RIVER;
    }
  }
}

function genMap(variant) {
  const GW = CFG.GW, GH = CFG.GH, N = GW * GH;
  const rand = makeRand(variant === "free" ? 12345 : variant === "c1" ? 777 : variant === "c2" ? 888 : 999);
  const h = new Float32Array(N);
  const type = new Uint8Array(N);
  const stairs = new Uint8Array(N);

  // Render.view はグローバル(main.js が Render.init → genMap の順でブートすることを保証)。
  const view = Render.view;
  const sw = view.w, sh = view.h;
  // もとのチューニング(GW=GH=34)からの拡大率。グリッド単位の「量」(半径・振幅など)は
  // これを掛け、「割合」(高さの傾き・波の周波数)はこれで割って、物理(画面)サイズを保つ。
  const SCALE = GW / 34;

  // 画面の上端(y=0)・下端(y=sh)に対応する対角線値
  const d0 = Iso.gridDiagAtY(view, 0);
  const d1 = Iso.gridDiagAtY(view, sh);
  const dSpan = d1 - d0;

  // 海岸線: 画面の高さ72%の位置を基準に、よこはば(u=x-y)でうねらせる
  const dCoastBase = Iso.gridDiagAtY(view, sh * 0.72);
  function coastD(u) {
    const un = u / SCALE;
    return dCoastBase + Math.sin(un * 0.31) * 1.4 * SCALE + Math.sin(un * 0.13 + 2.1) * 1.2 * SCALE;
  }

  // 山なみの帯(画面上端 20%)
  const mountainD = d0 + dSpan * 0.20;

  // 画面座標(sw*fx, sh*fy)→グリッド座標。中央寄りにクランプして、はしっこにはみ出ないようにする。
  function screenPt(fx, fy, margin) {
    const p = Iso.gridAtScreen(view, sw * fx, sh * fy);
    return [clamp(p.x, margin, GW - 1 - margin), clamp(p.y, margin, GH - 1 - margin)];
  }
  // 海に食い込みそうなら、d(おくゆき)を小さくして画面奥へ押し戻す(海のうえに建物・たかだいを置かない)
  function pullInland(cx, cy, margin) {
    const d = cx + cy, u = cx - cy;
    const limit = coastD(u) - margin;
    if (d > limit) {
      const shift = (d - limit) / 2;
      cx -= shift; cy -= shift;
    }
    return [clamp(cx, 1, GW - 2), clamp(cy, 1, GH - 2)];
  }

  // 基本地形: d=x+y の対角線ぞいに、奥(d小)から手前(d大)へ
  // 山ふもと→草地→浜→海、とゆるく高さが変わる。海岸線は u=x-y でうねる。
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = idx(x, y);
    const d = x + y, u = x - y;
    const dc = coastD(u);
    const noise = Math.sin(x * 0.55 + y * 0.75) * 0.03 + Math.sin(x * 1.3 - y * 0.6) * 0.02;
    if (d > dc) {
      // 海: 沖(dが大きい)へむかって深くなる。画面下端の全はばが海の帯になる
      const off = (d - dc) / SCALE;
      h[i] = clamp(0.82 - off * 0.16, 0.08, 0.82);
      type[i] = T_SEA;
    } else {
      const inland = (dc - d) / SCALE;
      h[i] = 1.18 + inland * 0.062 + noise;
      if (inland < 2.6) { type[i] = T_SAND; h[i] = Math.min(h[i], 1.18 + inland * 0.11); }
      else type[i] = T_GRASS;
    }
  }

  World.springs = [];
  World.buildings = [];
  World.trees = [];
  World.flowers = [];

  // 山なみ: addMound は中心の高さ(inland式の下地 + amp)ぶんだけ画面上へ
  // 持ち上がって見える(project の -h*eh)。中心をそのまま画面上端ちかくに置くと
  // 頂上が y<0 にはみ出て見えなくなるので、頂上のスクリーンy(=peakFy*sh)が
  // 画面高さ8〜16%になるよう、中心を頂上の高さぶん手前(画面下)へずらして置く。
  // (h*eh は中心の高さに依存し、中心の高さは置き場所[inland]に依存するので、
  //  数回の反復で収束させる)
  function mountainCenterFy(fx, peakFy, amp) {
    let fy = peakFy;
    for (let iter = 0; iter < 4; iter++) {
      const [cx0, cy0] = screenPt(fx, fy, 3);
      const d = cx0 + cy0, u = cx0 - cy0;
      const inland = Math.max(0, (coastD(u) - d) / SCALE);
      const hPeak = 1.18 + inland * 0.062 + amp;
      fy = peakFy + (hPeak * view.eh) / sh;
    }
    return fy;
  }

  // 山なみ本体: 画面上端の帯に3〜5個、よこ方向(u)にばらけさせて置く。
  // 峰(頂上)が画面高さ8〜16%あたりに見えるようにする。
  const mtCount = 3 + Math.floor(rand() * 3);
  for (let m = 0; m < mtCount; m++) {
    const fx = 0.10 + (m + 0.5) / mtCount * 0.80 + (rand() - 0.5) * 0.06;
    const r = (3.6 + rand() * 1.6) * SCALE;
    const amp = 1.7 + rand() * 1.0;
    const peakFy = 0.08 + rand() * 0.08;
    const fy = mountainCenterFy(fx, peakFy, amp);
    const [cx, cy] = screenPt(fx, fy, 6);
    addMound(h, cx, cy, r, amp);
  }

  // 画面上端の左右のかど(平らな草地のままだと山なみが途切れて見える)にも
  // 小さめの丘を置き、上辺ぜんたいが山なみとして読めるようにする。
  for (const fxCorner of [0.045, 0.955]) {
    const cornerAmp = 1.0 + rand() * 0.5;
    const cornerPeakFy = 0.03 + rand() * 0.05;
    const cornerFy = mountainCenterFy(fxCorner, cornerPeakFy, cornerAmp);
    const [ccx, ccy] = screenPt(fxCorner, cornerFy, 3);
    addMound(h, ccx, ccy, (2.4 + rand() * 0.8) * SCALE, cornerAmp);
  }

  // 川: 山の帯から海岸へ。u ≈ 画面右寄り1/3を基準に sin で蛇行しながら d を下る
  const riverBase = Iso.gridAtScreen(view, sw * 0.67, sh * 0.5);
  const RIVER_U0 = clamp(riverBase.x - riverBase.y, -GW * 0.45, GW * 0.45);
  const RIVER_AMP = 2.6 * SCALE, RIVER_FREQ = 0.35 / SCALE;
  function riverU(d) { return RIVER_U0 + RIVER_AMP * Math.sin(d * RIVER_FREQ); }
  function riverPoint(d) { const u = riverU(d); return [(d + u) / 2, (d - u) / 2]; }

  const dRiverStart = Math.max(3 * SCALE, mountainD + 2 * SCALE);
  const dMaxLimit = GW + GH;

  if (variant !== "c3") {
    const pts = [];
    for (let d = dRiverStart; d <= coastD(riverU(d)) + 3 * SCALE && d < dMaxLimit; d += 0.5) pts.push(riverPoint(d));
    carveRiver(h, type, pts, 0.9 * SCALE, 2.6, 0.7);
    const sp = riverPoint(dRiverStart);
    World.springs.push({ x: sp[0], y: sp[1], rate: 0.026 });
  } else {
    // おだい3: とちゅうで切れた川(川の道のりのまんなかあたりが陸地のまま)。みぞでつなぐと海までとどく
    const dCoastNear = coastD(riverU(dRiverStart));
    const riverSpan = Math.max(4, dCoastNear - dRiverStart);
    const dMid = dRiverStart + riverSpan * 0.42;
    const breakLen = Math.max(3 * SCALE, riverSpan * 0.26);
    const pts1 = [], pts2 = [];
    for (let d = dRiverStart; d <= dMid; d += 0.5) pts1.push(riverPoint(d));
    for (let d = dMid + breakLen; d <= coastD(riverU(d)) + 3 * SCALE && d < dMaxLimit; d += 0.5) pts2.push(riverPoint(d));
    carveRiver(h, type, pts1, 0.9 * SCALE, 2.6, 1.9);
    carveRiver(h, type, pts2, 0.9 * SCALE, 1.4, 0.7);
    const sp = riverPoint(dRiverStart);
    World.springs.push({ x: sp[0], y: sp[1], rate: 0.07 });
  }

  // たかだい: 画面左寄り中段。c2 は海のちかくに低くつくる(おだい2: 波がくると水がくる高さ)
  if (variant === "c2") {
    const rHigh = 2.6 * SCALE;
    const [hx, hy] = screenPt(0.42, 0.62, 6);
    const [px, py] = pullInland(hx, hy, rHigh + 2.6 * SCALE);
    addPlateau(h, type, px, py, rHigh, 2.6, stairs);
  } else {
    const rHigh = 2.8 * SCALE;
    const [hx, hy] = screenPt(0.30, 0.52, 6);
    const [px, py] = pullInland(hx, hy, rHigh + 2.6 * SCALE);
    addPlateau(h, type, px, py, rHigh, 3.9, stairs);
  }

  // 山の頂上は岩、たかい所は色をかえる
  for (let i = 0; i < N; i++) {
    if (type[i] === T_GRASS && h[i] > 4.6) type[i] = T_ROCK;
  }

  World.h = h;
  World.type = type;
  World.stairs = stairs;
  World.variant = variant;
  World.undoStack = [];

  // 建物: 画面座標の割合(fx,fy)から置き場所を決める。海の上になったら陸に直す
  function placeBuilding(kind, fx, fy, margin) {
    const [bx, by] = screenPt(fx, fy, 4);
    const [x, y] = pullInland(bx, by, margin);
    const rx = clamp(Math.round(x), 1, GW - 3), ry = clamp(Math.round(y), 1, GH - 3);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const gx = rx + dx, gy = ry + dy;
      if (!inGrid(gx, gy)) continue;
      const gi = idx(gx, gy);
      if (type[gi] === T_SEA) { type[gi] = T_SAND; h[gi] = Math.max(h[gi], CFG.SEA_LEVEL + 0.55); }
    }
    addBuilding(kind, rx, ry);
  }

  if (variant === "free") {
    // 家2・おみせ1・ほいくえん1 を町の中段に
    placeBuilding("house", 0.38, 0.44, 2.0 * SCALE);
    placeBuilding("house", 0.55, 0.50, 2.0 * SCALE);
    placeBuilding("shop", 0.30, 0.40, 2.0 * SCALE);
    placeBuilding("school", 0.62, 0.42, 2.0 * SCALE);
  } else if (variant === "c1") {
    // 家2軒を海岸近く(画面高さ60〜65%): 波でぬれやすい・堤防で守れる
    placeBuilding("house", 0.42, 0.60, 0.8 * SCALE);
    placeBuilding("house", 0.58, 0.645, 0.8 * SCALE);
  } else if (variant === "c2") {
    // ほいくえんを海ちかくの ひくいたかだいの上に
    placeBuilding("school", 0.42, 0.60, 2.0 * SCALE);
  } else if (variant === "c3") {
    placeBuilding("house", 0.46, 0.46, 2.0 * SCALE);
  }

  World.baseH = World.h.slice();
  World.baseType = World.type.slice();

  // 海マスク(建物ぶんの海→陸なおしを反映したあとの、生成時の海タイプ)
  const sm = new Uint8Array(N);
  for (let i = 0; i < N; i++) sm[i] = (World.type[i] === T_SEA) ? 1 : 0;
  World.seaMask = sm;

  // 木と花
  const treeSpacing = 2.2 * SCALE;
  let guard = 0;
  while (World.trees.length < 20 && guard++ < 800) {
    const x = 1 + Math.floor(rand() * (GW - 2));
    const y = 1 + Math.floor(rand() * (GH - 2));
    const i = idx(x, y);
    if (type[i] !== T_GRASS && type[i] !== T_PLAT) continue;
    if (h[i] < 1.5 || h[i] > 4.6) continue;
    if (buildingAt(x, y)) continue;
    if (World.trees.some(t => Math.hypot(t.x - x, t.y - y) < treeSpacing)) continue;
    World.trees.push({ x: x + rand() * 0.6 - 0.3, y: y + rand() * 0.6 - 0.3, s: 0.8 + rand() * 0.5, ph: rand() * 6.28 });
  }
  guard = 0;
  while (World.flowers.length < 30 && guard++ < 800) {
    const x = 1 + Math.floor(rand() * (GW - 2));
    const y = 1 + Math.floor(rand() * (GH - 2));
    const i = idx(x, y);
    if (type[i] !== T_GRASS && type[i] !== T_PLAT) continue;
    if (buildingAt(x, y)) continue;
    World.flowers.push({ x: x + rand(), y: y + rand(), c: Math.floor(rand() * 3) });
  }
  World.terrainRev++;
}

// ---------- 建物 ----------
function addBuilding(kind, x, y) {
  x = clamp(Math.round(x), 1, CFG.GW - 3);
  y = clamp(Math.round(y), 1, CFG.GH - 3);
  World.buildings.push({ kind, x, y, wet: 0, happy: 0, bob: 0 });
  flattenUnder(x, y);
}
function flattenUnder(x, y) {
  // 建物の下 2x2 をならす
  let avg = 0, c = 0;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    if (inGrid(x + dx, y + dy)) { avg += World.h[idx(x + dx, y + dy)]; c++; }
  }
  avg /= c;
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    if (inGrid(x + dx, y + dy)) World.h[idx(x + dx, y + dy)] = avg;
  }
  World.terrainRev++;
}
function buildingAt(x, y) {
  for (const b of World.buildings) {
    if (x >= b.x - 0.5 && x < b.x + 2.5 && y >= b.y - 0.5 && y < b.y + 2.5) return b;
  }
  return null;
}
// 建物の2x2フットプリント(b.x..b.x+1, b.y..b.y+1)ちょうどに乗っているか
function inBuildingFootprint(x, y) {
  for (const b of World.buildings) {
    if (x >= b.x && x <= b.x + 1 && y >= b.y && y <= b.y + 1) return true;
  }
  return false;
}
// 地形ツール適用後、建物の下がふたたび平らになるよう整える(次善策)
function flattenBuildings() {
  for (const b of World.buildings) flattenUnder(b.x, b.y);
  World.terrainRev++;
}
// (x,y) まわり3x3の baseH の最小値。掘削の床をこれで決めると、
// セルごとの初期ノイズに引きずられず溝の底がなめらかにつながる。
function localBaseFloor(x, y) {
  let m = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if (inGrid(nx, ny)) m = Math.min(m, World.baseH[idx(nx, ny)]);
  }
  return m;
}

// ---------- undo ----------
function pushUndo() {
  World.undoStack.push({
    h: World.h.slice(),
    type: World.type.slice(),
    stairs: World.stairs.slice(),
    buildings: World.buildings.map(b => ({ ...b })),
    springs: World.springs.map(s => ({ ...s })),
    trees: World.trees.map(t => ({ ...t })),
  });
  if (World.undoStack.length > 14) World.undoStack.shift();
}
function popUndo() {
  const s = World.undoStack.pop();
  if (!s) return false;
  World.h = s.h; World.type = s.type; World.stairs = s.stairs;
  World.buildings = s.buildings; World.springs = s.springs; World.trees = s.trees;
  World.terrainRev++;
  return true;
}

// ---------- 編集ツール ----------
// やま: 押している間もりもり育つ
function toolMountain(fx, fy, dt) {
  const r = 2.8;
  for (let y = Math.max(0, Math.floor(fy - r - 1)); y <= Math.min(CFG.GH - 1, Math.ceil(fy + r + 1)); y++) {
    for (let x = Math.max(0, Math.floor(fx - r - 1)); x <= Math.min(CFG.GW - 1, Math.ceil(fx + r + 1)); x++) {
      if (inBuildingFootprint(x, y)) continue; // 建物の下は地形を変えない
      const i = idx(x, y);
      if (World.seaMask[i]) continue;
      const d2 = (x - fx) * (x - fx) + (y - fy) * (y - fy);
      const add = 3.0 * dt * Math.exp(-d2 / (r * r * 0.55));
      if (add < 0.002) continue;
      World.h[i] = Math.min(5.8, World.h[i] + add);
      if (World.h[i] > 4.6 && (World.type[i] === T_GRASS || World.type[i] === T_SAND)) World.type[i] = T_ROCK;
      else if (World.h[i] > 1.4 && World.type[i] === T_SAND) World.type[i] = T_GRASS;
      if (World.type[i] === T_RIVER || World.type[i] === T_DITCH) World.type[i] = T_GRASS;
    }
  }
  flattenBuildings();
  World.terrainRev++;
}

// みぞ: 指でなぞって ほそいへこみ
function toolDitch(fx, fy) {
  const r = 1.1;
  for (let y = Math.max(0, Math.floor(fy - 2)); y <= Math.min(CFG.GH - 1, Math.ceil(fy + 2)); y++) {
    for (let x = Math.max(0, Math.floor(fx - 2)); x <= Math.min(CFG.GW - 1, Math.ceil(fx + 2)); x++) {
      if (inBuildingFootprint(x, y)) continue; // 建物の下は地形を変えない
      const i = idx(x, y);
      if (World.seaMask[i]) continue;
      const d = Math.hypot(x - fx, y - fy);
      if (d > r) continue;
      const dig = 0.9 * (1 - d / r);
      const floor = Math.max(0.35, localBaseFloor(x, y) - 1.1);
      World.h[i] = Math.max(floor, World.h[i] - dig * 0.55);
      if (d < 0.9 && World.type[i] !== T_RIVER) World.type[i] = T_DITCH;
    }
  }
  flattenBuildings();
  World.terrainRev++;
}

// かわ: ひろめに ほって みずいろの かわらに
function toolRiver(fx, fy) {
  const r = 1.5;
  for (let y = Math.max(0, Math.floor(fy - 2)); y <= Math.min(CFG.GH - 1, Math.ceil(fy + 2)); y++) {
    for (let x = Math.max(0, Math.floor(fx - 2)); x <= Math.min(CFG.GW - 1, Math.ceil(fx + 2)); x++) {
      if (inBuildingFootprint(x, y)) continue; // 建物の下は地形を変えない
      const i = idx(x, y);
      if (World.seaMask[i]) continue;
      const d = Math.hypot(x - fx, y - fy);
      if (d > r) continue;
      const dig = 1.15 * (1 - d / r);
      const floor = Math.max(0.4, localBaseFloor(x, y) - 1.35);
      World.h[i] = Math.max(floor, World.h[i] - dig * 0.6);
      if (d < 1.15) World.type[i] = T_RIVER;
    }
  }
  flattenBuildings();
  World.terrainRev++;
}

// ていぼう: ほそくて たかい かべ
function toolLevee(fx, fy) {
  const x = Math.round(fx), y = Math.round(fy);
  if (!inGrid(x, y)) return;
  if (inBuildingFootprint(x, y)) return; // 建物の下は地形を変えない
  const i = idx(x, y);
  if (World.seaMask[i] && World.baseH[i] < 0.5) return; // 沖には作れない
  if (World.type[i] === T_LEVEE) return;                // 二重に高くしない
  // ひとなぞりで しっかりした かべが立つ (海沿いはいちばん大きな波(水面最大2.7)より高い3.2を維持、
  // 山裾など高地では baseH+2.2 だと不自然に高い塔になるので +1.2 の控えめな壁にとどめる)
  const wallTop = Math.max(CFG.SEA_LEVEL + 2.2, Math.max(World.baseH[i], World.h[i]) + 1.2);
  World.h[i] = Math.min(CFG.MAX_H, wallTop);
  World.type[i] = T_LEVEE;
  flattenBuildings();
  World.terrainRev++;
}

// たかだい: たいらな おか + かいだん
function toolPlateau(fx, fy) {
  const r = 2.1, top = 3.3;
  for (let y = Math.max(0, Math.floor(fy - 4)); y <= Math.min(CFG.GH - 1, Math.ceil(fy + 4)); y++) {
    for (let x = Math.max(0, Math.floor(fx - 4)); x <= Math.min(CFG.GW - 1, Math.ceil(fx + 4)); x++) {
      if (inBuildingFootprint(x, y)) continue; // 建物の下は地形を変えない
      const i = idx(x, y);
      if (World.seaMask[i]) continue;
      const d = Math.hypot(x - fx, (y - fy) * 1.15);
      if (d > r + 1.4) continue;
      const t = clamp((r + 1.4 - d) / 1.4, 0, 1);
      const target = lerp(World.h[i], Math.max(World.h[i], top), Math.min(1, t * t * 1.3));
      if (target > World.h[i]) World.h[i] = target;
      if (d < r + 0.5 && World.h[i] > CFG.SEA_LEVEL + 0.6) World.type[i] = T_PLAT;
    }
  }
  // かいだんの列
  const sx = Math.round(fx);
  if (sx >= 0 && sx < CFG.GW) {
    for (let y = Math.round(fy); y <= Math.min(CFG.GH - 1, Math.round(fy + r + 2)); y++) {
      World.stairs[idx(sx, y)] = 1;
    }
  }
  flattenBuildings();
  World.terrainRev++;
}

// けしゴム: さいしょの じめんに もどす + ものを けす
function toolEraser(fx, fy) {
  const r = 1.7;
  for (let y = Math.max(0, Math.floor(fy - 3)); y <= Math.min(CFG.GH - 1, Math.ceil(fy + 3)); y++) {
    for (let x = Math.max(0, Math.floor(fx - 3)); x <= Math.min(CFG.GW - 1, Math.ceil(fx + 3)); x++) {
      const d = Math.hypot(x - fx, y - fy);
      if (d > r) continue;
      const i = idx(x, y);
      const t = clamp(1 - d / r, 0, 1);
      World.h[i] = lerp(World.h[i], World.baseH[i], Math.min(1, t * 1.6));
      if (t > 0.35) { World.type[i] = World.baseType[i]; World.stairs[i] = 0; }
    }
  }
  // ちかくの建物・木・湧き水も けす
  const b = buildingAt(Math.round(fx) - 0.5, Math.round(fy) - 0.5) || buildingAt(fx, fy);
  if (b) {
    World.buildings = World.buildings.filter(o => o !== b);
    Particles.poof((b.x + 1), (b.y + 1), World.h[idx(b.x, b.y)]);
    Sound.poof();
  }
  World.trees = World.trees.filter(t => Math.hypot(t.x - fx, t.y - fy) > r);
  World.springs = World.springs.filter(s => Math.hypot(s.x - fx, s.y - fy) > r);
  World.terrainRev++;
}
