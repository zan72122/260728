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

  // 基本地形: d = x+y の対角線ぞいに、奥(d小)から手前(d大)へ
  // 山ふもと→草地→浜→海、とゆるく高さが変わる。海岸線は u=x-y でうねる。
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = idx(x, y);
    const d = x + y, u = x - y;
    const dc = coastD(u);
    const noise = Math.sin(x * 0.55 + y * 0.75) * 0.03 + Math.sin(x * 1.3 - y * 0.6) * 0.02;
    if (d > dc) {
      // 海: 沖(dが大きい)へむかって深くなる
      h[i] = clamp(0.82 - (d - dc) * 0.16, 0.08, 0.82);
      type[i] = T_SEA;
    } else {
      const inland = dc - d;
      h[i] = 1.18 + inland * 0.062 + noise;
      if (inland < 2.6) { type[i] = T_SAND; h[i] = Math.min(h[i], 1.18 + inland * 0.11); }
      else type[i] = T_GRASS;
    }
  }

  // 奥の山なみ(画面いちばん奥の頂点 (0,0) まわり、d が小さいところ)
  addMound(h, 3, 4, 4.2, 2.2);
  addMound(h, 9, 2, 5.0, 2.5);
  addMound(h, 2, 11, 4.5, 2.1);
  addMound(h, 13, 4, 3.6, 1.7);

  World.springs = [];
  World.buildings = [];
  World.trees = [];
  World.flowers = [];

  // 川: 山のふもと(d小)から海(d大)へ、u をsinで振りながら d にそって下る
  const RIVER_U = 8, RIVER_AMP = 2.6, RIVER_FREQ = 0.35;
  function riverU(d) { return RIVER_U + RIVER_AMP * Math.sin(d * RIVER_FREQ); }
  function riverPoint(d) { const u = riverU(d); return [(d + u) / 2, (d - u) / 2]; }

  if (variant !== "c3") {
    const pts = [];
    for (let d = 12; d <= coastD(riverU(d)) + 3 && d < 60; d += 0.5) pts.push(riverPoint(d));
    carveRiver(h, type, pts, 0.9, 2.6, 0.7);
    const sp = riverPoint(12);
    World.springs.push({ x: sp[0], y: sp[1], rate: 0.026 });
  } else {
    // おだい3: とちゅうで切れた川(d 24〜34 のあいだは陸地のまま)。みぞでつなぐと海までとどく
    const pts1 = [], pts2 = [];
    for (let d = 12; d <= 24; d += 0.5) pts1.push(riverPoint(d));
    for (let d = 34; d <= coastD(riverU(d)) + 3 && d < 60; d += 0.5) pts2.push(riverPoint(d));
    carveRiver(h, type, pts1, 0.9, 2.6, 1.9);
    carveRiver(h, type, pts2, 0.9, 1.4, 0.7);
    const sp = riverPoint(12);
    World.springs.push({ x: sp[0], y: sp[1], rate: 0.07 });
  }

  // たかだい
  if (variant === "c2") {
    addPlateau(h, type, 15, 24, 2.6, 2.6, stairs);   // 海のちかくの ひくい たかだい
  } else {
    addPlateau(h, type, 11, 21, 2.8, 3.9, stairs);
  }

  // 山の頂上は岩、たかい所は色をかえる
  for (let i = 0; i < N; i++) {
    if (type[i] === T_GRASS && h[i] > 4.6) type[i] = T_ROCK;
  }

  World.h = h;
  World.type = type;
  World.stairs = stairs;
  World.baseH = h.slice();
  World.baseType = type.slice();
  World.variant = variant;
  World.undoStack = [];

  // 海マスク(生成時の海タイプ)
  const sm = new Uint8Array(N);
  for (let i = 0; i < N; i++) sm[i] = (type[i] === T_SEA) ? 1 : 0;
  World.seaMask = sm;

  // 建物(海と山のあいだの低地に)
  if (variant === "free") {
    addBuilding("house", 9, 15);
    addBuilding("house", 15, 19);
    addBuilding("shop", 6, 20);
    addBuilding("school", 11, 10);
  } else if (variant === "c1") {
    addBuilding("house", 19, 21);  // 海岸のすぐそば(波でぬれやすい)
    addBuilding("house", 22, 19);
  } else if (variant === "c2") {
    addBuilding("school", 14, 23); // 海ちかくの ひくいたかだいの上
  } else if (variant === "c3") {
    addBuilding("house", 17, 15);
  }

  // 木と花
  let guard = 0;
  while (World.trees.length < 15 && guard++ < 500) {
    const x = 1 + Math.floor(rand() * (GW - 2));
    const y = 1 + Math.floor(rand() * (GH - 2));
    const i = idx(x, y);
    if (type[i] !== T_GRASS && type[i] !== T_PLAT) continue;
    if (h[i] < 1.5 || h[i] > 4.6) continue;
    if (buildingAt(x, y)) continue;
    if (World.trees.some(t => Math.hypot(t.x - x, t.y - y) < 2.2)) continue;
    World.trees.push({ x: x + rand() * 0.6 - 0.3, y: y + rand() * 0.6 - 0.3, s: 0.8 + rand() * 0.5, ph: rand() * 6.28 });
  }
  guard = 0;
  while (World.flowers.length < 22 && guard++ < 500) {
    const x = 1 + Math.floor(rand() * (GW - 2));
    const y = 1 + Math.floor(rand() * (GH - 2));
    const i = idx(x, y);
    if (type[i] !== T_GRASS && type[i] !== T_PLAT) continue;
    if (buildingAt(x, y)) continue;
    World.flowers.push({ x: x + rand(), y: y + rand(), c: Math.floor(rand() * 3) });
  }
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
}

// ていぼう: ほそくて たかい かべ
function toolLevee(fx, fy) {
  const x = Math.round(fx), y = Math.round(fy);
  if (!inGrid(x, y)) return;
  if (inBuildingFootprint(x, y)) return; // 建物の下は地形を変えない
  const i = idx(x, y);
  if (World.seaMask[i] && World.baseH[i] < 0.5) return; // 沖には作れない
  if (World.type[i] === T_LEVEE) return;                // 二重に高くしない
  // ひとなぞりで しっかりした かべが立つ (いちばん大きな波より高く)
  World.h[i] = Math.min(CFG.MAX_H, Math.max(CFG.SEA_LEVEL + 2.0, Math.max(World.baseH[i], World.h[i]) + 2.2));
  World.type[i] = T_LEVEE;
  flattenBuildings();
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
}
