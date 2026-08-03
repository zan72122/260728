// js/dough/model.js — Agent A
// DoughModel: 48点の放射状ばねモデルによる生地物理エンジン。
// SPEC.md の Agent A セクション（公開プロパティ / メソッド）を厳守。

import { DOUGH_PRESETS } from './presets.js';

const N = 48; // 制御点数(固定)
const MAX_DENTS = 16; // dents リングバッファの最大数 (SPEC-GL 1)

function clamp(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return lo;
  return v < lo ? lo : (v > hi ? hi : v);
}
function clamp01(v) {
  return clamp(v, 0, 1);
}
// index から安定した 0..1 の疑似乱数 (dents のわずかなばらつき用。呼び出し毎にちらつかない)
function hash01Local(i) {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// 角度差を [-PI, PI] に正規化
function angularDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class DoughModel {
  constructor(presetId) {
    this.center = { x: 0, y: 0 };
    this._scale = 1;
    this._grab = null;
    this._grabBaseRestR = null;
    this._wobblePhase = Math.random() * Math.PI * 2;
    this._rBuf = new Array(N).fill(0);
    this._twistAccum = 0;
    this.wobble = 0.5;
    this.bubbles = [];
    // dents: 指のへこみ表現 (SPEC-GL 1)。固定長リングバッファ。
    // オブジェクトはここで一度だけ生成し、以後は使い回す (割り当てゼロ原則)。
    this.dents = new Array(MAX_DENTS);
    for (let i = 0; i < MAX_DENTS; i++) {
      this.dents[i] = { x: 0, y: 0, r: 0, depth: 0, age: 0 };
    }
    this._dentHead = 0;
    this._init(presetId);
  }

  // 生地種切り替え/初期化 (constructor と reset() 共用)
  _init(presetId) {
    let preset = DOUGH_PRESETS[presetId];
    if (!preset) {
      presetId = 'soft_yeast';
      preset = DOUGH_PRESETS[presetId];
    }
    this.presetId = presetId;
    this.preset = preset;
    // props/behavior はプリセットの共有オブジェクトを汚さないよう複製する
    this.p = { ...preset.props };
    this.behavior = { ...preset.behavior };

    const W = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 300;
    const H = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 300;
    this.R0 = Math.min(W, H) * 0.26;
    if (!isFinite(this.R0) || this.R0 <= 0) this.R0 = 78;

    this.points = new Array(N);
    for (let i = 0; i < N; i++) {
      const angle = (i / N) * Math.PI * 2;
      const x = this.center.x + Math.cos(angle) * this.R0;
      const y = this.center.y + Math.sin(angle) * this.R0;
      this.points[i] = { angle, restR: this.R0, r: this.R0, vr: 0, x, y, th: 1.0 };
    }

    this.fillings = [];
    this.patterns = [];
    this.topping = null;
    this.crackAmount = 0;
    this.holeR = 0;
    this.bubbles = [];
    this._twistAccum = 0;
    this._grab = null;
    this._grabBaseRestR = null;
    this._wobblePhase = Math.random() * Math.PI * 2;
    this.wobble = 0.5;

    // dents クリア (配列/オブジェクトは再割り当てせず中身だけ初期化)
    if (this.dents) {
      for (let i = 0; i < this.dents.length; i++) {
        const d = this.dents[i];
        d.x = 0; d.y = 0; d.r = 0; d.depth = 0; d.age = 0;
      }
    }
    this._dentHead = 0;
  }

  reset(presetId) {
    this._init(presetId);
  }

  // dents リングバッファへ中心相対座標でへこみを1つ書き込む (新規割り当てなし)
  _pushDent(xRel, yRel, r, depth) {
    const dents = this.dents;
    if (!dents || dents.length === 0) return;
    if (!isFinite(xRel) || !isFinite(yRel) || !isFinite(depth) || depth <= 0) return;
    const d = dents[this._dentHead];
    d.x = xRel;
    d.y = yRel;
    d.r = isFinite(r) && r > 0 ? r : this.R0 * 0.15;
    d.depth = depth;
    d.age = 0;
    this._dentHead = (this._dentHead + 1) % dents.length;
  }

  _maxRestR() {
    let m = 0;
    for (let i = 0; i < this.points.length; i++) {
      if (this.points[i].restR > m) m = this.points[i].restR;
    }
    return m;
  }

  // ==== 物理更新 ====================================================
  update(dt) {
    if (typeof dt !== 'number' || !isFinite(dt) || dt < 0) dt = 0.016;
    dt = Math.min(dt, 0.05);

    const R0 = this.R0;
    const N2 = this.points.length;
    const p = this.p;
    const beh = this.behavior;

    // 1. 発酵によるゆっくりとした成長 (restR が目標へ緩やかに近づく)
    const fermentBoost = clamp01(p.ferment) * clamp01(beh.fermentPower);
    const growTarget = R0 * (1 + fermentBoost * 0.9);
    const growLerp = Math.min(1, 0.5 * dt);
    for (let i = 0; i < N2; i++) {
      const pt = this.points[i];
      if (pt.restR < growTarget) {
        pt.restR += (growTarget - pt.restR) * growLerp;
      }
    }

    // 2. だれ/流れ (liquid ほど強い): restR が全体平均へ緩和 + わずかな重力偏り
    const flow = clamp01(beh.flowiness);
    if (flow > 0.01) {
      let avg = 0;
      for (let i = 0; i < N2; i++) avg += this.points[i].restR;
      avg /= N2;
      const flowLerp = Math.min(1, flow * 0.6 * dt);
      for (let i = 0; i < N2; i++) {
        const pt = this.points[i];
        pt.restR += (avg - pt.restR) * flowLerp;
        pt.restR += Math.sin(pt.angle) * flow * R0 * 0.01 * dt; // 下方向へわずかに垂れる
        pt.restR = clamp(pt.restR, 0.15 * R0, 2.6 * R0);
      }
    }

    // 3. ばね積分: r が restR へ (弾力/減衰に応じ) 追従
    const springK = (2.5 + 20 * clamp01(p.elasticity)) * (0.25 + 0.8 * clamp01(beh.reboundRate));
    const dampingRatio = Math.max(0.15, 1.5 - 1.0 * clamp01(beh.reboundRate));
    const damping = 2 * Math.sqrt(Math.max(0.0001, springK)) * dampingRatio;
    for (let i = 0; i < N2; i++) {
      const pt = this.points[i];
      let accel = -springK * (pt.r - pt.restR) - damping * pt.vr;
      if (!isFinite(accel)) accel = 0;
      pt.vr += accel * dt;
      pt.vr = clamp(pt.vr, -R0 * 8, R0 * 8);
      pt.r += pt.vr * dt;
      if (!isFinite(pt.r)) { pt.r = pt.restR; pt.vr = 0; }
      pt.r = clamp(pt.r, 0.15 * R0, 2.6 * R0);
    }

    // 4. 隣接平滑化 (表面張力) — バッファ使い回しで新規配列割り当てを回避
    const smoothK = clamp((0.15 + 1.3 * clamp01(p.surfaceTension)) * dt * 2.2, 0, 0.9);
    const buf = this._rBuf;
    for (let i = 0; i < N2; i++) {
      const prev = this.points[(i - 1 + N2) % N2].r;
      const next = this.points[(i + 1) % N2].r;
      const cur = this.points[i].r;
      buf[i] = cur + ((prev + next) * 0.5 - cur) * smoothK;
    }
    for (let i = 0; i < N2; i++) {
      this.points[i].r = clamp(buf[i], 0.15 * R0, 2.6 * R0);
    }

    // 5. 呼吸位相 (発酵の脈動)
    this._wobblePhase += dt * (2 * Math.PI / 2.4);
    if (this._wobblePhase > 6283.0) this._wobblePhase -= 6283.0; // 長時間実行での桁溢れ防止
    this.wobble = 0.5 + 0.5 * Math.sin(this._wobblePhase) * clamp01(p.air);

    // 6. 座標確定 (スケール + 呼吸を視覚的に上乗せ。r 自体は変更しない)
    const breathAmp = 0.05 * clamp01(p.air) * R0;
    const breath = Math.sin(this._wobblePhase) * breathAmp;
    const s = (isFinite(this._scale) && this._scale > 0) ? this._scale : 1;
    for (let i = 0; i < N2; i++) {
      const pt = this.points[i];
      const rr = (pt.r + breath) * s;
      const nx = this.center.x + Math.cos(pt.angle) * rr;
      const ny = this.center.y + Math.sin(pt.angle) * rr;
      pt.x = isFinite(nx) ? nx : this.center.x;
      pt.y = isFinite(ny) ? ny : this.center.y;
      pt.th = clamp(pt.th, 0.3, 3.0);
    }

    // 7. dents (指のへこみ) の減衰 — SPEC-GL 1。
    //    減衰速度は p.elasticity と behavior.reboundRate に比例(弾力のある生地ほど早く戻る)。
    //    liquid はほぼ減衰しない。焼成後(bakeColor>0.5)はへこみがほぼ残らない硬さになる。
    {
      const reboundFactor = 0.2 + 1.8 * clamp01(beh.reboundRate);
      const elasticFactor = 0.2 + 1.8 * clamp01(p.elasticity);
      let decayRate = 0.12 * reboundFactor * elasticFactor; // 1/秒 (指数減衰)
      if (clamp01(p.bakeColor) > 0.5) decayRate *= 8;
      if (!isFinite(decayRate) || decayRate < 0) decayRate = 0;
      const decayMul = Math.exp(-decayRate * dt);
      const dents = this.dents;
      if (dents) {
        for (let i = 0; i < dents.length; i++) {
          const d = dents[i];
          if (d.depth <= 0) continue;
          d.age += dt;
          d.depth *= decayMul;
          if (d.depth < 0.02) d.depth = 0;
        }
      }
    }
  }

  // ==== ジェスチャ操作 ================================================

  poke(x, y, strength) {
    strength = clamp01(strength);
    const R0 = this.R0;
    const sigma = R0 * 0.7;
    const soft = 0.35 + 0.9 * clamp01(this.p.softness);
    const dentAmt = strength * R0 * 0.4 * soft * (1 - 0.3 * clamp01(this.p.elasticity));
    const bulgeAmt = strength * R0 * 0.16 * soft;
    const crumble = clamp01(this.behavior.crumbleTendency);
    for (let i = 0; i < this.points.length; i++) {
      const pt = this.points[i];
      const ddx = pt.x - x, ddy = pt.y - y;
      const d2 = ddx * ddx + ddy * ddy;
      const d = Math.sqrt(d2);
      const wCore = Math.exp(-d2 / (2 * sigma * sigma));
      const ringDist = d - sigma * 1.2;
      const wRing = Math.exp(-(ringDist * ringDist) / (2 * (sigma * 0.55) * (sigma * 0.55)));
      let delta = -dentAmt * wCore + bulgeAmt * wRing;
      delta -= crumble * strength * wCore * R0 * 0.05; // 一部が戻らずほろりと欠ける
      pt.restR = clamp(pt.restR + delta, 0.15 * R0, 2.6 * R0);
      pt.vr += delta * 3.0; // 即座の弾みで応答を軽くする
    }
    const crack = clamp01(this.behavior.crackTendency);
    if (crack > 0) {
      this.crackAmount = clamp01(this.crackAmount + strength * crack * 0.06);
    }
    if (crumble > 0) {
      this.crackAmount = clamp01(this.crackAmount + strength * crumble * 0.03);
    }

    // dents: 指で押した深いへこみ (SPEC-GL 1)。strength に比例。
    this._pushDent(x - this.center.x, y - this.center.y, R0 * 0.32, strength * R0 * 0.5 * soft);
  }

  grabStart(x, y) {
    const maxR = this._maxRestR() * 1.05 || this.R0;
    let relX = x - this.center.x, relY = y - this.center.y;
    const dist = Math.hypot(relX, relY);
    if (dist > maxR && dist > 0) {
      const s = maxR / dist;
      relX *= s; relY *= s;
      x = this.center.x + relX;
      y = this.center.y + relY;
    }
    this._grabBaseRestR = this.points.map((pt) => pt.restR);
    this._grab = { x, y };
  }

  grabMove(x, y, dx, dy) {
    if (!this._grab) this.grabStart(x, y);
    const g = this._grab;
    const R0 = this.R0;
    const relX = x - this.center.x, relY = y - this.center.y;
    const angGrab = Math.atan2(relY, relX);
    const dist = Math.hypot(dx || 0, dy || 0);
    g.x = x; g.y = y;
    if (!isFinite(dist) || dist <= 0) return;

    const stretchAmt = dist * (0.6 + 1.4 * clamp01(this.p.stretchiness)) * (0.4 + 0.9 * clamp01(this.behavior.stretchLimit));
    const sigma = 0.65; // rad
    const maxDelta = R0 * (0.25 + 2.1 * clamp01(this.behavior.stretchLimit));
    for (let i = 0; i < this.points.length; i++) {
      const pt = this.points[i];
      const dAng = angularDiff(pt.angle, angGrab);
      const w = Math.exp(-(dAng * dAng) / (2 * sigma * sigma));
      const dOpp = angularDiff(pt.angle, angGrab + Math.PI);
      const wOpp = Math.exp(-(dOpp * dOpp) / (2 * sigma * sigma));
      let delta = w * stretchAmt - wOpp * stretchAmt * 0.35; // 反対側はわずかに痩せる
      delta = clamp(delta, -maxDelta, maxDelta);
      pt.restR = clamp(pt.restR + delta, 0.15 * R0, 2.6 * R0);
    }

    const crack = clamp01(this.behavior.crackTendency);
    const stretchLimit = clamp01(this.behavior.stretchLimit);
    if (crack > 0) {
      const over = Math.max(0, stretchAmt / R0 - stretchLimit);
      if (over > 0) this.crackAmount = clamp01(this.crackAmount + over * crack * 0.05);
    }

    // dents: 引きずり方向に浅い溝状のへこみ (SPEC-GL 1)。
    // grabMove は連続発火するため、毎フレーム少しずつ位置をずらして書き込むと
    // リングバッファ上で自然に「溝」の軌跡になる。
    const grooveDepth = clamp(dist * 0.12 * (0.3 + 0.9 * clamp01(this.p.stretchiness)), 0, R0 * 0.1);
    this._pushDent(x - this.center.x, y - this.center.y, R0 * 0.14, grooveDepth);
  }

  grabEnd() {
    if (this._grab && this._grabBaseRestR) {
      const reb = clamp01(0.15 * clamp01(this.p.elasticity) + 0.85 * clamp01(this.behavior.reboundRate));
      for (let i = 0; i < this.points.length; i++) {
        const base = this._grabBaseRestR[i];
        const pt = this.points[i];
        pt.restR = pt.restR + (base - pt.restR) * reb;
      }
    }
    this._grab = null;
    this._grabBaseRestR = null;
  }

  knead(x, y, intensity) {
    intensity = clamp01(intensity);
    const R0 = this.R0;
    const gain = intensity * (0.15 + 0.85 * clamp01(this.behavior.springiness));

    // こねるほど弾力/表面張力が増し、空気が抜ける(ペナルティなし・個性が育つ)
    this.p.elasticity = clamp01(this.p.elasticity + (1 - this.p.elasticity) * 0.06 * gain);
    this.behavior.springiness = clamp01(this.behavior.springiness + (1 - this.behavior.springiness) * 0.04 * gain);
    this.p.air = clamp01(this.p.air - this.p.air * 0.05 * intensity);
    this.p.surfaceTension = clamp01(this.p.surfaceTension + (1 - this.p.surfaceTension) * 0.05 * intensity);

    const sigma = R0 * 0.7;
    let wsum = 0, wrsum = 0;
    for (let i = 0; i < this.points.length; i++) {
      const pt = this.points[i];
      const ddx = pt.x - x, ddy = pt.y - y;
      const d2 = ddx * ddx + ddy * ddy;
      const w = Math.exp(-d2 / (2 * sigma * sigma));
      wsum += w; wrsum += w * pt.restR;
    }
    const localMean = wsum > 0 ? wrsum / wsum : R0;
    for (let i = 0; i < this.points.length; i++) {
      const pt = this.points[i];
      const ddx = pt.x - x, ddy = pt.y - y;
      const d2 = ddx * ddx + ddy * ddy;
      const w = Math.exp(-d2 / (2 * sigma * sigma));
      pt.restR = clamp(pt.restR + (localMean - pt.restR) * w * 0.35 * intensity, 0.15 * R0, 2.6 * R0);
    }

    const crack = clamp01(this.behavior.crackTendency);
    const crumble = clamp01(this.behavior.crumbleTendency);
    if (crack > 0 || crumble > 0) {
      this.crackAmount = clamp01(this.crackAmount + intensity * (crack * 0.015 + crumble * 0.02));
    }

    // dents: こねる指の浅いへこみを複数 (SPEC-GL 1)。中心点 + 少しずらした点。
    const shallowR = R0 * 0.16;
    const shallowDepth = intensity * R0 * 0.09;
    this._pushDent(x - this.center.x, y - this.center.y, shallowR, shallowDepth);
    const off = R0 * 0.1;
    this._pushDent(
      x - this.center.x + (hash01Local(this._dentHead) - 0.5) * off,
      y - this.center.y + (hash01Local(this._dentHead + 7) - 0.5) * off,
      shallowR * 0.75,
      shallowDepth * 0.65
    );
  }

  fold(angleRad) {
    const R0 = this.R0;
    this.p.layers = Math.min(((this.p.layers | 0) || 1) + 1, 12);
    for (let i = 0; i < this.points.length; i++) {
      const pt = this.points[i];
      const c = Math.cos(pt.angle - angleRad);
      const axisW = c * c; // 折り軸の両端で1、直交で0
      pt.restR = clamp(pt.restR - axisW * R0 * 0.2 + (1 - axisW) * R0 * 0.06, 0.15 * R0, 2.6 * R0);
      pt.th = Math.min(2.5, pt.th + axisW * 0.3);
    }
    const crack = clamp01(this.behavior.crackTendency);
    if (crack > 0) {
      this.crackAmount = clamp01(this.crackAmount + 0.02 * crack);
    }
    this.p.surfaceTension = clamp01(this.p.surfaceTension + 0.02);
  }

  roundUp(quality) {
    quality = clamp01(quality);
    const R0 = this.R0;
    let avg = 0;
    for (let i = 0; i < this.points.length; i++) avg += this.points[i].restR;
    avg /= this.points.length;
    const strength = 0.12 + 0.65 * quality;
    for (let i = 0; i < this.points.length; i++) {
      const pt = this.points[i];
      pt.restR = clamp(pt.restR + (avg - pt.restR) * strength, 0.15 * R0, 2.6 * R0);
      pt.th += (1 - pt.th) * strength * 0.3;
    }
    this.p.surfaceTension = clamp01(this.p.surfaceTension + 0.06 * quality);
  }

  elongate(angleRad, amount) {
    amount = clamp(amount, 0, 2.5);
    const R0 = this.R0;
    const sl = clamp01(this.behavior.stretchLimit);
    const along = amount * R0 * (0.3 + 1.6 * sl);
    const across = amount * R0 * (0.12 + 0.45 * sl) * 0.6;
    for (let i = 0; i < this.points.length; i++) {
      const pt = this.points[i];
      const c = Math.cos(pt.angle - angleRad);
      const axisW = c * c;
      const delta = axisW * along - (1 - axisW) * across;
      pt.restR = clamp(pt.restR + delta, 0.15 * R0, 2.6 * R0);
    }
    const crack = clamp01(this.behavior.crackTendency);
    if (amount > sl && crack > 0) {
      this.crackAmount = clamp01(this.crackAmount + (amount - sl) * crack * 0.15);
    }
  }

  twist(deltaRad) {
    if (typeof deltaRad !== 'number' || !isFinite(deltaRad)) return;
    const R0 = this.R0;
    for (let s = 0; s < this.patterns.length; s++) {
      const stroke = this.patterns[s];
      for (let i = 0; i < stroke.length; i++) {
        const pt = stroke[i];
        const r = Math.hypot(pt.x, pt.y);
        const a = Math.atan2(pt.y, pt.x);
        const tf = 1 + Math.min(2, r / R0) * 0.6; // 外側ほど渦を強く巻く
        const na = a + deltaRad * tf;
        pt.x = Math.cos(na) * r;
        pt.y = Math.sin(na) * r;
      }
    }
    this._twistAccum += deltaRad;
    const mag = Math.min(1, Math.abs(deltaRad) * 8);
    for (let i = 0; i < this.points.length; i++) {
      const pt = this.points[i];
      pt.restR = clamp(
        pt.restR + Math.sin(pt.angle * 3 + this._twistAccum * 2) * R0 * 0.012 * mag,
        0.15 * R0, 2.6 * R0
      );
    }
  }

  addPattern(strokePoints) {
    if (!Array.isArray(strokePoints) || strokePoints.length === 0) return;
    const rel = new Array(strokePoints.length);
    for (let i = 0; i < strokePoints.length; i++) {
      rel[i] = { x: strokePoints[i].x - this.center.x, y: strokePoints[i].y - this.center.y };
    }
    this.patterns.push(rel);
  }

  addFilling(type, x, y, amount) {
    const R0 = this.R0;
    const rx = x - this.center.x, ry = y - this.center.y;
    amount = clamp01(amount);
    let f = null;
    for (let i = 0; i < this.fillings.length; i++) {
      const fi = this.fillings[i];
      if (fi.type === type && Math.hypot(fi.x - rx, fi.y - ry) < R0 * 0.3) { f = fi; break; }
    }
    if (f) {
      f.amount = clamp01(f.amount + amount);
      f.x = (f.x + rx) / 2;
      f.y = (f.y + ry) / 2;
    } else {
      f = { type, x: rx, y: ry, amount };
      this.fillings.push(f);
    }
    const ang = Math.atan2(ry, rx);
    for (let i = 0; i < this.points.length; i++) {
      const pt = this.points[i];
      const d = angularDiff(pt.angle, ang);
      const w = Math.exp(-(d * d) / (2 * 0.5 * 0.5));
      pt.restR = clamp(pt.restR + w * amount * R0 * 0.05, 0.15 * R0, 2.6 * R0);
      pt.th = Math.min(2.2, pt.th + w * amount * 0.12);
    }
  }

  applyTopping() {
    this.topping = { presetId: 'melon_topping', crack: 0 };
  }

  pokeHole(x, y) {
    const R0 = this.R0;
    const dx = x - this.center.x, dy = y - this.center.y;
    const dist = Math.hypot(dx, dy);
    if (dist < R0 * 0.45) {
      this.holeR = clamp((this.holeR || 0) + R0 * 0.1, 0, R0 * 0.6);
      // 穴周囲がリング状に均される
      let avg = 0;
      for (let i = 0; i < this.points.length; i++) avg += this.points[i].restR;
      avg /= this.points.length;
      for (let i = 0; i < this.points.length; i++) {
        const pt = this.points[i];
        pt.restR = clamp(pt.restR + (avg - pt.restR) * 0.06, 0.15 * R0, 2.6 * R0);
      }
    }
  }

  setScale(s) {
    if (isFinite(s) && s > 0) this._scale = s;
  }

  snapshot() {
    const pts = this.points;
    const n = pts.length;
    const outline = new Array(n);
    let sumR = 0;
    for (let i = 0; i < n; i++) {
      const pt = pts[i];
      outline[i] = { x: Math.cos(pt.angle) * pt.r, y: Math.sin(pt.angle) * pt.r, th: pt.th };
      sumR += pt.r;
    }
    const patterns = this.patterns.map((stroke) => stroke.map((pt) => ({ x: pt.x, y: pt.y })));
    const fillings = this.fillings.map((f) => ({ type: f.type, x: f.x, y: f.y, amount: f.amount }));

    return {
      presetId: this.presetId,
      baseColor: this.preset.baseColor,
      bakedColor: this.preset.bakedColor,
      outline,
      holeR: this.holeR,
      thickness: this.p.thickness,
      layers: this.p.layers,
      bakeColor: this.p.bakeColor,
      crackAmount: this.crackAmount,
      topping: this.topping ? { crack: this.topping.crack } : null,
      patterns,
      fillings,
      air: this.p.air,
      ferment: this.p.ferment,
      size: (sumR / n) / this.R0,
    };
  }
}
