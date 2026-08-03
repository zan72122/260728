// js/game/forest.js — Agent E
// 「パンの森」パノラマ。歩き回れない一枚絵。完成したパンを kind ごとの定位置に置いていく。
// 画像アセットは使わず Canvas 2D で完全手描き。柔らかい曲線のみ、輪郭線は使わない。

import { renderSnapshot } from '../dough/render.js';
import { Sound } from '../audio/sound.js';
import { getBread } from './breads.js';

const STORAGE_KEY = 'panforest-v1';
const MAX_TOTAL = 36; // 全体上限 (SPEC-GL 4)。超えたら最古を置換する。kind別上限は廃止。
const PLACE_ANIM_SEC = 2.0;
const SAVE_EVICT_ATTEMPTS = 24; // localStorage quota 超過時、最古から間引いて再試行する上限回数

// 色調（SPEC 基調色）
const COL = {
  cream: '#FFF6E3',
  pink: '#FFD9E0',
  blue: '#CDEDF6',
  green: '#D5EFD0',
};

// kind ごとの定位置ゾーン（W,H に対する割合座標）と基準スケール。
// x,y はパンの中心を置く位置、r はゾーンの見た目の広がり（散らし半径の目安）。
const ZONES = {
  house: { x: 0.15, y: 0.62, r: 0.05, scale: 0.62 },
  mountain: { x: 0.09, y: 0.34, r: 0.045, scale: 0.85 },
  hill: { x: 0.38, y: 0.66, r: 0.06, scale: 0.55 },
  cloud: { x: 0.52, y: 0.15, r: 0.05, scale: 0.5 },
  flower: { x: 0.58, y: 0.75, r: 0.035, scale: 0.4 },
  stone: { x: 0.30, y: 0.83, r: 0.03, scale: 0.35 },
  berry: { x: 0.68, y: 0.80, r: 0.03, scale: 0.35 },
  stump: { x: 0.80, y: 0.47, r: 0.035, scale: 0.5 },
  lantern: { x: 0.63, y: 0.40, r: 0.03, scale: 0.4 },
  pebbles: { x: 0.48, y: 0.88, r: 0.055, scale: 0.32 },
  friend: { x: 0.86, y: 0.68, r: 0.035, scale: 0.42 },
  path: { x: 0.44, y: 0.93, r: 0.06, scale: 0.45 },
  moon: { x: 0.14, y: 0.10, r: 0.04, scale: 0.5 },
  swirl: { x: 0.34, y: 0.43, r: 0.03, scale: 0.4 },
  pond: { x: 0.76, y: 0.87, r: 0.06, scale: 0.5 },
  sun: { x: 0.88, y: 0.12, r: 0.04, scale: 0.55 },
  mushroom: { x: 0.23, y: 0.90, r: 0.03, scale: 0.4 },
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function safeSfx(name, opts) {
  try {
    Sound && Sound.sfx && Sound.sfx(name, opts);
  } catch (e) {
    // 音が鳴らせなくてもゲームは止めない
  }
}

// index から決定論的な散らしオフセット（golden angle）を作る。毎回同じ並びになる。
function scatterOffset(i, zoneR) {
  const ang = i * 2.399963; // 黄金角
  const rad = zoneR * (0.25 + 0.7 * ((i * 0.61803398875) % 1));
  return {
    dx: Math.cos(ang) * rad,
    dy: Math.sin(ang) * rad * 0.5, // 奥行き感を出すため縦を潰す
  };
}

export class Forest {
  constructor() {
    /** @type {Object<string, Array<{breadId:string, snapshot:any, placedAt:number}>>} */
    this.items = {};
    // 背景キャッシュ（renderBackdrop 用）。document には触れず、初回 render 時に遅延生成。
    this._backdropCanvas = null;
    this._backdropCtx = null;
    this._backdropSize = { w: 0, h: 0 };
    // 全体上限の「最古」判定用の単調増加シーケンス。Date.now() は同一ミリ秒内に
    // 複数配置されると同値になり得るため、置換順の一意性はこちらで保証する
    // (load() で復元したものには先にこのシーケンスを振り、常にそれより新しくなるようにする)。
    this._placeSeq = 0;
  }

  _nextSeq() {
    this._placeSeq += 1;
    return this._placeSeq;
  }

  /**
   * 完成パンを森に配置する。
   * 全体で最大 MAX_TOTAL 個まで蓄積し、超えたら kind をまたいで最古を置換する。
   * @param {string} breadId
   * @param {any} snapshot dough.snapshot() の返り値
   */
  place(breadId, snapshot) {
    const bread = getBread(breadId);
    const kind = (bread && bread.forest && bread.forest.kind) || 'stone';
    if (!this.items[kind]) this.items[kind] = [];
    const list = this.items[kind];
    const entry = { breadId, snapshot, placedAt: Date.now(), _seq: this._nextSeq() };
    list.push(entry);
    this._ensureImage(entry); // snapshot.image があれば Image のデコードをここで開始 (一度だけ生成)
    this._enforceGlobalCap();
    safeSfx('place', { gain: 0.8 });
  }

  /** 配置されているパンの総数 */
  count() {
    let n = 0;
    for (const k in this.items) n += this.items[k].length;
    return n;
  }

  // 全体上限(MAX_TOTAL)を超えたら、kind をまたいで最古のものから間引く。
  _enforceGlobalCap() {
    let guard = 0;
    while (this.count() > MAX_TOTAL && guard < 10000) {
      if (!this._evictOldest()) break;
      guard++;
    }
  }

  // 全 kind を通じて最も古い(_seq が最小の) 1個を取り除く。取り除けたら true。
  // 各 kind 内は push 順(古い→新しい)を保っているため、各 kind の先頭同士だけ比較すれば良い。
  _evictOldest() {
    let oldestKind = null;
    let oldestSeq = Infinity;
    for (const kind in this.items) {
      const list = this.items[kind];
      if (!list.length) continue;
      const seq = typeof list[0]._seq === 'number' ? list[0]._seq : list[0].placedAt;
      if (seq <= oldestSeq) {
        oldestSeq = seq;
        oldestKind = kind;
      }
    }
    if (oldestKind == null) return false;
    this.items[oldestKind].shift();
    if (this.items[oldestKind].length === 0) delete this.items[oldestKind];
    return true;
  }

  // ---- Image キャッシュ (snapshot.image 対応。SPEC-GL 4) ----

  // entry (place/load 時のエントリ) について Image を一度だけ生成しキャッシュする。
  // JSON.stringify(this.items) で保存されないよう enumerable:false で持たせる。
  _ensureImage(entry) {
    if (!entry || !entry.snapshot || !entry.snapshot.image) return null;
    if (entry._img) return entry._img;
    let img = null;
    try {
      if (typeof Image !== 'undefined') {
        img = new Image();
        img.src = entry.snapshot.image;
      }
    } catch (e) {
      img = null;
    }
    if (img) {
      try {
        Object.defineProperty(entry, '_img', {
          value: img, enumerable: false, configurable: true, writable: true,
        });
      } catch (e) {
        entry._img = img; // defineProperty が使えない環境向けの保険 (保存時は image 側で無害)
      }
    }
    return img;
  }

  // ---- 保存/復元 ----

  save() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return;
    } catch (e) {
      return;
    }

    if (this._trySave(this.items)) return;

    // quota 超過(setItem throw): 最古のパンから間引いて再試行する。
    for (let i = 0; i < SAVE_EVICT_ATTEMPTS && this.count() > 0; i++) {
      if (!this._evictOldest()) break;
      if (this._trySave(this.items)) return;
    }

    // それでも駄目なら image を捨てて保存する (in-memory の this.items は変更しない)。
    const stripped = {};
    for (const kind in this.items) {
      stripped[kind] = this.items[kind].map((e) => ({
        breadId: e.breadId,
        placedAt: e.placedAt,
        snapshot: this._snapshotWithoutImage(e.snapshot),
      }));
    }
    this._trySave(stripped);
  }

  _trySave(dataObj) {
    let json;
    try {
      json = JSON.stringify(dataObj);
    } catch (e) {
      return false;
    }
    try {
      localStorage.setItem(STORAGE_KEY, json);
      return true;
    } catch (e) {
      return false; // quota 超過など
    }
  }

  _snapshotWithoutImage(snap) {
    if (!snap || !snap.image) return snap;
    const copy = {};
    for (const k in snap) {
      if (k === 'image' || k === 'imageW' || k === 'imageH') continue;
      copy[k] = snap[k];
    }
    return copy;
  }

  load() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;
      const cleaned = {};
      for (const kind in data) {
        const list = data[kind];
        if (!Array.isArray(list)) continue;
        cleaned[kind] = list
          .filter((it) => it && typeof it.breadId === 'string' && it.snapshot)
          .map((it) => ({
            breadId: it.breadId,
            // image 無しの旧形式 snapshot もそのまま読める (後方互換)
            snapshot: it.snapshot,
            placedAt: 0, // 復元時は落下演出をスキップ（十分昔とみなす）
            _seq: this._nextSeq(), // このセッションで新規に place() されるものより必ず古い扱いにする
          }));
      }
      this.items = cleaned;
      this._enforceGlobalCap(); // 全体上限36を復元後にも適用
      for (const kind in this.items) {
        for (const entry of this.items[kind]) this._ensureImage(entry);
      }
    } catch (e) {
      // 壊れたデータは黙って捨てる
      this.items = {};
    }
  }

  // ---- 描画: 森ビュー本体（一枚パノラマ） ----

  render(ctx, W, H, t) {
    this._paintSky(ctx, W, H, t);
    this._paintHillsAndTrees(ctx, W, H, false);
    this._paintStream(ctx, W, H, t);

    // ゾーンごとに配置されたパンを描く。奥にあるものから先に（y が小さい順）。
    const order = Object.keys(ZONES).sort((a, b) => ZONES[a].y - ZONES[b].y);
    for (const kind of order) {
      const list = this.items[kind];
      if (!list || !list.length) continue;
      const zone = ZONES[kind];
      const zx = zone.x * W;
      const zy = zone.y * H;
      const zr = zone.r * Math.min(W, H);
      const baseScale = zone.scale;
      for (let i = 0; i < list.length; i++) {
        this._drawPlaced(ctx, kind, list[i], i, zx, zy, zr, baseScale, W, H, t);
      }
    }
  }

  _drawPlaced(ctx, kind, entry, i, zx, zy, zr, baseScale, W, H, t) {
    const off = scatterOffset(i, zr);
    let x = zx + off.dx;
    let y = zy + off.dy;

    // 配置演出: 最近置かれたものはふわり落下 + キラキラ
    const elapsedSec = entry.placedAt ? (Date.now() - entry.placedAt) / 1000 : 999;
    let fallProgress = 1;
    let sparkle = 0;
    if (elapsedSec >= 0 && elapsedSec < PLACE_ANIM_SEC) {
      fallProgress = clamp(elapsedSec / PLACE_ANIM_SEC, 0, 1);
      const ease = 1 - Math.pow(1 - fallProgress, 3);
      y -= (1 - ease) * 40; // 上から降ってくる
      sparkle = 1 - fallProgress;
    }

    // アイドルの揺れ（sin波 ±2px 程度）。演出中は控えめに。
    const seed = i * 13.37 + (kind.charCodeAt(0) || 1);
    const bob = Math.sin(t * 1.3 + seed) * 2 * fallProgress;

    const scale = baseScale * (0.9 + 0.2 * ((i * 0.37) % 1)) * (0.85 + 0.15 * fallProgress);

    // snapshot.image があり decode 済みなら drawImage、無ければ従来の renderSnapshot。
    const img = this._ensureImage(entry);
    if (img && img.complete && img.naturalWidth > 0) {
      try {
        this._drawSnapshotImage(ctx, entry.snapshot, img, x, y, scale, t);
      } catch (e) {
        try { renderSnapshot(ctx, entry.snapshot, x, y, scale, t); } catch (e2) { /* noop */ }
      }
    } else {
      try {
        renderSnapshot(ctx, entry.snapshot, x, y, scale, t);
      } catch (e) {
        // render.js 未実装/エラー時も森全体は落ちない
      }
    }

    this._drawDecoration(ctx, kind, x, y + bob, zr, scale, t, i);

    if (sparkle > 0.02) this._drawSparkle(ctx, x, y, zr * (0.7 + 0.6 * scale), sparkle, t, i);
  }

  // snap.image (GL キャプチャの PNG dataURL) を drawImage で描く。
  // snap.imageW/imageH は実寸(CSS px)で保存されているため、renderSnapshot と同じく
  // scale だけ掛けて縮小する。呼吸の微スケールも renderSnapshot と同じ式で適用する。
  _drawSnapshotImage(ctx, snap, img, x, y, scale, t) {
    const bw = (typeof snap.imageW === 'number' && snap.imageW > 0) ? snap.imageW : (img.naturalWidth || 64);
    const bh = (typeof snap.imageH === 'number' && snap.imageH > 0) ? snap.imageH : (img.naturalHeight || 64);
    const air = typeof snap.air === 'number' ? clamp(snap.air, 0, 1) : 0.3;
    const seed = ((Math.abs(x) * 13 + Math.abs(y) * 7) % 1000) / 1000;
    const breathe = 1 + Math.sin(t * 1.1 + seed * Math.PI * 2) * 0.006 * (0.3 + air);
    const dw = Math.max(1, bw * scale * breathe);
    const dh = Math.max(1, bh * scale * breathe);
    ctx.drawImage(img, x - dw / 2, y - dh / 2, dw, dh);
  }

  _drawSparkle(ctx, x, y, r, amount, t, seed) {
    ctx.save();
    ctx.globalAlpha = amount;
    const n = 6;
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2 + t * 2 + seed;
      const dist = r * (0.6 + 0.4 * Math.sin(t * 4 + k));
      const sx = x + Math.cos(ang) * dist;
      const sy = y + Math.sin(ang) * dist * 0.6 - r * 0.6;
      const s = 3 + 2 * Math.sin(t * 6 + k);
      ctx.fillStyle = '#FFFDF0';
      ctx.beginPath();
      ctx.moveTo(sx, sy - s);
      ctx.lineTo(sx + s * 0.35, sy - s * 0.35);
      ctx.lineTo(sx + s, sy);
      ctx.lineTo(sx + s * 0.35, sy + s * 0.35);
      ctx.lineTo(sx, sy + s);
      ctx.lineTo(sx - s * 0.35, sy + s * 0.35);
      ctx.lineTo(sx - s, sy);
      ctx.lineTo(sx - s * 0.35, sy - s * 0.35);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // kind に応じた最小限の装飾
  _drawDecoration(ctx, kind, x, y, zr, scale, t, i) {
    ctx.save();
    switch (kind) {
      case 'house': {
        // 窓とドア
        const s = zr * 0.55;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.ellipse(x - s * 0.35, y - s * 0.1, s * 0.22, s * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(180,140,90,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - s * 0.35 - s * 0.22, y - s * 0.1);
        ctx.lineTo(x - s * 0.35 + s * 0.22, y - s * 0.1);
        ctx.moveTo(x - s * 0.35, y - s * 0.1 - s * 0.22);
        ctx.lineTo(x - s * 0.35, y - s * 0.1 + s * 0.22);
        ctx.stroke();
        ctx.fillStyle = 'rgba(180,110,80,0.55)';
        ctx.beginPath();
        ctx.ellipse(x + s * 0.3, y + s * 0.25, s * 0.14, s * 0.28, 0, Math.PI, 0, false);
        ctx.fill();
        break;
      }
      case 'pond': {
        // 水面の輪（波紋）
        ctx.strokeStyle = 'rgba(140,200,225,0.5)';
        ctx.lineWidth = 2;
        for (let k = 0; k < 2; k++) {
          const rr = zr * (0.9 + 0.5 * k) + 6 * Math.sin(t * 0.8 + k + i);
          ctx.globalAlpha = 0.35 - k * 0.1;
          ctx.beginPath();
          ctx.ellipse(x, y + zr * 0.35, rr, rr * 0.32, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case 'moon': {
        // 空の演出: 小さな星の瞬き
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        for (let k = 0; k < 3; k++) {
          const a = 0.4 + 0.4 * Math.abs(Math.sin(t * 1.5 + k * 2 + i));
          ctx.globalAlpha = a;
          const sx = x + Math.cos(k * 2.1 + i) * zr * 1.4;
          const sy = y + Math.sin(k * 2.1 + i) * zr * 0.6 - zr * 0.6;
          ctx.beginPath();
          ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'sun': {
        ctx.strokeStyle = 'rgba(255,220,150,0.55)';
        ctx.lineWidth = 2;
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2 + t * 0.15;
          const r1 = zr * (0.8 + 0.15 * scale);
          const r2 = r1 + zr * 0.35;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(ang) * r1, y + Math.sin(ang) * r1);
          ctx.lineTo(x + Math.cos(ang) * r2, y + Math.sin(ang) * r2);
          ctx.stroke();
        }
        break;
      }
      case 'path': {
        // 格子の小道: 地面に沿わせた小さな格子模様
        ctx.strokeStyle = 'rgba(230,200,160,0.5)';
        ctx.lineWidth = 1.5;
        const s = zr * 0.5;
        ctx.beginPath();
        ctx.moveTo(x - s, y + zr * 0.55);
        ctx.lineTo(x + s, y + zr * 0.55);
        ctx.moveTo(x - s * 0.5, y + zr * 0.4);
        ctx.lineTo(x - s * 0.5, y + zr * 0.7);
        ctx.moveTo(x + s * 0.5, y + zr * 0.4);
        ctx.lineTo(x + s * 0.5, y + zr * 0.7);
        ctx.stroke();
        break;
      }
      case 'friend': {
        // 小さな目をそっと
        ctx.fillStyle = 'rgba(70,55,50,0.55)';
        const eo = zr * 0.16;
        ctx.beginPath();
        ctx.arc(x - eo, y - zr * 0.05, 1.6, 0, Math.PI * 2);
        ctx.arc(x + eo, y - zr * 0.05, 1.6, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'mountain': {
        // 背後にうっすら山の稜線
        ctx.fillStyle = 'rgba(213,239,208,0.35)';
        ctx.beginPath();
        ctx.moveTo(x - zr * 1.6, y + zr * 0.7);
        ctx.quadraticCurveTo(x, y - zr * 1.1, x + zr * 1.6, y + zr * 0.7);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'cloud': {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath();
          ctx.ellipse(x + k * zr * 0.7, y + Math.abs(k) * zr * 0.15, zr * 0.6, zr * 0.4, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'flower': {
        ctx.strokeStyle = 'rgba(120,170,110,0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y + zr * 0.5);
        ctx.quadraticCurveTo(x + 3, y + zr * 0.9, x, y + zr * 1.2);
        ctx.stroke();
        break;
      }
      case 'stump': {
        ctx.fillStyle = 'rgba(196,160,120,0.4)';
        ctx.beginPath();
        ctx.ellipse(x, y + zr * 0.75, zr * 0.7, zr * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(160,120,85,0.4)';
        ctx.lineWidth = 1;
        for (let k = 1; k <= 2; k++) {
          ctx.beginPath();
          ctx.ellipse(x, y + zr * 0.75, zr * 0.7 * (k / 3), zr * 0.22 * (k / 3), 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case 'lantern': {
        const glow = 0.25 + 0.15 * Math.sin(t * 2 + i);
        const g = ctx.createRadialGradient(x, y, 0, x, y, zr * 1.4);
        g.addColorStop(0, `rgba(255,236,170,${glow})`);
        g.addColorStop(1, 'rgba(255,236,170,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, zr * 1.4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'swirl': {
        ctx.strokeStyle = 'rgba(255,217,224,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let a = 0; a < Math.PI * 3; a += 0.3) {
          const rr = (a / (Math.PI * 3)) * zr * 0.7;
          const sx = x + Math.cos(a + t * 0.3) * rr;
          const sy = y + zr * 0.8 + Math.sin(a + t * 0.3) * rr * 0.5;
          if (a === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        break;
      }
      case 'stone':
      case 'pebbles': {
        ctx.fillStyle = 'rgba(210,210,205,0.45)';
        const cnt = kind === 'pebbles' ? 3 : 1;
        for (let k = 0; k < cnt; k++) {
          ctx.beginPath();
          ctx.ellipse(x + (k - 1) * zr * 0.6, y + zr * 0.6, zr * 0.28, zr * 0.16, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'berry': {
        ctx.fillStyle = 'rgba(150,190,120,0.4)';
        ctx.beginPath();
        ctx.ellipse(x + zr * 0.4, y - zr * 0.2, zr * 0.22, zr * 0.14, -0.4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'mushroom': {
        ctx.fillStyle = 'rgba(255,246,227,0.7)';
        ctx.beginPath();
        ctx.moveTo(x - zr * 0.22, y + zr * 0.3);
        ctx.lineTo(x + zr * 0.22, y + zr * 0.3);
        ctx.lineTo(x + zr * 0.14, y + zr * 0.75);
        ctx.lineTo(x - zr * 0.14, y + zr * 0.75);
        ctx.closePath();
        ctx.fill();
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }

  // ---- 背景パーツ ----

  _paintSky(ctx, W, H, t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, COL.cream);
    g.addColorStop(0.55, '#FDEFEA');
    g.addColorStop(1, COL.blue);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  _paintHillsAndTrees(ctx, W, H, light) {
    // 遠景の丘（3層）: ピンク→水色→緑の淡い曲線
    const layers = [
      { color: COL.blue, y: 0.55, amp: 0.05, alpha: light ? 0.5 : 0.75 },
      { color: COL.pink, y: 0.66, amp: 0.06, alpha: light ? 0.5 : 0.8 },
      { color: COL.green, y: 0.78, amp: 0.07, alpha: light ? 0.55 : 0.9 },
    ];
    for (const layer of layers) {
      ctx.fillStyle = layer.color;
      ctx.globalAlpha = layer.alpha;
      ctx.beginPath();
      const baseY = H * layer.y;
      ctx.moveTo(0, H);
      ctx.lineTo(0, baseY);
      const segs = 5;
      for (let i = 0; i <= segs; i++) {
        const x = (W / segs) * i;
        const y = baseY - Math.sin(i * 1.7 + layer.y * 10) * H * layer.amp;
        ctx.quadraticCurveTo(x - W / segs / 2, baseY - H * layer.amp * 0.4, x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (!light) {
      // ちいさな木々をいくつか
      const treeXs = [0.06, 0.94, 0.9, 0.03];
      for (let i = 0; i < treeXs.length; i++) {
        this._paintTree(ctx, treeXs[i] * W, H * (0.5 + (i % 2) * 0.04), Math.min(W, H) * 0.05);
      }
    }
  }

  _paintTree(ctx, x, y, r) {
    ctx.fillStyle = 'rgba(150,110,80,0.5)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.9, r * 0.15, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COL.green;
    ctx.globalAlpha = 0.85;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.ellipse(
        x + Math.cos(k * 2.1) * r * 0.35,
        y - r * 0.3 + Math.sin(k * 2.1) * r * 0.25,
        r * 0.6,
        r * 0.5,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _paintStream(ctx, W, H, t) {
    ctx.save();
    ctx.strokeStyle = COL.blue;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = Math.max(6, H * 0.02);
    ctx.beginPath();
    const y0 = H * 0.97;
    ctx.moveTo(-10, y0);
    ctx.bezierCurveTo(W * 0.25, y0 - H * 0.05, W * 0.4, y0 + H * 0.03, W * 0.65, y0 - H * 0.02);
    ctx.bezierCurveTo(W * 0.8, y0 - H * 0.05, W * 0.9, y0, W + 10, y0 - H * 0.01);
    ctx.stroke();
    // きらめき
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    for (let k = 0; k < 4; k++) {
      const px = ((k / 4 + (t * 0.03) % 1) % 1) * W;
      ctx.beginPath();
      ctx.moveTo(px, y0 - 2);
      ctx.lineTo(px + 8, y0 - 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- 背景キャッシュ(play画面の遠景) ----

  renderBackdrop(ctx, W, H, t) {
    this._ensureBackdrop(W, H);
    if (this._backdropCanvas) {
      ctx.drawImage(this._backdropCanvas, 0, 0, W, H);
    }
    // ごく軽い揺らぎだけ毎フレーム重ねる（キャッシュ自体は再描画しない）
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = COL.green;
    const r = Math.min(W, H) * 0.012;
    for (let k = 0; k < 2; k++) {
      const x = W * (0.15 + k * 0.7) + Math.sin(t * 0.6 + k) * 4;
      const y = H * 0.7 + Math.cos(t * 0.6 + k) * 2;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _ensureBackdrop(W, H) {
    if (
      this._backdropCanvas &&
      this._backdropSize.w === W &&
      this._backdropSize.h === H
    ) {
      return;
    }
    if (typeof document === 'undefined' || !document.createElement) {
      // document の無い環境（node 等）では何もしない
      return;
    }
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.floor(W));
    cv.height = Math.max(1, Math.floor(H));
    const c = cv.getContext('2d');
    this._paintSky(c, W, H, 0);
    this._paintHillsAndTrees(c, W, H, true);
    this._backdropCanvas = cv;
    this._backdropCtx = c;
    this._backdropSize = { w: W, h: H };
  }
}
