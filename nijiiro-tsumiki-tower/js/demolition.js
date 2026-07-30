/* ============================================================
   demolition.js — 「触るまで凍結」解体方式の共有コア
   純粋モジュール（three.js / cannon / DOM に依存しない）。
   main.js と Node の物理テストが同じロジックを使う。

   方式の要点：
   - 全ブロックは最初「凍結」（固定・物理コストほぼゼロ）
   - 爆発・打撃・風が当たった部分だけ「動的」に変換
   - 凍結ブロックはボクセル格子で管理し、地面と繋がらなくなった
     塊は findUngrounded() で検出して落下させる（宙に浮く塊を防ぐ）
   - 眠った動的ブロックは再凍結（がれき化）して負荷から除外
   ============================================================ */

// ---- 物理チューニング ----
export const PHYS = {
  gravity: -13,
  frictionBlock: 0.5,
  frictionGround: 0.7,
  restitution: 0.05,
  sleepSpeedLimit: 0.4,
  sleepTimeLimit: 0.35,
  density: 2.2,          // 質量 = 体積 × density
};

// ---- 💣 ばくだん（ボクセル寸法 V に比例した効き）----
export function bombParams(V) {
  return {
    radius: V * 7.0,       // 吹き飛ばし半径
    breakRadius: V * 2.9,  // この中は 粉々になって消える（大きな穴 = 崩れの種）
    power: 9,              // インパルス係数（× 質量 × 距離減衰）
    upward: 0.95,          // 上向き成分（浮かせて摩擦から解放する）
  };
}

// 💣 1ブロックへの効果を計算する。
// 戻り値: null（圏外）| 'break'（粉砕）| [ix,iy,iz]（インパルス）
export function bombEffect(bp, center, pos, mass, rand01 = 0.5) {
  const dx = pos[0] - center[0], dy = pos[1] - center[1], dz = pos[2] - center[2];
  const d = Math.hypot(dx, dy, dz);
  if (d > bp.radius) return null;
  if (d < bp.breakRadius) return 'break';
  const falloff = 1 - d / bp.radius;
  let nx = dx / d, ny = dy / d, nz = dz / d;
  if (!isFinite(nx)) { nx = rand01 - 0.5; ny = 0.7; nz = 0.5 - rand01; }
  ny += bp.upward;
  const k = mass * bp.power * falloff;
  return [nx * k, ny * k, nz * k];
}

/* ---- ボクセル格子 ----
   キーは整数 1 個に詰める（gx,gy,gz は 0..4095）。 */
export function gridKey(gx, gy, gz) {
  return (gz * 4096 + gy) * 4096 + gx;
}
export function keyToGxGyGz(key) {
  const gx = key % 4096;
  const gy = ((key - gx) / 4096) % 4096;
  const gz = Math.floor(key / (4096 * 4096));
  return [gx, gy, gz];
}

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// 凍結ブロック集合（Map: gridKey -> なんでも）のうち、
// 「地面（gy===0）から 6近傍の繋がりで届かない」キーの配列を返す。
// = 支えを失って宙に浮いている塊。呼び出し側はこれを落下させる。
export function findUngrounded(gridMap) {
  const visited = new Set();
  const stack = [];
  for (const key of gridMap.keys()) {
    if (((key / 4096) | 0) % 4096 === 0) {   // gy === 0
      visited.add(key);
      stack.push(key);
    }
  }
  while (stack.length) {
    const k = stack.pop();
    const [gx, gy, gz] = keyToGxGyGz(k);
    for (const [dx, dy, dz] of DIRS) {
      const ny = gy + dy;
      if (ny < 0) continue;
      const nk = gridKey(gx + dx, ny, gz + dz);
      if (gridMap.has(nk) && !visited.has(nk)) {
        visited.add(nk);
        stack.push(nk);
      }
    }
  }
  const out = [];
  for (const key of gridMap.keys()) {
    if (!visited.has(key)) out.push(key);
  }
  return out;
}
