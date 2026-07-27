/* ═══════════════════════════════════════════════════════════
   stampify.js — 子どもの入力を「宝物」に増幅する画像パイプライン

   ・おえかき → トリミング → 拡大 → 彩度ブースト →
     白いステッカーふち → やわらか影 → ガラスの照り
   ・しゃしん → むき解析（細かすぎたらカラフルな所へ自動ズーム）→
     色補正 → 丸角タイル化 → 高彩度スポットからキャンディー打ち抜き

   StampStore: つくった素材の保管庫（localStorage に復元可能）
   ═══════════════════════════════════════════════════════════ */
"use strict";

KKM.Stampify = (() => {

  /* ── 基本ユーティリティ ── */

  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  /* 透明部分を切り落として内容の矩形を返す */
  function alphaBounds(canvas) {
    const g = canvas.getContext("2d");
    const { width: w, height: h } = canvas;
    const d = g.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 16) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /* 彩度・明るさをピクセル単位でブースト（ctx.filter 非対応環境でも動く） */
  function boostPixels(canvas, satMul = 1.3, brightAdd = 0, contrast = 1.0) {
    const g = canvas.getContext("2d");
    const img = g.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      let r = d[i], gg = d[i + 1], b = d[i + 2];
      const l = 0.299 * r + 0.587 * gg + 0.114 * b;
      r = l + (r - l) * satMul;
      gg = l + (gg - l) * satMul;
      b = l + (b - l) * satMul;
      r = (r - 128) * contrast + 128 + brightAdd;
      gg = (gg - 128) * contrast + 128 + brightAdd;
      b = (b - 128) * contrast + 128 + brightAdd;
      d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      d[i + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
      d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
    g.putImageData(img, 0, 0);
  }

  /* シルエットを白で塗った版（ふち作り用） */
  function silhouette(src, color) {
    const c = makeCanvas(src.width, src.height);
    const g = c.getContext("2d");
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  /* ── ステッカー化（白ふち＋影＋照り） ──
     content: 透明背景のキャンバス。出力: OUT×OUT のステッカー */
  function stickerize(content, OUT = 256, opts = {}) {
    const border = opts.border !== undefined ? opts.border : OUT * 0.045;
    const pad = border * 2.4;
    // 内容を正方形におさめる
    const inner = makeCanvas(OUT, OUT);
    const ig = inner.getContext("2d");
    const bb = opts.noTrim ? { x: 0, y: 0, w: content.width, h: content.height }
                           : alphaBounds(content);
    if (!bb) return null;
    const scale = Math.min((OUT - pad * 2) / bb.w, (OUT - pad * 2) / bb.h);
    const dw = bb.w * scale, dh = bb.h * scale;
    ig.imageSmoothingQuality = "high";
    ig.drawImage(content, bb.x, bb.y, bb.w, bb.h,
                 (OUT - dw) / 2, (OUT - dh) / 2, dw, dh);

    const out = makeCanvas(OUT, OUT);
    const og = out.getContext("2d");
    // やわらかい影
    const white = silhouette(inner, "#ffffff");
    og.save();
    og.shadowColor = "rgba(70, 40, 60, .38)";
    og.shadowBlur = OUT * 0.045;
    og.shadowOffsetX = OUT * 0.012;
    og.shadowOffsetY = OUT * 0.03;
    og.drawImage(white, 0, 0);
    og.restore();
    // 白ふち：シルエットを16方向にずらして重ねる
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      og.drawImage(white, Math.cos(a) * border, Math.sin(a) * border);
    }
    // 本体
    og.drawImage(inner, 0, 0);
    // ガラスの照り（本体の形にそって）
    const glossBand = makeCanvas(OUT, OUT);
    const gg = glossBand.getContext("2d");
    let grad = gg.createLinearGradient(0, 0, OUT, OUT);
    grad.addColorStop(0, "rgba(255,255,255,.55)");
    grad.addColorStop(0.28, "rgba(255,255,255,.12)");
    grad.addColorStop(0.5, "rgba(255,255,255,0)");
    gg.fillStyle = grad;
    gg.fillRect(0, 0, OUT, OUT);
    og.save();
    og.globalCompositeOperation = "source-atop";
    og.drawImage(glossBand, 0, 0);
    og.restore();
    return out;
  }

  /* ── おえかき → スタンプ ── */
  function fromDrawing(paintCanvas) {
    const bb = alphaBounds(paintCanvas);
    if (!bb || bb.w < 8 || bb.h < 8) return null;
    const content = makeCanvas(bb.w, bb.h);
    content.getContext("2d").drawImage(paintCanvas,
      bb.x, bb.y, bb.w, bb.h, 0, 0, bb.w, bb.h);
    boostPixels(content, 1.25, 4, 1.04);
    return stickerize(content, 256, { noTrim: true });
  }

  /* ── しゃしんの解析 ──
     64x64 に縮小して、エッジ密度と彩度マップを見る */
  function analyze(img) {
    const N = 64;
    const c = makeCanvas(N, N);
    const g = c.getContext("2d");
    const s = Math.min(img.width, img.height);
    g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data;
    const lum = new Float32Array(N * N);
    const sat = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
      lum[i] = 0.299 * r + 0.587 * gg + 0.114 * b;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      sat[i] = mx === 0 ? 0 : (mx - mn) / mx * (mx / 255);
    }
    let edge = 0;
    for (let y = 1; y < N - 1; y++) {
      for (let x = 1; x < N - 1; x++) {
        const i = y * N + x;
        edge += Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + N] - lum[i - N]);
      }
    }
    edge /= (N - 2) * (N - 2) * 255;
    return { N, sat, lum, edge };
  }

  /* 一番「おいしい」領域を探す（彩度の合計が高い窓） */
  function bestWindow(anl, frac) {
    const { N, sat } = anl;
    const w = Math.round(N * frac);
    let best = { x: 0, y: 0, score: -1 };
    const step = Math.max(1, (N - w) >> 3);
    for (let y = 0; y + w <= N; y += step) {
      for (let x = 0; x + w <= N; x += step) {
        let sc = 0;
        for (let yy = y; yy < y + w; yy += 2)
          for (let xx = x; xx < x + w; xx += 2)
            sc += sat[yy * N + xx];
        if (sc > best.score) best = { x, y, score: sc };
      }
    }
    return { fx: best.x / N, fy: best.y / N, fw: w / N };
  }

  /* ── しゃしん → メインタイル＋キャンディーチップ ── */
  function fromPhoto(img) {
    const anl = analyze(img);
    // 中央の正方形が基本。ごちゃごちゃした写真は、カラフルな所へズーム
    const s = Math.min(img.width, img.height);
    let sx = (img.width - s) / 2, sy = (img.height - s) / 2, sw = s;
    if (anl.edge > 0.06) {
      const win = bestWindow(anl, 0.62);
      sx += win.fx * s; sy += win.fy * s; sw = win.fw * s;
    }
    // 作業用に切り出し＋色補正
    const BASE = 480;
    const base = makeCanvas(BASE, BASE);
    const bg = base.getContext("2d");
    bg.imageSmoothingQuality = "high";
    bg.drawImage(img, sx, sy, sw, sw, 0, 0, BASE, BASE);
    // 明るさの自動補正（暗い写真を持ち上げる）
    const anl2 = analyze(base);
    let mean = 0;
    for (let i = 0; i < anl2.lum.length; i++) mean += anl2.lum[i];
    mean /= anl2.lum.length;
    boostPixels(base, 1.32, mean < 105 ? (115 - mean) * 0.7 : 0, 1.06);

    // ── キャンディーチップ：高彩度スポットから打ち抜き ──
    const spots = pickSpots(anl2, 4);
    const shapes = ["maru", "hoshi", "heart", "maru"];
    const chips = [];
    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i];
      const C = 132;
      const cut = C / 0.30;                       // 元画像の 30% サイズを切り出す
      const cx = sp.x * BASE, cy = sp.y * BASE;
      const half = cut / 2;
      const px = Math.max(0, Math.min(BASE - cut, cx - half));
      const py = Math.max(0, Math.min(BASE - cut, cy - half));
      const chipContent = makeCanvas(C, C);
      const cg = chipContent.getContext("2d");
      KKM.Shapes.buildHolePath(cg, shapes[i % shapes.length], C / 2, C / 2, C * 0.42);
      cg.clip();
      cg.drawImage(base, px, py, cut, cut, 0, 0, C, C);
      const chip = stickerize(chipContent, 144, { noTrim: true, border: 144 * 0.05 });
      if (chip) chips.push(chip);
    }
    // base = 補正済みの元画像そのもの。ステンドグラス（背面光）になる
    return { base, chips };
  }

  /* 彩度×明度スコアの高いスポットを、たがいに離して選ぶ */
  function pickSpots(anl, count) {
    const { N, sat, lum } = anl;
    const cands = [];
    for (let y = 4; y < N - 4; y++) {
      for (let x = 4; x < N - 4; x++) {
        const i = y * N + x;
        cands.push({ x: x / N, y: y / N, sc: sat[i] * (0.4 + 0.6 * lum[i] / 255) });
      }
    }
    cands.sort((a, b) => b.sc - a.sc);
    const picked = [];
    for (const c of cands) {
      if (picked.length >= count) break;
      if (picked.every(p => Math.hypot(p.x - c.x, p.y - c.y) > 0.24)) picked.push(c);
    }
    return picked;
  }

  /* ═══════ StampStore：つくった素材の保管庫 ═══════ */
  const store = new Map();   // id → { id, kind, canvas, ready }
  let nextId = 1;
  let onChange = null;

  const Store = {
    add(canvas, kind) {
      const id = "s" + (nextId++) + "_" + Date.now().toString(36);
      store.set(id, { id, kind, canvas, ready: true });
      // 古いものから間引く
      while (store.size > KKM.STAMP_STORE_MAX) {
        const oldest = store.keys().next().value;
        store.delete(oldest);
      }
      if (onChange) onChange();
      return id;
    },
    get(id) { return store.get(id); },
    remove(id) { store.delete(id); if (onChange) onChange(); },
    list() { return [...store.values()]; },
    setOnChange(fn) { onChange = fn; },
    serialize() {
      const out = [];
      for (const s of store.values()) {
        try { out.push({ id: s.id, kind: s.kind, data: s.canvas.toDataURL("image/png") }); }
        catch (e) {}
      }
      return out;
    },
    restore(list) {
      store.clear();
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (!item || !item.id || !item.data) continue;
        const entry = { id: item.id, kind: item.kind || "draw", canvas: null, ready: false };
        store.set(item.id, entry);
        const img = new Image();
        img.onload = () => {
          const c = makeCanvas(img.width, img.height);
          c.getContext("2d").drawImage(img, 0, 0);
          entry.canvas = c;
          entry.ready = true;
          if (onChange) onChange();
        };
        img.src = item.data;
        const m = /^s(\d+)_/.exec(item.id);
        if (m) nextId = Math.max(nextId, +m[1] + 1);
      }
      if (onChange) onChange();
    },
  };

  return { fromDrawing, fromPhoto, stickerize, Store };
})();
