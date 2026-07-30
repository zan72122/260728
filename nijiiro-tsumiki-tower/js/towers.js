/* ============================================================
   towers.js — タワーの せっけいず
   純粋なデータ生成モジュール（three.js / DOM に依存しない）。
   Node 上の物理テストからも import できる。
   ============================================================ */

// ---- 共有チューニング定数（描画側・物理テスト側で共用） ----
export const PHYS = {
  gravity: -13,          // 少しキビキビした重力
  frictionBlock: 0.55,   // つみき同士
  frictionGround: 0.7,   // つみきと地面
  restitution: 0.05,
  sleepSpeedLimit: 0.35,
  sleepTimeLimit: 0.4,
  density: 2.2,          // 質量 = 体積 × density
};

export const U = 0.7;        // つみき基本サイズ（ワールド単位）

// 💣 ばくだんの威力（main.js と物理テストで共用）
// つみきは密着して積んであり摩擦がインパルスを食うので、
// ・爆心のそば（breakRadius）は粉砕して穴を開け、
// ・つよい上向き成分で宙に浮かせて摩擦から解放する
export const BOMB = {
  radius: U * 3.4,       // 吹き飛ばし半径
  breakRadius: U * 1.2,  // この中の つみきは 粉々になって消える
  power: 9,              // インパルス係数（× 質量 × 距離減衰）
  upward: 0.95,          // 上向き成分（浮かせて ばら撒く）
};
const GAP = 0.004;           // 積み上げの すき間（めり込み防止）

// ---- シード付き乱数（同じタワーを再現するため） ----
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- ブロック仕様のヘルパー ----
// kind: 'box' s=[w,h,d] / 'cone' s=[r,h] / 'cyl' s=[r,h]
function box(list, w, h, d, x, y, z, ry = 0) {
  list.push({ kind: 'box', s: [w, h, d], p: [x, y, z], ry });
}
function cone(list, r, h, x, y, z) {
  list.push({ kind: 'cone', s: [r, h], p: [x, y, z], ry: 0 });
}
function cyl(list, r, h, x, y, z) {
  list.push({ kind: 'cyl', s: [r, h], p: [x, y, z], ry: 0 });
}

/* ------------------------------------------------------------
   アーキタイプ 1：まっすぐタワー（ジェンガ風）
   3本の板を交互に90°回して積む。てっぺんに おやね。
   ------------------------------------------------------------ */
function towerStraight(rng, cycle) {
  const blocks = [];
  const layers = Math.min(7 + cycle * 2, 11);
  const pw = U, ph = U * 0.6, pl = U * 3;
  for (let i = 0; i < layers; i++) {
    const y = i * (ph + GAP) + ph / 2;
    const even = i % 2 === 0;
    for (let j = -1; j <= 1; j++) {
      const off = j * (pw + GAP);
      if (even) box(blocks, pw, ph, pl, off, y, 0, 0);
      else      box(blocks, pl, ph, pw, 0, y, off, 0);
    }
  }
  const topY = layers * (ph + GAP);
  box(blocks, U * 1.4, U * 0.5, U * 1.4, 0, topY + U * 0.25, 0, 0);
  cone(blocks, U * 0.75, U * 1.2, 0, topY + U * 0.5 + U * 0.6 + GAP, 0);
  return { blocks, name: 'まっすぐタワー', icon: '🗼', stickers: 3 };
}

/* ------------------------------------------------------------
   アーキタイプ 2：さんだんケーキ
   中空の壁のリング + お皿プレートを重ねる。
   壁を1個消すと お皿がかたむいて 上の段ごと すべり落ちる。
   ------------------------------------------------------------ */
function towerCake(rng, cycle) {
  const blocks = [];
  const s = U, L = s + GAP;
  // このタワーは 大きくすると ぐらつくので、周回でも 同じ形を保つ
  // （postH=3・お皿ひかえめ が「安定 かつ 一撃で くずせる」ちょうど良い塩梅）
  const tiers = [4, 3, 2];
  const postHBase = 3;
  const plateH = s * 0.32;
  let y = 0;
  for (const n of tiers) {
    // だんの柱：かどの 4本 × 3だんの のっぽ柱。
    // のっぽ で ほそい ので、爆風や 風で したから けりだされ、
    // お皿ごと かたむいて 上の だんが すべり落ちる
    const half = ((n - 1) / 2) * L;
    const posts = [[-half, -half], [half, -half], [-half, half], [half, half]];
    const postH = postHBase;
    for (const [px, pz] of posts) {
      for (let layer = 0; layer < postH; layer++) {
        box(blocks, s, s, s, px, y + layer * L + s / 2, pz, 0);
      }
    }
    y += postH * L;
    // お皿プレート（はみ出しは ひかえめ）
    const pw = n * L + s * 0.12;
    box(blocks, pw, plateH, pw, 0, y + plateH / 2, 0, 0);
    y += plateH + GAP;
  }
  // てっぺんの いちごポジション
  box(blocks, s, s, s, 0, y + s / 2, 0, 0);
  cone(blocks, s * 0.6, s * 1.05, 0, y + s + GAP + s * 0.53, 0);
  return { blocks, name: 'さんだんケーキ', icon: '🎂', stickers: 3 };
}

/* ------------------------------------------------------------
   アーキタイプ 3：おしろ
   土台 + 四隅の塔 + 橋わたし + 中央の高い塔。
   ------------------------------------------------------------ */
function towerCastle(rng, cycle) {
  const blocks = [];
  const s = U, L = s + GAP;
  const half = 1.5 * L;
  // 土台 4x4（レイヤー 0）
  for (let ix = 0; ix < 4; ix++) {
    for (let iz = 0; iz < 4; iz++) {
      box(blocks, s, s, s, -half + ix * L, s / 2, -half + iz * L, 0);
    }
  }
  // 四隅の塔（レイヤー 1..towerH）
  const towerH = 3 + Math.min(cycle, 2);
  const corners = [[-half, -half], [half, -half], [-half, half], [half, half]];
  for (const [cx, cz] of corners) {
    for (let k = 1; k <= towerH; k++) {
      box(blocks, s, s, s, cx, k * L + s / 2, cz, 0);
    }
  }
  // 丸太組みの かんむり橋：
  // 1だんめ（x むき）は塔の上に、2だんめ（z むき）はその上に のせる
  const towerTop = towerH * L + s;
  const bl = half * 2 + s, bh = s * 0.5, bw = s * 0.8;
  const y1 = towerTop + GAP + bh / 2;
  box(blocks, bl, bh, bw, 0, y1, -half, 0);
  box(blocks, bl, bh, bw, 0, y1, half, 0);
  const y2 = y1 + bh + GAP;
  box(blocks, bw, bh, bl, -half, y2, 0, 0);
  box(blocks, bw, bh, bl, half, y2, 0, 0);
  // かどの おやね（2だんめの橋の はしに）
  const coneH = s * 1.0;
  for (const [cx, cz] of corners) {
    cone(blocks, s * 0.55, coneH, cx, y2 + bh / 2 + GAP + coneH / 2, cz);
  }
  // 中央の高い塔（2x2 の柱、レイヤー 1..centerH）
  const centerH = towerH + 3;
  const o = L / 2;
  for (let k = 1; k <= centerH; k++) {
    const y = k * L + s / 2;
    box(blocks, s, s, s, -o, y, -o, 0);
    box(blocks, s, s, s,  o, y, -o, 0);
    box(blocks, s, s, s, -o, y,  o, 0);
    box(blocks, s, s, s,  o, y,  o, 0);
  }
  const capY = (centerH + 1) * L;
  box(blocks, s * 2.4, s * 0.5, s * 2.4, 0, capY + s * 0.25, 0, 0);
  cone(blocks, s * 0.9, s * 1.5, 0, capY + s * 0.5 + s * 0.75 + GAP, 0);
  return { blocks, name: 'おしろ', icon: '🏰', stickers: 4 };
}

/* ------------------------------------------------------------
   アーキタイプ 4：ドーナツタワー
   輪っか状に積む。まんなかに ぼう と おほし。
   ------------------------------------------------------------ */
function towerDonut(rng, cycle) {
  const blocks = [];
  const s = U;
  const per = 8;
  // 回転した立方体どうしが 触れない半径（めり込み ＝ 爆発 を防ぐ）
  const R = s * 1.95;
  const rings = Math.min(6 + cycle, 8);
  // まっすぐ そろえた 8本の柱を 輪っかに ならべる
  // （柱ごとに同じ角度で回すので、上下の接地は ぴったり安定）
  for (let ring = 0; ring < rings; ring++) {
    const y = ring * (s + GAP) + s / 2;
    for (let i = 0; i < per; i++) {
      const a = (i / per) * Math.PI * 2;
      box(blocks, s, s, s, Math.cos(a) * R, y, Math.sin(a) * R, -a);
    }
  }
  // ひとつおきの柱に ちいさな おやね
  const topY = (rings - 1) * (s + GAP) + s;
  for (let i = 0; i < per; i += 2) {
    const a = (i / per) * Math.PI * 2;
    cone(blocks, s * 0.5, s * 0.9, Math.cos(a) * R, topY + GAP + s * 0.45, Math.sin(a) * R);
  }
  // 中央の柱 + おほしのやね（穴からのぞく）
  const colH = rings + 2;
  for (let i = 0; i < colH; i++) {
    box(blocks, s * 0.9, s, s * 0.9, 0, i * (s + GAP) + s / 2, 0, 0);
  }
  cone(blocks, s * 0.7, s * 1.2, 0, colH * (s + GAP) + s * 0.6, 0);
  return { blocks, name: 'どーなつ', icon: '🍩', stickers: 4 };
}

/* ------------------------------------------------------------
   アーキタイプ 5：くるくるかいだん
   らせん状に高くなる柱の階段 + 中央の大きな塔。
   ------------------------------------------------------------ */
function towerSpiral(rng, cycle) {
  const blocks = [];
  const s = U;
  const steps = Math.min(9 + cycle, 11);
  const R = s * 2.1;
  for (let j = 1; j <= steps; j++) {
    const a = (j / steps) * Math.PI * 2;
    const cx = Math.cos(a) * R, cz = Math.sin(a) * R;
    for (let i = 0; i < j; i++) {
      box(blocks, s, s, s, cx, i * (s + GAP) + s / 2, cz, -a);
    }
  }
  // 中央の大きな塔
  const centerH = steps + 2;
  for (let i = 0; i < centerH; i++) {
    box(blocks, s * 1.2, s, s * 1.2, 0, i * (s + GAP) + s / 2, 0, 0);
  }
  cone(blocks, s * 0.85, s * 1.4, 0, centerH * (s + GAP) + s * 0.7, 0);
  return { blocks, name: 'くるくるかいだん', icon: '🌀', stickers: 4 };
}

const ARCHETYPES = [towerStraight, towerCake, towerCastle, towerDonut, towerSpiral];

/* ------------------------------------------------------------
   buildTowerSpec(stage, seed)
   stage は 1 はじまり。5種類を巡回し、周回ごとに少し大きくなる。
   seed が同じなら同じタワー（「もういっかい」で予想を検証できる）。
   ------------------------------------------------------------ */
export function buildTowerSpec(stage, seed) {
  const rng = mulberry32(seed);
  const idx = (stage - 1) % ARCHETYPES.length;
  const cycle = Math.floor((stage - 1) / ARCHETYPES.length);
  const spec = ARCHETYPES[idx](rng, cycle);

  // ちいさな個体差：位置ゆらぎ（安定を壊さない程度）と色ゆらぎ用の乱数
  for (const b of spec.blocks) {
    b.p[0] += (rng() - 0.5) * 0.006;
    b.p[2] += (rng() - 0.5) * 0.006;
    b.hueJitter = (rng() - 0.5) * 16;   // 色相ゆらぎ（度）
    b.faceRoll = rng();                 // 顔をつけるかの抽選
    b.faceSide = Math.floor(rng() * 4); // 顔の向き
  }

  // タワー全体の寸法（カメラ合わせ・色のグラデーション用）
  let maxY = 0, maxR = 0;
  for (const b of spec.blocks) {
    const h = b.kind === 'box' ? b.s[1] : b.s[1];
    maxY = Math.max(maxY, b.p[1] + h / 2);
    const w = b.kind === 'box' ? Math.hypot(b.s[0], b.s[2]) / 2 : b.s[0];
    maxR = Math.max(maxR, Math.hypot(b.p[0], b.p[2]) + w);
  }
  spec.height = maxY;
  spec.radius = maxR;
  spec.stage = stage;
  spec.seed = seed;
  return spec;
}
