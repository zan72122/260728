// ============================================================
// みずみちラボ - 水シミュレーション
//   ・低いほうへ流れる ・障害物でせき止まる ・細い流路に沿う
// ============================================================
"use strict";

const Water = {
  w: null,          // 水量
  wet: null,        // ぬれた度合い (0..1, ゆっくり乾く)
  surge: 0,         // 大波による海面の上乗せ
  surgeT: -1,       // 波イベントの経過時間 (-1 = なし)
  flowGlow: null,   // 流れの強さ(きらきら用)
};

function waterInit() {
  const N = CFG.GW * CFG.GH;
  Water.w = new Float32Array(N);
  Water.wet = new Float32Array(N);
  Water.flowGlow = new Float32Array(N);
  Water.surge = 0; Water.surgeT = -1;
  // 海に水を満たす
  for (let i = 0; i < N; i++) {
    if (World.seaMask[i]) Water.w[i] = Math.max(0, CFG.SEA_LEVEL - World.h[i]);
  }
}

function clearLandWater() {
  const N = CFG.GW * CFG.GH;
  for (let i = 0; i < N; i++) {
    if (!World.seaMask[i]) Water.w[i] = 0;
    Water.wet[i] = 0;
    Water.flowGlow[i] = 0;
  }
  Water.surge = 0; Water.surgeT = -1;
}

function startWave(power) {
  Water.surgeT = 0;
  Water.surgePower = power || 1.0;
  Sound.waveSwell();
  Mascot.react("wow");
}

// 大波の高さカーブ: ふわっと上がり、ゆっくり引く
function surgeCurve(t, p) {
  if (t < 1.6) return p * (t / 1.6) * (t / 1.6);
  if (t < 4.2) return p;
  if (t < 8.2) return p * (1 - (t - 4.2) / 4);
  return 0;
}

function waterStep(dt, now) {
  const GW = CFG.GW, GH = CFG.GH, N = GW * GH;
  const h = World.h, w = Water.w, sea = World.seaMask;

  // 大波イベント
  if (Water.surgeT >= 0) {
    Water.surgeT += dt;
    Water.surge = surgeCurve(Water.surgeT, Water.surgePower);
    if (Water.surgeT > 8.4) { Water.surgeT = -1; Water.surge = 0; }
  }

  // 海面を固定(波のときは高くなる)。アクティブ(画面に映る)セルだけ処理して負荷を抑える。
  const seaLv = CFG.SEA_LEVEL + Water.surge + Math.sin(now * 0.0016) * 0.03;
  for (let i = 0; i < N; i++) {
    if (!Iso.isActive(i)) continue; // 画面外は存在しない扱い
    if (sea[i]) w[i] = Math.max(0, seaLv - h[i]);
  }

  // 湧き水(アクティブなセルのみ)
  for (const s of World.springs) {
    const i = idx(Math.round(s.x), Math.round(s.y));
    if (i < 0 || i >= N) continue;
    if (!Iso.isActive(i)) continue;
    if (!sea[i]) w[i] += s.rate;
  }

  // 流れ: 表面高が低いほうへ。自セルか相手セルが非アクティブなペアは流さない(画面外は無いもの扱い)。
  const k = CFG.FLOW;
  for (let iter = 0; iter < CFG.WATER_ITER; iter++) {
    for (let y = 0; y < GH; y++) {
      const yo = y * GW;
      for (let x = 0; x < GW; x++) {
        const i = yo + x;
        if (!Iso.isActive(i)) continue; // 画面外セルは早期continueで負荷を抑える
        const wi = w[i];
        if (wi <= 0.0005) continue;
        const si = h[i] + wi;
        // 4近傍との差(近傍も非アクティブなら相手にしない)
        let d0 = 0, d1 = 0, d2 = 0, d3 = 0, total = 0;
        if (x > 0)      { const j = i - 1;  if (Iso.isActive(j)) { const d = si - (h[j] + w[j]); if (d > 0) { d0 = d; total += d; } } }
        if (x < GW - 1) { const j = i + 1;  if (Iso.isActive(j)) { const d = si - (h[j] + w[j]); if (d > 0) { d1 = d; total += d; } } }
        if (y > 0)      { const j = i - GW; if (Iso.isActive(j)) { const d = si - (h[j] + w[j]); if (d > 0) { d2 = d; total += d; } } }
        if (y < GH - 1) { const j = i + GW; if (Iso.isActive(j)) { const d = si - (h[j] + w[j]); if (d > 0) { d3 = d; total += d; } } }
        if (total <= 0) continue;
        let move = Math.min(wi, total * 0.5) * k;
        if (move > wi) move = wi;
        w[i] -= move;
        if (d0) w[i - 1]  += move * d0 / total;
        if (d1) w[i + 1]  += move * d1 / total;
        if (d2) w[i - GW] += move * d2 / total;
        if (d3) w[i + GW] += move * d3 / total;
        Water.flowGlow[i] = Math.min(1, Water.flowGlow[i] + move * 1.6);
      }
    }
  }

  // 蒸発・ぬれ記録・きらきら減衰(アクティブなセルのみ)
  const wet = Water.wet, glow = Water.flowGlow;
  for (let i = 0; i < N; i++) {
    if (!Iso.isActive(i)) continue;
    if (!sea[i]) {
      if (w[i] > 0) {
        w[i] -= CFG.EVAP;
        if (w[i] < 0) w[i] = 0;
      }
      if (w[i] > CFG.WET_DEPTH) wet[i] = Math.min(1, wet[i] + 0.06);
      else if (wet[i] > 0) wet[i] = Math.max(0, wet[i] - 0.0006);
    }
    glow[i] *= 0.94;
  }

  // 建物のぬれ判定(足もとのアクティブなセルだけ見る。建物は通常つねにアクティブ領域の中)
  for (const b of World.buildings) {
    let d = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      if (!inGrid(b.x + dx, b.y + dy)) continue;
      const i = idx(b.x + dx, b.y + dy);
      if (!Iso.isActive(i)) continue;
      d = Math.max(d, w[i]);
    }
    const wetNow = d > 0.12;
    if (wetNow && b.wet < 0.5) Sound.boing();
    if (wetNow) b.everWet = true;   // おだいの判定用 (いちどでも ぬれたか)
    b.wet = wetNow ? Math.min(1, b.wet + 0.08) : Math.max(0, b.wet - 0.01);
  }
}

// 水面の高さ(なめらか表示用)
function waterSurfaceAt(x, y) {
  return World.h[idx(x, y)] + Water.w[idx(x, y)];
}
