/* ═══════════════════════════════════════════════════════════
   kaleido.js — 鏡面反射レンダラー ver.2

   基本原理:
   となり合うセクターは「共有する辺（＝鏡の線）」に対する鏡映。
   2x2 反射行列を辺ごとに掛け重ねて描くため、鏡が完璧なら
   模様はぴったり連続する。「ずらし」は角度誤差の蓄積として
   幾何学的に正しい破れ目を作る。

   ver.2 で加わった光学:
   - 反射回数ごとの減衰・色寄り（kepRGB^n の乗算 = 本物の鏡の物理）
   - 鏡の性格: ふわふわ(二重像) / ゆめ(ぼかし) / きらりせん(キズ光) /
     ぐにゃぐにゃ(波打ち曲面) / おばけ(半透明ゴースト)
   - ずーっと鏡: 平行 2 枚鏡の無限廊下モード
   - のぞきあな(まる/ほし/はーと) と レンズ(むしめがね/さかなめ/ぴんぼけ)
   ═══════════════════════════════════════════════════════════ */
"use strict";

KKM.Kaleido = class Kaleido {
  constructor() {
    this.chamberCanvas = document.createElement("canvas");
    this.chamberCtx = this.chamberCanvas.getContext("2d");
    this.fxCanvas = document.createElement("canvas");      // 波打ち・ぼかし加工
    this.fxCtx = this.fxCanvas.getContext("2d");
    this.bloomCanvas = document.createElement("canvas");
    this.bloomCtx = this.bloomCanvas.getContext("2d");
    this.lensCanvas = document.createElement("canvas");    // 魚眼・ぴんぼけ用
    this.lensCtx = this.lensCanvas.getContext("2d");
    this.chamberPix = 0;
    this.time = 0;
  }

  /* 反射1回ごとに残る明るさ（RGB別 = 色寄りの物理） */
  static KEEP_RGB = {
    pika:   [0.985, 0.985, 0.985],
    fuwa:   [0.945, 0.925, 0.940],
    koori:  [0.800, 0.890, 0.985],
    oukan:  [0.985, 0.900, 0.720],
    yume:   [0.955, 0.935, 0.955],
    kirari: [0.955, 0.955, 0.955],
    gunya:  [0.955, 0.955, 0.955],
    obake:  [0.850, 0.860, 0.900],
  };

  /* チャンバーを描いてオフスクリーンを更新 */
  renderChamber(chamber, pixR, tubeAngle, chOpts = {}) {
    pixR = Math.max(64, pixR | 0);
    const MARGIN = 1.45;
    if (this.chamberPix !== pixR) {
      this.chamberPix = pixR;
      this.margin = MARGIN;
      const full = Math.ceil(pixR * MARGIN);
      this.chamberFull = full;
      this.chamberCanvas.width = full * 2;
      this.chamberCanvas.height = full * 2;
      this.fxCanvas.width = full * 2;
      this.fxCanvas.height = full * 2;
      this.bloomCanvas.width = Math.max(48, (pixR / 5) | 0);
      this.bloomCanvas.height = Math.max(48, (pixR / 5) | 0);
    }
    const g = this.chamberCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.chamberFull * 2, this.chamberFull * 2);
    g.translate(this.chamberFull, this.chamberFull);
    chamber.draw(g, pixR, tubeAngle, { margin: MARGIN, ...chOpts });
  }

  /* 任意の画像（おえかき）をチャンバーとして流し込む
     ライブプレビュー用：描いた線がそのまま鏡で増える */
  renderImage(imgCanvas, pixR, bgStyle) {
    pixR = Math.max(64, pixR | 0);
    const MARGIN = 1.45;
    if (this.chamberPix !== pixR) {
      this.chamberPix = pixR;
      this.margin = MARGIN;
      const full = Math.ceil(pixR * MARGIN);
      this.chamberFull = full;
      this.chamberCanvas.width = full * 2;
      this.chamberCanvas.height = full * 2;
      this.fxCanvas.width = full * 2;
      this.fxCanvas.height = full * 2;
      this.bloomCanvas.width = Math.max(48, (pixR / 5) | 0);
      this.bloomCanvas.height = Math.max(48, (pixR / 5) | 0);
    }
    const g = this.chamberCtx;
    const full = this.chamberFull;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, full * 2, full * 2);
    g.translate(full, full);
    // やわらかい紙のあかり
    const bg = g.createRadialGradient(0, 0, pixR * 0.1, 0, 0, full);
    bg.addColorStop(0, bgStyle || "#fffdf4");
    bg.addColorStop(0.7, "#f6ecdc");
    bg.addColorStop(1, "#d8c4a8");
    g.fillStyle = bg;
    g.fillRect(-full, -full, full * 2, full * 2);
    const s = (pixR * 2) / Math.max(imgCanvas.width, imgCanvas.height);
    const dw = imgCanvas.width * s, dh = imgCanvas.height * s;
    g.drawImage(imgCanvas, -dw / 2, -dh / 2, dw, dh);
  }

  /* 鏡の性格による下ごしらえ（波打ち・ぼかし）→ 描画ソースを返す */
  _prepareSource(skin, t) {
    const skinDef = KKM.SKINS[skin] || {};
    if (!skinDef.wave && !skinDef.blur) return this.chamberCanvas;
    const W = this.chamberFull * 2;
    const g = this.fxCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    if (skinDef.blur) {
      // 縮小 → 拡大でとろけるパステルに
      const bw = this.bloomCanvas.width, bh = this.bloomCanvas.height;
      this.bloomCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.bloomCtx.clearRect(0, 0, bw, bh);
      this.bloomCtx.drawImage(this.chamberCanvas, 0, 0, bw, bh);
      g.imageSmoothingEnabled = true;
      g.drawImage(this.bloomCanvas, 0, 0, W, W);
      // うっすら白をまとわせて、砂糖菓子っぽく
      g.fillStyle = "rgba(255, 250, 252, .14)";
      g.fillRect(0, 0, W, W);
      // もとの絵もほんのり残してディテールを保つ
      g.globalAlpha = 0.35;
      g.drawImage(this.chamberCanvas, 0, 0);
      g.globalAlpha = 1;
    } else {
      // 波打ち曲面: 横帯をずらして水面のように
      const BANDS = 22;
      const bh = Math.ceil(W / BANDS);
      const amp = this.chamberPix * 0.055;
      for (let i = 0; i < BANDS; i++) {
        const y = i * bh;
        const dx = Math.sin((i / BANDS) * Math.PI * 3.2 + t * 1.7) * amp;
        const sc = 1 + Math.sin((i / BANDS) * Math.PI * 5 + t * 1.1) * 0.02;
        g.drawImage(this.chamberCanvas, 0, y, W, bh,
                    dx + (W - W * sc) / 2, y, W * sc, bh);
      }
    }
    return this.fxCanvas;
  }

  /* セクターの反射回数 → 乗算カラー（null なら変化なし） */
  _attenuation(skin, refCount) {
    if (refCount <= 0) return null;
    const k = Kaleido.KEEP_RGB[skin] || Kaleido.KEEP_RGB.pika;
    const r = Math.round(255 * Math.pow(k[0], refCount));
    const g = Math.round(255 * Math.pow(k[1], refCount));
    const b = Math.round(255 * Math.pow(k[2], refCount));
    if (r > 249 && g > 249 && b > 249) return null;
    return `rgb(${r},${g},${b})`;
  }

  /* ═══════════ 本体 ═══════════ */
  draw(ctx, cx, cy, viewR, opts) {
    const {
      mirrors = "3",       // "2" | "3" | "4" | "p"
      skew = 0,
      tubeAngle = 0,       // なかみの重心を追う回転（main が計算）
      skin = "pika",
      hole = "maru",
      lens = "futsu",
      quality = 1,
      time = 0,
      apexFrac = 0.42,     // くさびの頂点がセル中心からずれる量（0 で中心固定）
    } = opts;
    this.apexFrac = apexFrac;
    this.time = time;

    const skinDef = KKM.SKINS[skin] || {};
    const source = this._prepareSource(skin, time);
    const useLens = quality >= 1 && lens !== "futsu";

    // レンズあり: いったん別キャンバスに素の模様を描き、あとで変形する
    let tctx = ctx, tcx = cx, tcy = cy;
    if (useLens && (lens === "sakana" || lens === "pinboke")) {
      const LW = Math.ceil(viewR * 2.4);
      if (this.lensCanvas.width !== LW) {
        this.lensCanvas.width = LW;
        this.lensCanvas.height = LW;
      }
      this.lensCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.lensCtx.clearRect(0, 0, LW, LW);
      tctx = this.lensCtx;
      tcx = LW / 2; tcy = LW / 2;
    }

    const zoom = lens === "mushi" ? 1.5 : 1.0;

    if (mirrors === "p") {
      this._drawParallel(tctx, tcx, tcy, viewR, source, skin, skew, tubeAngle, zoom, hole);
    } else {
      this._drawRadial(tctx, tcx, tcy, viewR, source, skin, skew, tubeAngle, zoom, hole,
                       KKM.MIRRORS[mirrors].sector, quality);
    }

    // ── レンズ変形して本画面へ ──
    if (tctx !== ctx) {
      ctx.save();
      KKM.Shapes.buildHolePath(ctx, hole, cx, cy, viewR);
      ctx.clip();
      if (lens === "sakana") {
        this._fisheye(ctx, cx, cy, viewR);
      } else {
        // ぴんぼけ: 本体うっすら＋にじみを重ねる
        const LW = this.lensCanvas.width;
        ctx.globalAlpha = 0.75;
        ctx.drawImage(this.lensCanvas, cx - LW / 2, cy - LW / 2);
        const bw = this.bloomCanvas.width, bh = this.bloomCanvas.height;
        this.bloomCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.bloomCtx.clearRect(0, 0, bw, bh);
        this.bloomCtx.drawImage(this.lensCanvas,
          LW / 2 - viewR, LW / 2 - viewR, viewR * 2, viewR * 2, 0, 0, bw, bh);
        ctx.globalAlpha = 0.55;
        ctx.drawImage(this.bloomCanvas, cx - viewR, cy - viewR, viewR * 2, viewR * 2);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.22;
        ctx.drawImage(this.bloomCanvas, cx - viewR, cy - viewR, viewR * 2, viewR * 2);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    // ── 仕上げ（ブルーム・中心光・ふちの落ち込み・リング） ──
    this._finish(ctx, cx, cy, viewR, hole, tubeAngle, quality, lens);
  }

  /* ── 放射モード（2/3/4まい鏡） ── */
  _drawRadial(ctx, cx, cy, viewR, source, skin, skew, tubeAngle, zoom, hole, sectorAngle, quality) {
    const TAU = Math.PI * 2;
    const a = Math.max(0.06, sectorAngle + skew);
    const overlap = 0.012;
    const pix = this.chamberPix;
    const pixM = this.chamberFull;
    const skinDef = KKM.SKINS[skin] || {};

    const APEX_SHIFT = this.apexFrac * pix;
    const ZOOM = (this.apexFrac < 0.05 ? 1.0 : 1.35) * zoom;
    const nS = Math.max(2, Math.round(TAU / a));

    const phase0 = Math.PI / 2 - a / 2;

    ctx.save();
    KKM.Shapes.buildHolePath(ctx, hole, cx, cy, viewR);
    ctx.clip();

    let m0 = 1, m1 = 0, m2 = 0, m3 = 1;
    let E = phase0;
    let guard = 0;
    const s = viewR / pix * ZOOM;

    while (E < phase0 + TAU - 1e-4 && guard < 64) {
      const span = Math.min(a, phase0 + TAU - E) + overlap;
      const refCount = Math.min(guard, nS - guard < 0 ? guard : nS - guard);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, viewR * 1.5, E - overlap, E + span);
      ctx.closePath();
      ctx.clip();

      // 内容: 鏡映の積み重ね → たまりへのオフセット → 回転
      const drawContent = (extraRot, alpha) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.transform(m0, m1, m2, m3, 0, 0);
        ctx.scale(s, s);
        ctx.translate(0, -APEX_SHIFT);
        ctx.rotate(tubeAngle + extraRot);
        ctx.drawImage(source, -pixM, -pixM);
        ctx.restore();
      };

      drawContent(0, skinDef.seethrough ? 0.82 : 1);
      // ふわふわ鏡: 少し回した二重像
      if (skinDef.ghost) drawContent(0.045, 0.35);
      // おばけ鏡: 鏡を透過した「素のなかみ」がずれて重なる
      if (skinDef.seethrough) {
        ctx.save();
        ctx.globalAlpha = 0.26;
        ctx.scale(s, s);
        ctx.translate(0, -APEX_SHIFT);
        ctx.rotate(tubeAngle + 0.09);
        ctx.drawImage(source, -pixM, -pixM);
        ctx.restore();
      }

      // 反射回数ぶんの減衰・色寄り
      const att = this._attenuation(skin, refCount);
      if (att) {
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = att;
        ctx.fillRect(-viewR * 1.5, -viewR * 1.5, viewR * 3, viewR * 3);
        ctx.globalCompositeOperation = "source-over";
      }

      // きらりせん鏡: 鏡の線に沿ってキズの光がはしる
      if (skinDef.scratch && quality >= 1) {
        ctx.globalCompositeOperation = "lighter";
        const shimmer = 0.35 + 0.3 * Math.sin(this.time * 2.6 + guard * 1.7);
        const grad = ctx.createLinearGradient(0, 0,
          Math.cos(E + a * 0.5) * viewR, Math.sin(E + a * 0.5) * viewR);
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(0.35, `rgba(255,255,255,${shimmer * 0.5})`);
        grad.addColorStop(0.7, `rgba(255,255,255,${shimmer})`);
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = grad;
        for (const frac of [0.32, 0.71]) {
          const ang = E + a * frac;
          ctx.lineWidth = viewR * (frac === 0.32 ? 0.006 : 0.011);
          ctx.beginPath();
          ctx.moveTo(Math.cos(ang) * viewR * 0.1, Math.sin(ang) * viewR * 0.1);
          ctx.lineTo(Math.cos(ang + 0.02) * viewR, Math.sin(ang + 0.02) * viewR);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
      }

      ctx.restore();

      // 次のセクター＝辺 (E + a) に対する鏡映を左から掛ける
      const edge = E + a;
      const c2 = Math.cos(2 * edge), s2 = Math.sin(2 * edge);
      const n0 = c2 * m0 + s2 * m1;
      const n1 = s2 * m0 - c2 * m1;
      const n2 = c2 * m2 + s2 * m3;
      const n3 = s2 * m2 - c2 * m3;
      m0 = n0; m1 = n1; m2 = n2; m3 = n3;
      E = edge;
      guard++;
    }

    ctx.restore();
  }

  /* ── ずーっと鏡（平行 2 枚鏡の無限廊下） ── */
  _drawParallel(ctx, cx, cy, viewR, source, skin, skew, tubeAngle, zoom, hole) {
    const pix = this.chamberPix;
    const pixM = this.chamberFull;
    const skinDef = KKM.SKINS[skin] || {};
    const H = viewR * 0.5;                       // 鏡と鏡の間隔
    const s = (viewR / pix) * 1.55 * zoom;
    const APEX = 0.55 * pix;                     // なかみのたまりの真ん中を覗く
    const N = Math.ceil((viewR * 1.3) / H) + 1;
    const stripRot = tubeAngle * 0.45;           // 廊下ごと回る

    ctx.save();
    KKM.Shapes.buildHolePath(ctx, hole, cx, cy, viewR);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(stripRot);

    for (let kBand = -N; kBand <= N; kBand++) {
      const refCount = Math.abs(kBand);
      ctx.save();
      ctx.beginPath();
      ctx.rect(-viewR * 1.8, kBand * H - H / 2, viewR * 3.6, H + 1);
      ctx.clip();
      // 帯 k の内容 = Ty(kH) ∘ (上下鏡映)^k ＋ ずらしの扇ひらき
      ctx.translate(0, kBand * H);
      if (kBand % 2 !== 0) ctx.scale(1, -1);
      ctx.rotate(kBand * skew * 5);
      ctx.scale(s, s);
      ctx.translate(0, -APEX);
      ctx.rotate(tubeAngle);
      ctx.globalAlpha = skinDef.seethrough ? 0.82 : 1;
      ctx.drawImage(source, -pixM, -pixM);
      if (skinDef.ghost) {
        ctx.globalAlpha = 0.35;
        ctx.rotate(0.045);
        ctx.drawImage(source, -pixM, -pixM);
      }
      ctx.restore();

      // 減衰（奥の廊下ほど暗く・色が寄る）
      const att = this._attenuation(skin, refCount);
      if (att) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(-viewR * 1.8, kBand * H - H / 2, viewR * 3.6, H + 1);
        ctx.clip();
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = att;
        ctx.fillRect(-viewR * 1.8, kBand * H - H / 2, viewR * 3.6, H + 1);
        ctx.globalCompositeOperation = "source-over";
        ctx.restore();
      }

      // 鏡の線（帯の境界）にほそい光
      ctx.strokeStyle = "rgba(255,255,255,.14)";
      ctx.lineWidth = Math.max(1, viewR * 0.004);
      ctx.beginPath();
      ctx.moveTo(-viewR * 1.8, kBand * H - H / 2);
      ctx.lineTo(viewR * 1.8, kBand * H - H / 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ── さかなめレンズ: 同心リングで中央をぷくっとふくらませる ── */
  _fisheye(ctx, cx, cy, viewR) {
    const LW = this.lensCanvas.width;
    const RINGS = 10;
    for (let i = 0; i < RINGS; i++) {
      const u0 = i / RINGS, u1 = (i + 1) / RINGS;
      const um = (u0 + u1) / 2;
      // 目的地 um に見せるソース位置: us = um^1.55 → 中央が拡大される
      const us = Math.pow(um, 1.55);
      const z = um / Math.max(us, 1e-4);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, viewR * u1 + 1, 0, Math.PI * 2);
      if (i > 0) ctx.arc(cx, cy, viewR * u0, 0, Math.PI * 2, true);
      ctx.clip();
      const dw = LW * z;
      ctx.drawImage(this.lensCanvas, cx - dw / 2, cy - dw / 2, dw, dw);
      ctx.restore();
    }
  }

  /* ── 仕上げ ── */
  _finish(ctx, cx, cy, viewR, hole, tubeAngle, quality, lens) {
    const TAU = Math.PI * 2;
    ctx.save();
    KKM.Shapes.buildHolePath(ctx, hole, cx, cy, viewR);
    ctx.clip();

    // ソフトブルーム
    if (quality >= 1 && lens !== "pinboke") {
      const bw = this.bloomCanvas.width, bh = this.bloomCanvas.height;
      const bg = this.bloomCtx;
      bg.setTransform(1, 0, 0, 1, 0, 0);
      bg.clearRect(0, 0, bw, bh);
      bg.drawImage(ctx.canvas,
        cx - viewR, cy - viewR, viewR * 2, viewR * 2,
        0, 0, bw, bh);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.16;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.bloomCanvas, cx - viewR, cy - viewR, viewR * 2, viewR * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    // 中心のあつまる光
    let grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, viewR * 0.1);
    grad.addColorStop(0, "rgba(255,255,255,.32)");
    grad.addColorStop(0.4, "rgba(255,250,235,.1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillRect(cx - viewR * 0.2, cy - viewR * 0.2, viewR * 0.4, viewR * 0.4);
    ctx.globalCompositeOperation = "source-over";

    // ふちの落ち込み（筒の中をのぞいている感じ）
    grad = ctx.createRadialGradient(cx, cy, viewR * 0.62, cx, cy, viewR * 1.05);
    grad.addColorStop(0, "rgba(10,5,18,0)");
    grad.addColorStop(0.78, "rgba(10,5,18,.14)");
    grad.addColorStop(1, "rgba(10,5,18,.62)");
    ctx.fillStyle = grad;
    ctx.fillRect(cx - viewR * 1.2, cy - viewR * 1.2, viewR * 2.4, viewR * 2.4);

    ctx.restore();

    // ガラスの内リング＋プリズム色（のぞきあなの形に沿って）
    if (quality >= 1 && ctx.createConicGradient) {
      const ring = ctx.createConicGradient(tubeAngle * 0.5, cx, cy);
      const stops = ["#ff9eb8", "#ffd166", "#7be0c4", "#7cc8ff", "#c6a8ff", "#ff9eb8"];
      stops.forEach((c, i) => ring.addColorStop(i / (stops.length - 1), c));
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = ring;
      ctx.lineWidth = Math.max(1.5, viewR * 0.012);
      KKM.Shapes.buildHolePath(ctx, hole, cx, cy, viewR * 0.985);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = "rgba(255,255,255,.28)";
    ctx.lineWidth = Math.max(1, viewR * 0.006);
    KKM.Shapes.buildHolePath(ctx, hole, cx, cy, viewR * 0.968);
    ctx.stroke();
  }

  /* のぞき画面の周辺部（筒の内側の暗がり） */
  drawSurround(ctx, w, h, cx, cy, viewR, tubeAngle, hole = "maru") {
    let grad = ctx.createRadialGradient(cx, cy, viewR, cx, cy, Math.max(w, h) * 0.75);
    grad.addColorStop(0, "#0b0612");
    grad.addColorStop(0.5, "#070409");
    grad.addColorStop(1, "#020103");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // のぞきあなの縁金属リング
    grad = ctx.createRadialGradient(cx, cy, viewR * 0.95, cx, cy, viewR * 1.14);
    grad.addColorStop(0, "rgba(148,120,90,.55)");
    grad.addColorStop(0.45, "rgba(84,66,52,.5)");
    grad.addColorStop(1, "rgba(20,14,10,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = viewR * 0.09;
    KKM.Shapes.buildHolePath(ctx, hole, cx, cy, viewR * 1.045);
    ctx.stroke();

    // 筒内面のかすかなハイライト弧（回転で動く）
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tubeAngle);
    ctx.strokeStyle = "rgba(255, 234, 200, .06)";
    ctx.lineWidth = viewR * 0.05;
    ctx.beginPath();
    ctx.arc(0, 0, viewR * 1.1, -2.4, -1.1);
    ctx.stroke();
    ctx.strokeStyle = "rgba(200, 220, 255, .045)";
    ctx.beginPath();
    ctx.arc(0, 0, viewR * 1.1, 0.6, 1.7);
    ctx.stroke();
    ctx.restore();
  }
};
