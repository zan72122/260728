// js/fx/particles.js — Agent M
// FxSystem: #fx キャンバス用の軽量2Dパーティクル。SPEC-GL.md の Agent M セクション厳守。
// 方針:
//  - 固定長プール(300粒)を Structure-of-Arrays (TypedArray) で確保し、emit/update で
//    新規オブジェクト・新規配列を一切生成しない（GCポーズを避け、モバイルSafariで
//    フレーム落ちしないため）。
//  - 割当はリングバッファ(this._cursor)。常に「次のスロット」へ書き込むだけなので、
//    プールが枯渇している状況では自動的に最古の粒（前回そのスロットが使われた時点が
//    一番古い）を上書きする＝「最古を再利用」を O(1) で満たす。
//  - update(dt) は座標/寿命などの数値計算のみ（ctx 非依存）。node で直接テスト可能。
//  - render(ctx) は #fx の 2D コンテキストのみに依存。ctx.rotate/translate は使わず
//    座標はすべて JS 側で計算した絶対値を渡す（save/restore を避けて軽量化）。
//  - 色は白〜クリームの半透明のみ。加算合成(lighter)は sparkle のきらめきと
//    oilbubble のハイライトだけに、ごく弱く使う。

const POOL_SIZE = 300;

// パーティクル種別 ID
const T_FLOUR = 0;
const T_STEAM = 1;
const T_OIL = 2;
const T_POFF = 3;
const T_SPARKLE = 4;

const NAME_TO_TYPE = {
  flour: T_FLOUR,
  steam: T_STEAM,
  oilbubble: T_OIL,
  poff: T_POFF,
  sparkle: T_SPARKLE,
};

function rand(min, max) {
  return min + Math.random() * (max - min);
}
function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// 汎用フェードエンベロープ: inT までにフェードイン、outStart から寿命末までフェードアウト。
// 0..1 の t (age/life) を受け取り 0..1 の係数を返す。
function envelope(t, inT, outStart) {
  if (t < inT) return inT <= 0 ? 1 : t / inT;
  if (t > outStart) {
    const span = 1 - outStart;
    return span <= 0 ? 0 : Math.max(0, 1 - (t - outStart) / span);
  }
  return 1;
}

export class FxSystem {
  constructor() {
    // --- プール本体 (SoA, 全て固定長 POOL_SIZE の TypedArray) ---
    this._active = new Uint8Array(POOL_SIZE);
    this._type = new Uint8Array(POOL_SIZE);
    this._x = new Float32Array(POOL_SIZE);
    this._y = new Float32Array(POOL_SIZE);
    this._ox = new Float32Array(POOL_SIZE); // 発生原点(steam/oilbubbleの揺れの基準)
    this._oy = new Float32Array(POOL_SIZE);
    this._vx = new Float32Array(POOL_SIZE);
    this._vy = new Float32Array(POOL_SIZE);
    this._age = new Float32Array(POOL_SIZE);
    this._life = new Float32Array(POOL_SIZE);
    this._size = new Float32Array(POOL_SIZE);
    this._rot = new Float32Array(POOL_SIZE);
    this._vrot = new Float32Array(POOL_SIZE);
    this._seed = new Float32Array(POOL_SIZE);
    // 種別ごとに意味が変わる補助スロット(追加のTypedArrayを増やさず使い回す):
    //  steam: auxA=横揺れ振幅(px), auxB=横揺れ周波数(rad/s)
    //  oilbubble: auxA=膨らみ切るまでの寿命比率(0..1)
    this._auxA = new Float32Array(POOL_SIZE);
    this._auxB = new Float32Array(POOL_SIZE);

    this._cursor = 0; // リングバッファ書き込み位置
  }

  // 次に書き込むスロットを返す(リングバッファ、新規生成なし)
  _alloc() {
    const i = this._cursor;
    this._cursor = this._cursor + 1;
    if (this._cursor >= POOL_SIZE) this._cursor = 0;
    return i;
  }

  clear() {
    this._active.fill(0);
    this._cursor = 0;
  }

  /**
   * @param {'flour'|'steam'|'oilbubble'|'poff'|'sparkle'} name
   * @param {number} x
   * @param {number} y
   * @param {object} [opts] strength(倍率, 既定1) / count(粒数) / spread(散らす半径px)
   */
  emit(name, x, y, opts) {
    if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return;
    const type = NAME_TO_TYPE[name];
    if (type === undefined) return;
    const o = opts || {};
    const strength = typeof o.strength === 'number' && isFinite(o.strength) ? o.strength : 1;

    switch (type) {
      case T_FLOUR:
        this._emitPuff(T_FLOUR, x, y, o, strength, {
          count: [4, 7],
          spread: 14,
          size: [3, 6],
          life: [0.7, 1.1],
          upKick: [-55, -25],
        });
        break;
      case T_POFF:
        this._emitPuff(T_POFF, x, y, o, strength, {
          count: [1, 2],
          spread: 6,
          size: [1.5, 3],
          life: [0.32, 0.5],
          upKick: [-32, -16],
        });
        break;
      case T_STEAM:
        this._emitSteam(x, y, o, strength);
        break;
      case T_OIL:
        this._emitOil(x, y, o, strength);
        break;
      case T_SPARKLE:
        this._emitSparkle(x, y, o, strength);
        break;
    }
  }

  _emitPuff(type, x, y, o, strength, cfg) {
    const count = o.count != null ? o.count : randInt(cfg.count[0], cfg.count[1]);
    const spread = o.spread != null ? o.spread : cfg.spread;
    for (let n = 0; n < count; n++) {
      const i = this._alloc();
      this._active[i] = 1;
      this._type[i] = type;
      this._x[i] = x + rand(-spread, spread);
      this._y[i] = y + rand(-spread * 0.6, spread * 0.6);
      this._vx[i] = rand(-18, 18) * strength;
      this._vy[i] = rand(cfg.upKick[0], cfg.upKick[1]) * strength;
      this._age[i] = 0;
      this._life[i] = rand(cfg.life[0], cfg.life[1]);
      this._size[i] = rand(cfg.size[0], cfg.size[1]) * strength;
      this._rot[i] = rand(0, Math.PI * 2);
      this._vrot[i] = rand(-2, 2);
      this._seed[i] = rand(0, Math.PI * 2);
    }
  }

  _emitSteam(x, y, o, strength) {
    const count = o.count != null ? o.count : 1;
    const spread = o.spread != null ? o.spread : 5;
    for (let n = 0; n < count; n++) {
      const i = this._alloc();
      this._active[i] = 1;
      this._type[i] = T_STEAM;
      const sx = x + rand(-spread, spread);
      this._x[i] = sx;
      this._y[i] = y;
      this._ox[i] = sx;
      this._vy[i] = rand(-34, -22) * strength; // 上昇速度(徐々に減衰させる)
      this._age[i] = 0;
      this._life[i] = rand(1.0, 1.6);
      this._size[i] = rand(5, 9) * strength;
      this._seed[i] = rand(0, Math.PI * 2);
      this._auxA[i] = rand(6, 11) * strength; // 横揺れ振幅
      this._auxB[i] = rand(1.6, 2.6); // 横揺れ周波数
    }
  }

  _emitOil(x, y, o, strength) {
    const count = o.count != null ? o.count : randInt(1, 2);
    const spread = o.spread != null ? o.spread : 12;
    for (let n = 0; n < count; n++) {
      const i = this._alloc();
      this._active[i] = 1;
      this._type[i] = T_OIL;
      const bx = x + rand(-spread, spread);
      const by = y + rand(-spread * 0.5, spread * 0.5);
      this._x[i] = bx;
      this._y[i] = by;
      this._ox[i] = bx;
      this._oy[i] = by;
      this._age[i] = 0;
      this._life[i] = rand(0.5, 0.9);
      this._size[i] = rand(2.5, 6) * strength;
      this._seed[i] = rand(0, Math.PI * 2);
      this._auxA[i] = rand(0.62, 0.8); // 膨らみ切るまでの寿命比率、その後ぷちっと弾ける
    }
  }

  _emitSparkle(x, y, o, strength) {
    const count = o.count != null ? o.count : randInt(5, 9);
    const spread = o.spread != null ? o.spread : 18;
    for (let n = 0; n < count; n++) {
      const i = this._alloc();
      this._active[i] = 1;
      this._type[i] = T_SPARKLE;
      this._x[i] = x + rand(-spread, spread);
      this._y[i] = y + rand(-spread, spread);
      this._vx[i] = rand(-8, 8) * strength;
      this._vy[i] = rand(-14, -6) * strength;
      this._age[i] = 0;
      this._life[i] = rand(0.6, 1.0);
      this._size[i] = rand(3, 6) * strength;
      this._rot[i] = rand(0, Math.PI * 2);
      this._vrot[i] = rand(-1.5, 1.5);
      this._seed[i] = rand(0, Math.PI * 2);
    }
  }

  /** @param {number} dt 秒 */
  update(dt) {
    if (!(typeof dt === 'number') || !isFinite(dt) || dt <= 0) return;
    const active = this._active;
    const age = this._age;
    const life = this._life;
    for (let i = 0; i < POOL_SIZE; i++) {
      if (!active[i]) continue;
      age[i] += dt;
      if (age[i] >= life[i]) {
        active[i] = 0;
        continue;
      }
      const type = this._type[i];
      if (type === T_FLOUR || type === T_POFF) {
        this._updatePuff(i, dt);
      } else if (type === T_STEAM) {
        this._updateSteam(i, dt);
      } else if (type === T_OIL) {
        this._updateOil(i);
      } else if (type === T_SPARKLE) {
        this._updateSparkle(i, dt);
      }
    }
  }

  _updatePuff(i, dt) {
    // ふわっと舞って、ゆっくり重力で落ちる。空気抵抗で横速度は減衰し、
    // 微小なサイン揺れで漂う質感を足す。
    this._vy[i] += 55 * dt; // 穏やかな重力
    const drag = 1 - 1.6 * dt;
    this._vx[i] *= drag > 0 ? drag : 0;
    const flutter = Math.sin((this._age[i] + this._seed[i]) * 3.0) * 5;
    this._x[i] += this._vx[i] * dt + flutter * dt;
    this._y[i] += this._vy[i] * dt;
    this._rot[i] += this._vrot[i] * dt;
  }

  _updateSteam(i, dt) {
    // 上へ立ち上りながら減速し、原点を中心にサインカーブで左右にゆらぐ。
    const damp = 1 - 0.22 * dt;
    this._vy[i] *= damp > 0 ? damp : 0;
    this._y[i] += this._vy[i] * dt;
    const t = this._age[i] / this._life[i];
    const swayGrow = Math.min(1, t / 0.4);
    this._x[i] =
      this._ox[i] + Math.sin(this._age[i] * this._auxB[i] + this._seed[i]) * this._auxA[i] * swayGrow;
  }

  _updateOil(i) {
    // 揚げ油の中でふるふる小刻みに揺れる(位置は原点からのごく小さなオフセット)。
    this._x[i] = this._ox[i] + Math.sin(this._age[i] * 7.0 + this._seed[i]) * 1.3;
    this._y[i] = this._oy[i] + Math.sin(this._age[i] * 5.3 + this._seed[i] * 1.9) * 1.1;
  }

  _updateSparkle(i, dt) {
    const damp = 1 - 0.6 * dt;
    const d = damp > 0 ? damp : 0;
    this._vx[i] *= d;
    this._vy[i] *= d;
    this._x[i] += this._vx[i] * dt;
    this._y[i] += this._vy[i] * dt;
    this._rot[i] += this._vrot[i] * dt;
  }

  /** @param {CanvasRenderingContext2D} ctx #fx の 2D コンテキスト */
  render(ctx) {
    const active = this._active;
    for (let i = 0; i < POOL_SIZE; i++) {
      if (!active[i]) continue;
      const type = this._type[i];
      const t = clamp01(this._age[i] / this._life[i]);
      if (type === T_FLOUR) {
        this._renderPuff(ctx, i, t, 3, '255,250,240', 0.55);
      } else if (type === T_POFF) {
        this._renderPuff(ctx, i, t, 2, '255,250,240', 0.42);
      } else if (type === T_STEAM) {
        this._renderSteam(ctx, i, t);
      } else if (type === T_OIL) {
        this._renderOil(ctx, i, t);
      } else if (type === T_SPARKLE) {
        this._renderSparkle(ctx, i, t);
      }
    }
    // 後片付け: どのパーティクルも lighter を使い残さないようにする
    ctx.globalCompositeOperation = 'source-over';
  }

  // 粉パフ(flour/poff共通): 小さな円を数枚重ねてもこもこした雲の輪郭にする。
  // 単純な円の重なりなので createRadialGradient を作らずに済み軽い。
  _renderPuff(ctx, i, t, petals, rgb, alphaCap) {
    const a = alphaCap * envelope(t, 0.1, 0.55);
    if (a <= 0.004) return;
    const x = this._x[i];
    const y = this._y[i];
    const size = this._size[i];
    const rot = this._rot[i];
    ctx.fillStyle = `rgba(${rgb},${a.toFixed(3)})`;
    for (let k = 0; k < petals; k++) {
      const ang = rot + (k * Math.PI * 2) / petals + 0.4;
      const ox = Math.cos(ang) * size * 0.32;
      const oy = Math.sin(ang) * size * 0.32 * 0.75;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, size * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 湯気: サインカーブで揺れながら上る、縦長の柔らかい楕円を2枚重ね。
  _renderSteam(ctx, i, t) {
    const a = 0.34 * envelope(t, 0.16, 0.35);
    if (a <= 0.004) return;
    const x = this._x[i];
    const y = this._y[i];
    const widthMul = 0.45 + 0.55 * Math.min(1, t * 2.2);
    const rx = this._size[i] * widthMul;
    const ry = rx * 1.85;
    ctx.fillStyle = `rgba(255,255,255,${(a * 0.5).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx * 1.4, ry * 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 油泡: 生まれてから膨らみ(0..growPortion)、その後ぷちっと弾けて消える(growPortion..1)。
  // ハイライトだけ lighter でごく淡く。
  _renderOil(ctx, i, t) {
    const growPortion = this._auxA[i];
    const size = this._size[i];
    let radiusMul;
    let a;
    if (t < growPortion) {
      const gt = growPortion <= 0 ? 1 : t / growPortion;
      radiusMul = 0.15 + gt * 0.85;
      a = Math.min(1, gt / 0.3) * 0.5;
    } else {
      const span = 1 - growPortion;
      const pt = span <= 0 ? 1 : (t - growPortion) / span;
      radiusMul = 1 + pt * 0.55;
      a = (1 - pt) * (1 - pt) * 0.5;
    }
    if (a <= 0.004) return;
    const x = this._x[i];
    const y = this._y[i];
    const r = Math.max(0.5, size * radiusMul);
    const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${(a * 0.9).toFixed(3)})`);
    grad.addColorStop(0.55, `rgba(255,241,214,${(a * 0.55).toFixed(3)})`);
    grad.addColorStop(1, `rgba(255,224,170,${(a * 0.12).toFixed(3)})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,255,255,${(a * 0.4).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x - r * 0.32, y - r * 0.32, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // きらきら: 淡いグロー(lighter, ごく弱)+ 4角の星形(通常合成)。twinkleでちらつく。
  _renderSparkle(ctx, i, t) {
    const twinkle = 0.55 + 0.45 * Math.sin(this._age[i] * 9 + this._seed[i]);
    const env = envelope(t, 0.06, 0.65);
    const a = env * twinkle;
    if (a <= 0.004) return;
    const x = this._x[i];
    const y = this._y[i];
    const size = this._size[i];
    const rot = this._rot[i];

    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,250,230,${(a * 0.18).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, size * 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    const outerR = size;
    const innerR = size * 0.38;
    ctx.fillStyle = `rgba(255,253,240,${(a * 0.9).toFixed(3)})`;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const ang = rot + (k * Math.PI) / 4;
      const rr = k % 2 === 0 ? outerR : innerR;
      const px = x + Math.cos(ang) * rr;
      const py = y + Math.sin(ang) * rr;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
}
