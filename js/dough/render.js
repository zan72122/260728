// js/dough/render.js
// Agent B: 生地の描画 (Canvas 2D)。
//
// このファイルは DoughModel (js/dough/model.js, Agent A が並行実装中) の
// SPEC 記載の「公開プロパティ contract」だけに依存する。model.js の内部実装や
// presets.js には一切 import しない (SPEC の Agent B セクションに import 指定が
// 無いため、完全に自己完結させる)。トッピング(メロンパン上掛け)の配色のように
// dough から渡されない情報は、このファイル内にローカル定数として持つ。
//
// 表現の方針:
//   - 輪郭は Catmull-Rom -> ベジェ変換した閉曲線 (角なし)。
//   - 立体感は「オフセットしたラジアルグラデ = ハイライト」+
//     「シェイプ中心のラジアルグラデ = 縁ほど濃い焼き色」の重ね合わせ。
//   - shadowBlur は 1 回の描画につき最大 1 回 (落ち影のみ)。
//   - 毎フレームの GC 負荷を抑えるため、輪郭点の展開先バッファは
//     モジュールスコープの Float64Array を使い回す。

export const R0_REF = 150; // 線幅・粒サイズ等をサイズ非依存にするための基準半径

/* ===================== 数学・色ユーティリティ ===================== */

function clamp01(v) {
  if (v == null || isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// index から安定した 0..1 の疑似乱数 (フレームごとに値が変わらない = ちらつかない)
function hash01(i) {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return { r: 230, g: 210, b: 180 };
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  if (isNaN(num)) return { r: 230, g: 210, b: 180 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function parseAnyColor(c) {
  if (typeof c === 'string' && c[0] === '#') return hexToRgb(c);
  if (typeof c === 'string') {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (m) {
      const parts = m[1].split(',').map(Number);
      return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0 };
    }
  }
  return { r: 230, g: 210, b: 180 };
}

function lerpColor(colorA, colorB, t) {
  t = clamp01(t);
  const a = parseAnyColor(colorA);
  const b = parseAnyColor(colorB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r},${g},${bl})`;
}

// amt: -1..1 (マイナスで暗く、プラスで明るく)
function shade(color, amt) {
  const c = parseAnyColor(color);
  const f = (v) => {
    const nv = amt >= 0 ? v + (255 - v) * amt : v + v * amt;
    return Math.max(0, Math.min(255, Math.round(nv)));
  };
  return `rgb(${f(c.r)},${f(c.g)},${f(c.b)})`;
}

function rgba(color, alpha) {
  const c = parseAnyColor(color);
  return `rgba(${c.r},${c.g},${c.b},${alpha})`;
}

const FILLING_COLORS = {
  cream: '#FFF3B0',
  anko: '#7B4A2E',
  jam: '#D1425B',
  choco: '#5B3A29',
  cheese: '#F6D76E',
  raisin: '#3A2417',
  butter: '#FFE9A8',
  cinnamon: '#B5651D',
};

// メロンパン上掛け(topping)は dough から色を受け取らない契約なので固定パレットを持つ
const TOPPING_BASE = '#F3E4B8';
const TOPPING_BAKED = '#D9A24F';

/* ===================== スクラッチバッファ (GC 対策) ===================== */

const _scratch = {};
function ensure(key, n) {
  let arr = _scratch[key];
  if (!arr || arr.length < n) {
    arr = new Float64Array(Math.max(n, 64));
    _scratch[key] = arr;
  }
  return arr;
}

/* ===================== パス構築: Catmull-Rom -> ベジェ閉曲線 ===================== */

function addSmoothClosedPath(path, ptsX, ptsY, n) {
  if (n < 3) return;
  if (n < 4) {
    path.moveTo(ptsX[0], ptsY[0]);
    for (let i = 1; i < n; i++) path.lineTo(ptsX[i], ptsY[i]);
    path.closePath();
    return;
  }
  path.moveTo(ptsX[0], ptsY[0]);
  for (let i = 0; i < n; i++) {
    const i0 = (i - 1 + n) % n;
    const i1 = i;
    const i2 = (i + 1) % n;
    const i3 = (i + 2) % n;
    const c1x = ptsX[i1] + (ptsX[i2] - ptsX[i0]) / 6;
    const c1y = ptsY[i1] + (ptsY[i2] - ptsY[i0]) / 6;
    const c2x = ptsX[i2] - (ptsX[i3] - ptsX[i1]) / 6;
    const c2y = ptsY[i2] - (ptsY[i3] - ptsY[i1]) / 6;
    path.bezierCurveTo(c1x, c1y, c2x, c2y, ptsX[i2], ptsY[i2]);
  }
  path.closePath();
}

/* ===================== 共通描画パーツ ===================== */

// 落ち影 (このフレームで shadowBlur を使うのはここ 1 回のみ)
function drawDropShadow(ctx, cx, cy, avgR) {
  ctx.save();
  ctx.shadowColor = 'rgba(90,60,30,0.35)';
  ctx.shadowBlur = avgR * 0.35;
  ctx.shadowOffsetY = avgR * 0.12;
  ctx.fillStyle = 'rgba(90,60,30,0.22)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + avgR * 0.62, avgR * 0.78, avgR * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 中心を軽量に暗く落ちる縁の下地 (森など軽量版で使う簡易影・ぼかし無し)
function drawFlatShadow(ctx, cx, cy, avgR) {
  ctx.fillStyle = 'rgba(80,55,25,0.14)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + avgR * 0.6, avgR * 0.75, avgR * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ベース塗り: 中心が明るく、縁ほど焼き色が濃いラジアルグラデ
function fillBase(ctx, path, cx, cy, avgR, baseColor, bakedColor, bakeT, crustHardness) {
  const center = lerpColor(baseColor, bakedColor, bakeT * 0.15);
  const mid = lerpColor(baseColor, bakedColor, bakeT * 0.55);
  const edgeDark = 0.18 * bakeT + 0.08 * clamp01(crustHardness) + 0.04;
  const edge = shade(lerpColor(baseColor, bakedColor, bakeT), -edgeDark);
  const g = ctx.createRadialGradient(cx, cy, avgR * 0.05, cx, cy, avgR * 1.05);
  g.addColorStop(0, center);
  g.addColorStop(0.65, mid);
  g.addColorStop(1, edge);
  ctx.fillStyle = g;
  ctx.fill(path, 'evenodd');
}

// ふんわりハイライト (左上オフセット)。crumbSoftness/air が高いほど大きく柔らかく
function drawHighlight(ctx, cx, cy, avgR, crumbSoft, air) {
  const hx = cx - avgR * 0.32;
  const hy = cy - avgR * 0.38;
  const hr = avgR * (0.55 + crumbSoft * 0.25 + air * 0.25);
  const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, Math.max(1, hr));
  g.addColorStop(0, `rgba(255,250,235,${0.5 + crumbSoft * 0.22})`);
  g.addColorStop(0.6, 'rgba(255,250,235,0.16)');
  g.addColorStop(1, 'rgba(255,250,235,0)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - avgR * 2, cy - avgR * 2, avgR * 4, avgR * 4);
}

// 下側の淡い影 (球体感の補強)
function drawBottomShade(ctx, cx, cy, avgR) {
  const sx = cx + avgR * 0.08;
  const sy = cy + avgR * 0.55;
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(1, avgR * 0.9));
  g.addColorStop(0, 'rgba(80,45,20,0.16)');
  g.addColorStop(1, 'rgba(80,45,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - avgR * 2, cy - avgR * 2, avgR * 4, avgR * 4);
}

// croissant 用の層線 (縁に沿って弧状に重ねる)。bakeColor が上がるほどコントラスト増
function drawLayers(ctx, ox, oy, n, cx, cy, layers, bakeT, baseColor, bakedColor, unit, maxCount) {
  const count = Math.min(Math.max(0, layers), maxCount || 6);
  if (count < 1) return;
  const lineColor = shade(lerpColor(baseColor, bakedColor, Math.min(1, bakeT + 0.2)), -0.35);
  const lx = ensure('lx', n);
  const ly = ensure('ly', n);
  ctx.lineWidth = Math.max(0.6, unit * 1.6);
  for (let k = 1; k <= count; k++) {
    const inset = 1 - k * 0.045;
    for (let i = 0; i < n; i++) {
      lx[i] = cx + (ox[i] - cx) * inset;
      ly[i] = cy + (oy[i] - cy) * inset;
    }
    const path = new Path2D();
    addSmoothClosedPath(path, lx, ly, n);
    ctx.strokeStyle = rgba(lineColor, 0.12 + bakeT * 0.35 * (k / count));
    ctx.stroke(path);
  }
}

// fillings: 生地表面にうっすら透ける色 (位置は中心相対 x,y、膨らみ自体は model 担当)
function drawFillings(ctx, fillings, cx, cy, unit) {
  if (!fillings || !fillings.length) return;
  const u = Math.max(0.35, unit);
  for (let i = 0; i < fillings.length; i++) {
    const f = fillings[i];
    if (!f) continue;
    const amount = clamp01(f.amount);
    if (amount <= 0.01) continue;
    const color = FILLING_COLORS[f.type] || '#E8D8B8';
    const fx = cx + (f.x || 0);
    const fy = cy + (f.y || 0);
    const r = (14 + amount * 26) * u;
    const glossy = f.type === 'butter' || f.type === 'cheese';
    const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, Math.max(1, r));
    g.addColorStop(0, rgba(color, glossy ? 0.55 : 0.42));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(fx, fy, r, 0, Math.PI * 2);
    ctx.fill();
    if (f.type === 'raisin') {
      // レーズンは粒々を点描
      for (let k = 0; k < 4; k++) {
        const a = hash01(i * 7 + k + 1) * Math.PI * 2;
        const rr = r * (0.3 + 0.4 * hash01(i * 13 + k + 1));
        ctx.fillStyle = rgba(color, 0.8);
        ctx.beginPath();
        ctx.arc(fx + Math.cos(a) * rr, fy + Math.sin(a) * rr, 2.2 * u, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// patterns の描画。isGroove=true ならメロンパン上掛けの「溝」表現 (二重線で凹みを表す)
function drawPatterns(ctx, patterns, cx, cy, unit, ferment, bakeT, isGroove) {
  if (!patterns || !patterns.length) return;
  const u = Math.max(0.45, unit);
  const grooveW = (2 + clamp01(ferment) * 6 + clamp01(bakeT) * 4) * u;
  for (let s = 0; s < patterns.length; s++) {
    const stroke = patterns[s];
    if (!stroke || stroke.length < 2) continue;
    if (isGroove) {
      // 影側
      ctx.beginPath();
      ctx.moveTo(cx + stroke[0].x + u, cy + stroke[0].y + u);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(cx + stroke[i].x + u, cy + stroke[i].y + u);
      ctx.strokeStyle = 'rgba(90,55,20,0.35)';
      ctx.lineWidth = grooveW;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      // ハイライト側 (溝が開いて見えるよう反対にずらす)
      ctx.beginPath();
      ctx.moveTo(cx + stroke[0].x - u, cy + stroke[0].y - u);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(cx + stroke[i].x - u, cy + stroke[i].y - u);
      ctx.strokeStyle = 'rgba(255,240,210,0.35)';
      ctx.lineWidth = Math.max(0.6, grooveW * 0.5);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx + stroke[0].x, cy + stroke[0].y);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(cx + stroke[i].x, cy + stroke[i].y);
      ctx.strokeStyle = 'rgba(120,80,40,0.28)';
      ctx.lineWidth = 2 * u;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }
}

// crackAmount からひび割れ線を生成 (index シードで毎フレーム同じ形 = ちらつかない)
function drawCracks(ctx, crackAmount, ox, oy, n, cx, cy, unit) {
  const c = clamp01(crackAmount);
  if (c <= 0.03 || n <= 0) return;
  const u = Math.max(0.4, unit);
  const count = Math.round(3 + c * 6);
  ctx.strokeStyle = `rgba(90,55,25,${0.25 + c * 0.35})`;
  ctx.lineWidth = Math.max(0.6, u * 1.2);
  ctx.lineCap = 'round';
  for (let k = 0; k < count; k++) {
    const idx = Math.floor(hash01(k * 3 + 1) * n) % n;
    const ang = Math.atan2(oy[idx] - cy, ox[idx] - cx);
    const edgeR = Math.hypot(ox[idx] - cx, oy[idx] - cy);
    const startR = edgeR * (0.35 + hash01(k) * 0.3);
    const len = startR * (0.4 + c * 0.5);
    let px = cx + Math.cos(ang) * startR;
    let py = cy + Math.sin(ang) * startR;
    ctx.beginPath();
    ctx.moveTo(px, py);
    let a = ang;
    const seg = 3;
    for (let j = 1; j <= seg; j++) {
      a += (hash01(k * 5 + j + 2) - 0.5) * 0.6;
      px += Math.cos(a) * (len / seg);
      py += Math.sin(a) * (len / seg);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

// オーブン内の暖色ビネット (opts.inOven)
function drawOvenGlow(ctx, cx, cy, avgR) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, avgR * 1.1);
  g.addColorStop(0, 'rgba(255,180,90,0)');
  g.addColorStop(1, 'rgba(255,140,60,0.16)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - avgR * 2, cy - avgR * 2, avgR * 4, avgR * 4);
}

// 揚げ油の泡 / 蒸気の湯気。dough.bubbles = [{x,y,r,life}] (x,y は中心相対 CSS px と解釈)
function drawBubbles(ctx, bubbles, cx, cy, unit, opts, t) {
  if (!bubbles || !bubbles.length) return;
  const u = Math.max(0.4, unit);
  const frying = !!(opts && opts.frying);
  const steaming = !!(opts && opts.steaming);
  ctx.save();
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    if (!b) continue;
    const life = b.life == null ? 1 : clamp01(b.life);
    if (life <= 0) continue;
    const bx = cx + (b.x || 0);
    const by = cy + (b.y || 0);
    const r = Math.max(1, (b.r || 4) * u);
    if (steaming) {
      // 湯気: 上へ伸びるゆらぎ曲線
      ctx.strokeStyle = `rgba(255,255,255,${0.35 * life})`;
      ctx.lineWidth = Math.max(1, r * 0.35);
      ctx.lineCap = 'round';
      const h = r * 3.2;
      const wob = Math.sin((t || 0) * 2 + i) * r * 0.6;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + wob, by - h * 0.5, bx, by - h);
      ctx.stroke();
    } else {
      ctx.fillStyle = frying ? `rgba(255,250,235,${0.55 * life})` : `rgba(255,255,255,${0.4 * life})`;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
      if (frying) {
        ctx.strokeStyle = `rgba(210,150,60,${0.4 * life})`;
        ctx.lineWidth = Math.max(0.5, u);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

// メロンパン等の「上掛け」を、元の輪郭点を一回り縮小したドームとして合成描画
// (topping には独自の点列が無い契約なので、renderer 側で ox/oy から作る)
function drawTopping(ctx, ox, oy, n, cx, cy, topping, patterns, ferment, bakeT, unit) {
  if (!topping) return;
  const tx = ensure('tx', n);
  const ty = ensure('ty', n);
  const scaleT = 0.86;
  const liftY = -Math.max(2, unit * 6);
  for (let i = 0; i < n; i++) {
    tx[i] = cx + (ox[i] - cx) * scaleT;
    ty[i] = cy + liftY + (oy[i] - cy) * scaleT;
  }
  const path = new Path2D();
  addSmoothClosedPath(path, tx, ty, n);

  let sumR = 0;
  const tcy = cy + liftY;
  for (let i = 0; i < n; i++) sumR += Math.hypot(tx[i] - cx, ty[i] - tcy);
  const avgR = Math.max(4, sumR / n);

  const center = lerpColor(TOPPING_BASE, TOPPING_BAKED, bakeT * 0.2);
  const mid = lerpColor(TOPPING_BASE, TOPPING_BAKED, bakeT * 0.6);
  const edge = shade(lerpColor(TOPPING_BASE, TOPPING_BAKED, bakeT), -(0.15 * bakeT + 0.05));
  const g = ctx.createRadialGradient(cx - avgR * 0.2, tcy - avgR * 0.25, avgR * 0.05, cx, tcy, avgR * 1.05);
  g.addColorStop(0, center);
  g.addColorStop(0.65, mid);
  g.addColorStop(1, edge);

  ctx.save();
  ctx.fillStyle = g;
  ctx.fill(path);
  ctx.clip(path);
  // patterns はメロンパン模様の「溝」として描く。溝の幅は ferment/bakeColor で開く
  drawPatterns(ctx, patterns, cx, cy, unit, ferment, bakeT, true);
  const crack = clamp01(topping.crack);
  if (crack > 0.03) drawCracks(ctx, crack, tx, ty, n, cx, tcy, unit);
  ctx.restore();
}

/* ===================== 公開 API ===================== */

/**
 * DoughModel を描画する。
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./model.js').DoughModel} dough
 * @param {number} t 経過秒
 * @param {{frying?:boolean, steaming?:boolean, inOven?:boolean}} opts
 */
export function renderDough(ctx, dough, t, opts = {}) {
  if (!ctx || !dough || !dough.points || !dough.points.length || !dough.center) return;
  try {
    _renderDoughInner(ctx, dough, t || 0, opts || {});
  } catch (e) {
    // 描画エラーでゲームループを止めない (main.js 側の方針に合わせ、ここでも握りつぶす)
  }
}

function _renderDoughInner(ctx, dough, t, opts) {
  const pts = dough.points;
  const n = pts.length;
  const cx = dough.center.x;
  const cy = dough.center.y;
  const p = dough.p || {};
  const preset = dough.preset || {};
  const baseColor = preset.baseColor || '#F7E8C9';
  const bakedColor = preset.bakedColor || '#C68A4B';

  const bakeT = clamp01(p.bakeColor);
  const air = clamp01(p.air);
  const crumbSoft = clamp01(p.crumbSoftness);
  const ferment = clamp01(p.ferment);
  const crustHardness = clamp01(p.crustHardness);
  const layers = Math.max(1, Math.round(p.layers || 1));
  const wobble = clamp01(dough.wobble);
  const holeR = dough.holeR || 0;

  // wobble(呼吸)を輪郭半径に乗せる。air が多いほどふんわり大きく脈動
  const wobbleAmp = 1 + wobble * (0.012 + air * 0.035);

  const ox = ensure('ox', n);
  const oy = ensure('oy', n);
  let sumR = 0;
  let sumTh = 0;
  for (let i = 0; i < n; i++) {
    const pt = pts[i];
    const px = pt && typeof pt.x === 'number' ? pt.x : cx;
    const py = pt && typeof pt.y === 'number' ? pt.y : cy;
    const rx = (px - cx) * wobbleAmp;
    const ry = (py - cy) * wobbleAmp;
    ox[i] = cx + rx;
    oy[i] = cy + ry;
    sumR += Math.hypot(rx, ry);
    sumTh += pt && typeof pt.th === 'number' ? pt.th : 1;
  }
  const avgR = Math.max(8, sumR / n);
  const avgTh = sumTh / n;
  const unit = avgR / R0_REF; // サイズに依らず線幅・粒サイズを一定に見せるための単位

  const doughPath = new Path2D();
  addSmoothClosedPath(doughPath, ox, oy, n);
  if (holeR > 0) {
    doughPath.moveTo(cx + holeR, cy);
    doughPath.arc(cx, cy, holeR, 0, Math.PI * 2);
  }

  drawDropShadow(ctx, cx, cy, avgR);
  fillBase(ctx, doughPath, cx, cy, avgR, baseColor, bakedColor, bakeT, crustHardness + (avgTh - 1) * 0.3);

  ctx.save();
  ctx.clip(doughPath, 'evenodd');
  drawHighlight(ctx, cx, cy, avgR, crumbSoft, air);
  drawBottomShade(ctx, cx, cy, avgR);
  if (layers >= 3) drawLayers(ctx, ox, oy, n, cx, cy, layers, bakeT, baseColor, bakedColor, unit, 6);
  drawFillings(ctx, dough.fillings, cx, cy, unit);
  if (!dough.topping) drawPatterns(ctx, dough.patterns, cx, cy, unit, ferment, bakeT, false);
  drawCracks(ctx, dough.crackAmount, ox, oy, n, cx, cy, unit);
  if (opts.inOven) drawOvenGlow(ctx, cx, cy, avgR);
  ctx.restore();

  if (dough.topping) drawTopping(ctx, ox, oy, n, cx, cy, dough.topping, dough.patterns, ferment, bakeT, unit);

  drawBubbles(ctx, dough.bubbles, cx, cy, unit, opts, t);
}

/**
 * 森などで多数描画される軽量版。dough.snapshot() の返り値を描く。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} snap DoughModel#snapshot() の返り値
 * @param {number} x 中心 x (canvas 座標)
 * @param {number} y 中心 y (canvas 座標)
 * @param {number} scale 縮小率
 * @param {number} t 経過秒
 */
export function renderSnapshot(ctx, snap, x, y, scale, t) {
  if (!ctx || !snap || !snap.outline || !snap.outline.length) return;
  try {
    _renderSnapshotInner(ctx, snap, x, y, scale == null ? 1 : scale, t || 0);
  } catch (e) {
    // 森の描画1個が壊れてもパノラマ全体を止めない
  }
}

function _renderSnapshotInner(ctx, snap, x, y, scale, t) {
  const outline = snap.outline;
  const n = outline.length;
  const baseColor = snap.baseColor || '#F7E8C9';
  const bakedColor = snap.bakedColor || '#C68A4B';
  const bakeT = clamp01(snap.bakeColor);
  const ferment = clamp01(snap.ferment);
  const layers = Math.max(1, Math.round(snap.layers || 1));
  const holeR = (snap.holeR || 0) * scale;
  const air = clamp01(snap.air);

  // 個体ごとに位相をずらした、ごく控えめな呼吸 (森で全部が同期して脈動しないように)
  const seed = ((Math.abs(x) * 13 + Math.abs(y) * 7) % 1000) / 1000;
  const breathe = 1 + Math.sin(t * 1.1 + seed * Math.PI * 2) * 0.006 * (0.3 + air);

  const ox = ensure('sox', n);
  const oy = ensure('soy', n);
  let sumR = 0;
  for (let i = 0; i < n; i++) {
    const pt = outline[i];
    const px = (pt && typeof pt.x === 'number' ? pt.x : 0) * scale * breathe;
    const py = (pt && typeof pt.y === 'number' ? pt.y : 0) * scale * breathe;
    ox[i] = x + px;
    oy[i] = y + py;
    sumR += Math.hypot(px, py);
  }
  const avgR = Math.max(4, sumR / n);
  const unit = avgR / R0_REF;

  const path = new Path2D();
  addSmoothClosedPath(path, ox, oy, n);
  if (holeR > 0) {
    path.moveTo(x + holeR, y);
    path.arc(x, y, holeR, 0, Math.PI * 2);
  }

  drawFlatShadow(ctx, x, y, avgR);

  // 軽量版: ハイライトと焼き色を 1 本のオフセットラジアルグラデにまとめる
  const hx = x - avgR * 0.3;
  const hy = y - avgR * 0.35;
  const center = lerpColor(baseColor, bakedColor, bakeT * 0.1);
  const mid = lerpColor(baseColor, bakedColor, bakeT * 0.55);
  const edge = shade(lerpColor(baseColor, bakedColor, bakeT), -(0.22 * bakeT + 0.05));
  const g = ctx.createRadialGradient(hx, hy, avgR * 0.05, x, y, avgR * 1.15);
  g.addColorStop(0, lerpColor('#FFFFFF', center, 0.55));
  g.addColorStop(0.55, mid);
  g.addColorStop(1, edge);
  ctx.fillStyle = g;
  ctx.fill(path, 'evenodd');

  ctx.save();
  ctx.clip(path, 'evenodd');
  if (layers >= 3) drawLayers(ctx, ox, oy, n, x, y, layers, bakeT, baseColor, bakedColor, unit, 3);
  drawFillings(ctx, snap.fillings, x, y, unit);
  if (!snap.topping) drawPatterns(ctx, snap.patterns, x, y, unit, ferment, bakeT, false);
  const crackAmount = clamp01(snap.crackAmount);
  if (crackAmount > 0.05) drawCracks(ctx, crackAmount, ox, oy, n, x, y, unit);
  ctx.restore();

  if (snap.topping) drawTopping(ctx, ox, oy, n, x, y, snap.topping, snap.patterns, ferment, bakeT, unit);
}
