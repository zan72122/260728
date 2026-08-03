// js/gl/mesh.js — Agent J
// DoughMesh: DoughModel の公開状態から毎フレーム、WebGL用の高さ場メッシュ
// (positions/normals/extras/indices) を生成する純JSモジュール。
// DOM/WebGL に一切依存しない（node で単体テスト可能）。
//
// 配列レイアウト（docs/SPEC-GL.md 契約。Agent K の js/gl/glrenderer.js が読む）:
//   positions: Float32Array(N*3)  x,y = dough.center からの相対 CSS px, z = 高さ px (手前が+z)
//   normals:   Float32Array(N*3)  単位法線
//   extras:    Float32Array(N*4)  [rho, toppingMask, grooveDepth, edgeAO]
//   indices:   Uint16Array        三角形リスト。頂点トポロジーは固定、構築時に一度だけ生成。
//
// 頂点グリッド: 中心1頂点(index 0) + rings×sectors の極座標グリッド
//   (ring r=0..rings-1, sector s=0..sectors-1 → vertex index = 1 + r*sectors + s)。
//
// 実装ノート（穴 holeR>0 の透明化について）:
//   Agent K の glrenderer.js を確認したところ、メインのドーム用フラグメントシェーダは
//   常に alpha=1.0 を出力し discard も無く、かつ indices バッファは同一 mesh インスタンスに
//   対して初回のみ STATIC_DRAW でアップロードされ、以後フレーム毎の indices 書き換えは
//   GPU 側に反映されない（bufferSubData されるのは positions/normals/extras のみ）。
//   したがって「本当に透明な穴」は本ファイル単体では実現不可能という結論に至った。
//   代わりに、頂点位置と extras(edgeAO=0 / rho=0 / h=0) を使い、穴の中心をできる限り
//   平坦・無陰影にして「窪んだ暗い穴」に見えるよう最善を尽くす設計にした
//   （縁は環状(annulus)へ滑らかに再マップして torus 断面で滑らかに落ちる）。
//   本当の抜き穴が必要なら glrenderer.js 側で uHoleR 等を使った discard の追加を推奨する
//   （最終報告に記載）。

const N48 = 48; // DoughModel.points の輪郭点数 (SPEC.md 契約で固定)
const MAX_STROKES = 16; // patterns から読む最大ストローク数 (割り当てゼロのための上限)
const MAX_PTS_PER_STROKE = 24; // 各ストロークの間引き後の最大点数 (spec: ≤24)
const MAX_DENTS = 32; // dents 読み取りの安全上限 (spec: model 側は最大16)
const EMPTY_ARR = Object.freeze([]);

function clamp(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}
function clamp01(v) {
  return clamp(v, 0, 1);
}
function num(v, d) {
  return typeof v === 'number' && isFinite(v) ? v : d;
}
// smoothstep(edge0,edge1,x) — edge0<edge1 前提
function smooth01(edge0, edge1, x) {
  const w = edge1 - edge0;
  let t = w !== 0 ? (x - edge0) / w : (x >= edge1 ? 1 : 0);
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}

export class DoughMesh {
  constructor(rings = 26, sectors = 64) {
    rings = Math.max(2, rings | 0);
    sectors = Math.max(3, sectors | 0);
    // Uint16Array の範囲 (65535) を超えないよう安全側にクランプ
    while (1 + rings * sectors > 65500) {
      if (rings > sectors) rings--; else sectors--;
    }
    this.rings = rings;
    this.sectors = sectors;

    this.vertexCount = 1 + rings * sectors;
    this.indexCount = sectors * 3 + (rings - 1) * sectors * 6;

    this.positions = new Float32Array(this.vertexCount * 3);
    this.normals = new Float32Array(this.vertexCount * 3);
    this.extras = new Float32Array(this.vertexCount * 4);
    this.indices = new Uint16Array(this.indexCount);

    // ---- 角度グリッド事前計算 (毎フレーム trig を呼ばないため) ----
    this._cosSector = new Float32Array(sectors);
    this._sinSector = new Float32Array(sectors);
    this._angleSector = new Float32Array(sectors);
    // 48点輪郭への角度対応 (線形補間インデックス)
    this._cI0 = new Int32Array(sectors);
    this._cI1 = new Int32Array(sectors);
    this._cFrac = new Float32Array(sectors);
    for (let s = 0; s < sectors; s++) {
      const ang = (s / sectors) * Math.PI * 2;
      this._angleSector[s] = ang;
      this._cosSector[s] = Math.cos(ang);
      this._sinSector[s] = Math.sin(ang);
      const idxF = (s / sectors) * N48;
      const i0 = Math.floor(idxF) % N48;
      this._cI0[s] = i0;
      this._cI1[s] = (i0 + 1) % N48;
      this._cFrac[s] = idxF - Math.floor(idxF);
    }

    // ---- インデックス (三角形リスト) 構築。以後不変。 ----
    let ii = 0;
    const idx = this.indices;
    const vidx = (r, s) => 1 + r * sectors + s;
    for (let s = 0; s < sectors; s++) {
      const s2 = (s + 1) % sectors;
      idx[ii++] = 0;
      idx[ii++] = 1 + s;
      idx[ii++] = 1 + s2;
    }
    for (let r = 0; r < rings - 1; r++) {
      for (let s = 0; s < sectors; s++) {
        const s2 = (s + 1) % sectors;
        const a = vidx(r, s), b = vidx(r, s2), c = vidx(r + 1, s2), d = vidx(r + 1, s);
        idx[ii++] = a; idx[ii++] = b; idx[ii++] = c;
        idx[ii++] = a; idx[ii++] = c; idx[ii++] = d;
      }
    }

    // ---- 使い回しスクラッチ (毎フレーム割り当てゼロのため) ----
    this._rc48 = new Float32Array(N48); // 輪郭半径 (中心相対px, 角度 i/48*2π)
    this._th48 = new Float32Array(N48); // 輪郭厚み
    this._patX = new Float32Array(MAX_STROKES * MAX_PTS_PER_STROKE);
    this._patY = new Float32Array(MAX_STROKES * MAX_PTS_PER_STROKE);
    this._patLen = new Int32Array(MAX_STROKES);
    this._patCount = 0;
  }

  // ==== メイン更新 ====================================================
  // dough: DoughModel の公開プロパティのみ読む。t: 経過秒(任意演出用)。
  update(dough, t) {
    if (!dough || !Array.isArray(dough.points) || dough.points.length === 0) return;
    const rings = this.rings, sectors = this.sectors;
    const positions = this.positions, normals = this.normals, extras = this.extras;
    const tt = num(t, 0);

    const p = dough.p || {};
    const thickness = num(p.thickness, 1);
    const air = clamp01(num(p.air, 0));
    const ferment = clamp01(num(p.ferment, 0));
    const bakeColor = clamp01(num(p.bakeColor, 0));
    const layers = Math.max(1, Math.round(num(p.layers, 1)));
    const holeR = Math.max(0, num(dough.holeR, 0));
    const hasHole = holeR > 1e-6;
    const wobbleRaw = num(dough.wobble, 0.5);
    const wobbleFactor = 1 + (clamp01(wobbleRaw) - 0.5) * 0.05; // ごく僅かな呼吸
    const toppingActive = !!dough.topping;

    // ---- 輪郭 (48点) を読み取り、半径/厚みをスクラッチへ ----
    const pts = dough.points;
    const rc48 = this._rc48, th48 = this._th48;
    const pn = Math.min(N48, pts.length);
    let sumR = 0, sumTh = 0;
    const cx = (dough.center && isFinite(dough.center.x)) ? dough.center.x : 0;
    const cy = (dough.center && isFinite(dough.center.y)) ? dough.center.y : 0;
    for (let i = 0; i < pn; i++) {
      const pt = pts[i];
      let rx = 0, ry = 0;
      if (pt && isFinite(pt.x) && isFinite(pt.y)) { rx = pt.x - cx; ry = pt.y - cy; }
      let r = Math.sqrt(rx * rx + ry * ry);
      if (!isFinite(r) || r <= 0) r = 1;
      let th = pt ? num(pt.th, 1) : 1;
      if (!isFinite(th) || th <= 0) th = 1;
      rc48[i] = r;
      th48[i] = th;
      sumR += r;
      sumTh += th;
    }
    // ptsが48未満の場合の残りは最後の値で埋める(安全側)
    for (let i = pn; i < N48; i++) {
      rc48[i] = pn > 0 ? rc48[pn - 1] : 1;
      th48[i] = pn > 0 ? th48[pn - 1] : 1;
    }
    const avgRadius = pn > 0 ? sumR / pn : 1;
    const avgTh = pn > 0 ? sumTh / pn : 1;

    // ---- フレーム単位のスカラー ----
    const fermentEffect = ferment;
    const HmaxBase = avgRadius * 0.42 * Math.max(0.05, thickness) * (1 + 0.30 * air + 0.25 * fermentEffect);

    const grooveOpen = clamp(ferment * 0.5 + bakeColor * 0.8, 0, 1.3);
    const grooveSigma = Math.max(1.5, avgRadius * 0.05 * (0.6 + grooveOpen));
    const grooveSigma2 = grooveSigma * grooveSigma;
    const grooveCut2 = grooveSigma2 * 9; // 早期打ち切り距離^2
    const maxGrooveDepthPx = HmaxBase * 0.4 * (0.35 + 0.65 * grooveOpen);

    const layersAmp = layers >= 3
      ? HmaxBase * 0.10 * (Math.min(layers, 12) / 12) * (0.35 + 0.65 * bakeColor)
      : 0;
    const layersPhase = tt * 0.15;

    // ---- patterns をスクラッチへ間引きコピー (割り当てゼロ) ----
    const patterns = Array.isArray(dough.patterns) ? dough.patterns : EMPTY_ARR;
    const patX = this._patX, patY = this._patY, patLen = this._patLen;
    const strokeCount = Math.min(patterns.length, MAX_STROKES);
    for (let s = 0; s < strokeCount; s++) {
      const stroke = patterns[s];
      const len = Array.isArray(stroke) ? stroke.length : 0;
      if (len === 0) { patLen[s] = 0; continue; }
      const take = Math.min(len, MAX_PTS_PER_STROKE);
      const base = s * MAX_PTS_PER_STROKE;
      for (let k = 0; k < take; k++) {
        const srcIdx = take > 1 ? Math.round((k * (len - 1)) / (take - 1)) : 0;
        const sp = stroke[srcIdx];
        patX[base + k] = sp && isFinite(sp.x) ? sp.x : 0;
        patY[base + k] = sp && isFinite(sp.y) ? sp.y : 0;
      }
      patLen[s] = take;
    }
    this._patCount = strokeCount;

    // ---- dents (Agent L 追加中。無くても落ちないこと) ----
    const dents = Array.isArray(dough.dents) ? dough.dents : EMPTY_ARR;
    const dentCount = Math.min(dents.length, MAX_DENTS);

    // ==== 頂点計算: 中心 (apex) ====
    {
      let h = 0, ao = 1, mask = 0, groove = 0, rho = 0;
      let x = 0, y = 0;
      if (!hasHole) {
        const domeH = HmaxBase * avgTh; // u=0 → (1-0^2.3)^0.65 = 1
        h = domeH * wobbleFactor;
        // dents
        for (let di = 0; di < dentCount; di++) {
          const d = dents[di];
          if (!d) continue;
          const dx = x - num(d.x, 0), dy = y - num(d.y, 0);
          const d2 = dx * dx + dy * dy;
          const sig = Math.max(1, num(d.r, 8));
          const sig2 = sig * sig;
          if (d2 > sig2 * 9) continue;
          const w = Math.exp(-d2 / (2 * sig2));
          h -= num(d.depth, 0) * w;
        }
        // groove
        for (let s = 0; s < strokeCount; s++) {
          const len = patLen[s];
          const base = s * MAX_PTS_PER_STROKE;
          for (let k = 0; k < len; k++) {
            const dx = x - patX[base + k], dy = y - patY[base + k];
            const d2 = dx * dx + dy * dy;
            if (d2 > grooveCut2) continue;
            const w = Math.exp(-d2 / (2 * grooveSigma2));
            if (w > groove) groove = w;
          }
        }
        if (groove > 0) h -= groove * maxGrooveDepthPx;
        ao = clamp(1 - 0.45 * groove, 0.12, 1);
        mask = toppingActive ? 1 : 0;
      } else {
        h = 0; ao = 0; mask = 0; groove = 0; rho = 0;
      }
      if (!isFinite(h)) h = 0;
      positions[0] = 0; positions[1] = 0; positions[2] = h;
      extras[0] = rho; extras[1] = mask; extras[2] = groove; extras[3] = ao;
    }

    // ==== 頂点計算: リング (r,s) ====
    const cosSector = this._cosSector, sinSector = this._sinSector, angleSector = this._angleSector;
    const cI0 = this._cI0, cI1 = this._cI1, cFrac = this._cFrac;

    for (let r = 0; r < rings; r++) {
      const rhoRaw = (r + 1) / rings; // 0<rhoRaw<=1 (再マップ前)
      const rowBase = 1 + r * sectors;
      for (let s = 0; s < sectors; s++) {
        const vi = rowBase + s;
        const c0 = cI0[s], c1 = cI1[s], fr = cFrac[s];
        const rc = rc48[c0] + (rc48[c1] - rc48[c0]) * fr;
        const th = th48[c0] + (th48[c1] - th48[c0]) * fr;

        let rho, u;
        if (hasHole) {
          const holeFrac = clamp(holeR / Math.max(1e-3, rc), 0, 0.92);
          rho = holeFrac + (1 - holeFrac) * rhoRaw;
          u = Math.abs(2 * rhoRaw - 1); // 環状断面: 内縁/外縁の両方で滑らかに0へ
        } else {
          rho = rhoRaw;
          u = rhoRaw;
        }
        const uC = u < 0 ? 0 : (u > 1 ? 1 : u);

        const radius = rho * rc * wobbleFactor;
        const x = radius * cosSector[s];
        const y = radius * sinSector[s];

        const base = Math.max(0, 1 - Math.pow(uC, 2.3));
        let h = HmaxBase * th * Math.pow(base, 0.65) * wobbleFactor;

        // ---- dents (指のへこみ。ガウス減衰) ----
        for (let di = 0; di < dentCount; di++) {
          const d = dents[di];
          if (!d) continue;
          const dx = x - num(d.x, 0), dy = y - num(d.y, 0);
          const d2 = dx * dx + dy * dy;
          const sig = Math.max(1, num(d.r, 8));
          const sig2 = sig * sig;
          if (d2 > sig2 * 9) continue;
          const w = Math.exp(-d2 / (2 * sig2));
          h -= num(d.depth, 0) * w;
        }

        // ---- layers (croissant の層リッジ) ----
        if (layersAmp !== 0) {
          const win = smooth01(0.55, 0.68, rho);
          if (win > 0) {
            const ridge = Math.sin(angleSector[s] * Math.min(layers, 12) + layersPhase) * layersAmp * win;
            h += ridge;
          }
        }

        // ---- patterns (溝彫り) ----
        let groove = 0;
        for (let si = 0; si < strokeCount; si++) {
          const len = patLen[si];
          const pbase = si * MAX_PTS_PER_STROKE;
          for (let k = 0; k < len; k++) {
            const dx = x - patX[pbase + k], dy = y - patY[pbase + k];
            const d2 = dx * dx + dy * dy;
            if (d2 > grooveCut2) continue;
            const w = Math.exp(-d2 / (2 * grooveSigma2));
            if (w > groove) groove = w;
          }
        }
        if (groove > 0) h -= groove * maxGrooveDepthPx;

        if (!isFinite(h)) h = 0;
        if (!isFinite(x) || !isFinite(y)) { positions[vi * 3] = 0; positions[vi * 3 + 1] = 0; }
        else { positions[vi * 3] = x; positions[vi * 3 + 1] = y; }
        positions[vi * 3 + 2] = h;

        // ---- extras ----
        const edgeT = smooth01(0.72, 1.0, uC);
        let ao = 1 - 0.45 * edgeT - 0.45 * groove;
        if (hasHole && r === 0) ao = 0; // 穴内側の縁: 最大限暗く/平坦に見せる
        ao = clamp(ao, 0.08, 1);
        const mask = toppingActive ? (1 - smooth01(0.80, 0.92, rho)) : 0;

        const ei = vi * 4;
        extras[ei] = clamp01(rho);
        extras[ei + 1] = clamp01(mask);
        extras[ei + 2] = clamp01(groove);
        extras[ei + 3] = ao;
      }
    }

    // ==== 法線 (グリッド有限差分。境界/穴/中心でも NaN を出さない) ====
    this._computeNormals();
  }

  _computeNormals() {
    const rings = this.rings, sectors = this.sectors;
    const positions = this.positions, normals = this.normals;
    const vidx = (r, s) => 1 + r * sectors + s;

    // リング頂点
    for (let r = 0; r < rings; r++) {
      const sPrevRow = r > 0 ? r - 1 : -1; // -1 は apex を意味する
      const hasOuter = r < rings - 1;
      for (let s = 0; s < sectors; s++) {
        const vi = vidx(r, s);
        const sN = (s + 1) % sectors;
        const sP = (s - 1 + sectors) % sectors;
        const iN = vidx(r, sN) * 3, iP = vidx(r, sP) * 3, iC = vi * 3;

        const tsx = positions[iN] - positions[iP];
        const tsy = positions[iN + 1] - positions[iP + 1];
        const tsz = positions[iN + 2] - positions[iP + 2];

        let cxI, cyI, czI;
        if (sPrevRow >= 0) {
          const ii = vidx(sPrevRow, s) * 3;
          cxI = positions[ii]; cyI = positions[ii + 1]; czI = positions[ii + 2];
        } else {
          cxI = positions[0]; cyI = positions[1]; czI = positions[2]; // apex
        }

        let trx, tryy, trz;
        if (hasOuter) {
          const oi = vidx(r + 1, s) * 3;
          trx = positions[oi] - cxI;
          tryy = positions[oi + 1] - cyI;
          trz = positions[oi + 2] - czI;
        } else {
          // 最外周: 片側差分 (中心方向の逆) — 内側点との差を再利用
          trx = positions[iC] - cxI;
          tryy = positions[iC + 1] - cyI;
          trz = positions[iC + 2] - czI;
        }

        let nx = tsy * trz - tsz * tryy;
        let ny = tsz * trx - tsx * trz;
        let nz = tsx * tryy - tsy * trx;
        if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        let len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (!isFinite(len) || len < 1e-8) { nx = 0; ny = 0; nz = 1; }
        else { const inv = 1 / len; nx *= inv; ny *= inv; nz *= inv; }
        normals[iC] = nx; normals[iC + 1] = ny; normals[iC + 2] = nz;
      }
    }

    // 中心 (apex): 周囲ファンの面法線平均
    {
      let nx = 0, ny = 0, nz = 0;
      const ax = positions[0], ay = positions[1], az = positions[2];
      for (let s = 0; s < sectors; s++) {
        const sN = (s + 1) % sectors;
        const ia = vidx(0, s) * 3, ib = vidx(0, sN) * 3;
        const vax = positions[ia] - ax, vay = positions[ia + 1] - ay, vaz = positions[ia + 2] - az;
        const vbx = positions[ib] - ax, vby = positions[ib + 1] - ay, vbz = positions[ib + 2] - az;
        nx += vay * vbz - vaz * vby;
        ny += vaz * vbx - vax * vbz;
        nz += vax * vby - vay * vbx;
      }
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      let len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (!isFinite(len) || len < 1e-8) { nx = 0; ny = 0; nz = 1; }
      else { const inv = 1 / len; nx *= inv; ny *= inv; nz *= inv; }
      normals[0] = nx; normals[1] = ny; normals[2] = nz;
    }
  }
}
