/* ═══════════════════════════════════════════════════════════
   kaleido.js — 鏡面反射レンダラー

   チャンバー画像をくさび形に切り出し、鏡の反射を
   2x2 行列の積み重ねで再現する。となり合うセクターは
   共有する辺（鏡の線）に対する鏡映になっており、
   完璧な鏡なら模様はぴったりつながる。

   「かがみをずらす」と 1 セクターごとの角度に誤差が加わり、
   誤差が積もって一周の最後に模様の破れ目が現れる。
   星がつぶれたり、左右がずれたりする“本物の不完全さ”。
   ═══════════════════════════════════════════════════════════ */
"use strict";

KKM.Kaleido = class Kaleido {
  constructor() {
    // チャンバーのオフスクリーン
    this.chamberCanvas = document.createElement("canvas");
    this.chamberCtx = this.chamberCanvas.getContext("2d");
    // ブルーム用の縮小バッファ
    this.bloomCanvas = document.createElement("canvas");
    this.bloomCtx = this.bloomCanvas.getContext("2d");
    this.chamberPix = 0;
  }

  /* チャンバーを描いてオフスクリーンを更新
     MARGIN: セルの壁の外側（すりガラスのふち）まで含めて描く。
     鏡のくさびはセルの中心ではなく「なかみのたまり」を覗くので、
     壁の少し外までが視界に入る */
  renderChamber(chamber, pixR, tubeAngle) {
    pixR = Math.max(64, pixR | 0);
    const MARGIN = 1.45;
    if (this.chamberPix !== pixR) {
      this.chamberPix = pixR;
      this.margin = MARGIN;
      const full = Math.ceil(pixR * MARGIN);
      this.chamberFull = full;
      this.chamberCanvas.width = full * 2;
      this.chamberCanvas.height = full * 2;
      this.bloomCanvas.width = Math.max(48, (pixR / 5) | 0);
      this.bloomCanvas.height = Math.max(48, (pixR / 5) | 0);
    }
    const g = this.chamberCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.chamberFull * 2, this.chamberFull * 2);
    g.translate(this.chamberFull, this.chamberFull);
    chamber.draw(g, pixR, tubeAngle, { margin: MARGIN });
  }

  /* 万華鏡本体を (cx, cy) 中心・半径 viewR で描く */
  draw(ctx, cx, cy, viewR, opts) {
    const {
      sectorAngle,        // 基本セクター角
      skew = 0,           // 1セクターあたりの誤差（rad）
      tubeAngle = 0,
      quality = 1,        // 0.5 でプレビュー画質
    } = opts;

    const TAU = Math.PI * 2;
    const a = Math.max(0.06, sectorAngle + skew);   // 実効セクター角
    const overlap = 0.012;                           // 髪の毛すき間を消すのりしろ
    const pix = this.chamberPix;
    const pixM = this.chamberFull;
    const chImg = this.chamberCanvas;

    // 鏡のくさびは「なかみのたまり」を覗く：
    // くさびの頂点（画面中心）がセル中心から重力側へ 0.5R ずれた点を見る。
    // 本物の万華鏡も、鏡の三角はセルの中心ではなく中身のたまりを映している。
    const APEX_SHIFT = 0.42 * pix;
    const ZOOM = 1.35;

    // 開始位相：くさびの中心が真下（なかみのたまる側）に来るように
    const phase0 = Math.PI / 2 - a / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, viewR, 0, TAU);
    ctx.clip();

    // 反射行列の積み重ね
    let m0 = 1, m1 = 0, m2 = 0, m3 = 1;   // 列ベクトル規約の 2x2
    let E = phase0;
    let guard = 0;
    const maxSectors = Math.ceil(TAU / a) + 3;

    while (E < phase0 + TAU - 1e-4 && guard < 64) {
      const span = Math.min(a, phase0 + TAU - E) + overlap;
      ctx.save();
      ctx.translate(cx, cy);
      // このセクターのくさび形クリップ
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, viewR + 2, E - overlap, E + span);
      ctx.closePath();
      ctx.clip();
      // 内容変換：積み重ねた鏡映 → たまりへのオフセット → 筒の回転
      ctx.transform(m0, m1, m2, m3, 0, 0);
      const s = viewR / pix * ZOOM;
      ctx.scale(s, s);
      ctx.translate(0, -APEX_SHIFT);
      ctx.rotate(tubeAngle);
      ctx.drawImage(chImg, -pixM, -pixM);
      ctx.restore();

      // 次のセクター＝この辺（角度 E + a）に対する鏡映を左から掛ける
      const edge = E + a;
      const c2 = Math.cos(2 * edge), s2 = Math.sin(2 * edge);
      //  R = [c2 s2; s2 -c2] を M に左から
      const n0 = c2 * m0 + s2 * m1;
      const n1 = s2 * m0 - c2 * m1;
      const n2 = c2 * m2 + s2 * m3;
      const n3 = s2 * m2 - c2 * m3;
      m0 = n0; m1 = n1; m2 = n2; m3 = n3;
      E = edge;
      guard++;
      if (guard > maxSectors + 8) break;
    }

    // ── ソフトブルーム（縮小 → 拡大でにじませる） ──
    if (quality >= 1) {
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

    // ── 中心のあつまる光 ──
    let grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, viewR * 0.1);
    grad.addColorStop(0, "rgba(255,255,255,.32)");
    grad.addColorStop(0.4, "rgba(255,250,235,.1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillRect(cx - viewR * 0.2, cy - viewR * 0.2, viewR * 0.4, viewR * 0.4);
    ctx.globalCompositeOperation = "source-over";

    // ── ふちの落ち込み（筒の中をのぞいている感じ） ──
    grad = ctx.createRadialGradient(cx, cy, viewR * 0.62, cx, cy, viewR);
    grad.addColorStop(0, "rgba(10,5,18,0)");
    grad.addColorStop(0.82, "rgba(10,5,18,.14)");
    grad.addColorStop(1, "rgba(10,5,18,.66)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, viewR, 0, TAU);
    ctx.fill();

    // ── ガラスの内リング＋ごく薄い虹色（プリズムのふち） ──
    if (quality >= 1 && ctx.createConicGradient) {
      const ring = ctx.createConicGradient(tubeAngle * 0.5, cx, cy);
      const stops = ["#ff9eb8", "#ffd166", "#7be0c4", "#7cc8ff", "#c6a8ff", "#ff9eb8"];
      stops.forEach((c, i) => ring.addColorStop(i / (stops.length - 1), c));
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = ring;
      ctx.lineWidth = Math.max(1.5, viewR * 0.012);
      ctx.beginPath();
      ctx.arc(cx, cy, viewR * 0.985, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = "rgba(255,255,255,.28)";
    ctx.lineWidth = Math.max(1, viewR * 0.006);
    ctx.beginPath();
    ctx.arc(cx, cy, viewR * 0.968, 0, TAU);
    ctx.stroke();

    ctx.restore();
  }

  /* のぞき画面の周辺部（筒の内側の暗がり） */
  drawSurround(ctx, w, h, cx, cy, viewR, tubeAngle) {
    // 深い闇＋わずかな筒の内面反射
    let grad = ctx.createRadialGradient(cx, cy, viewR, cx, cy, Math.max(w, h) * 0.75);
    grad.addColorStop(0, "#0b0612");
    grad.addColorStop(0.5, "#070409");
    grad.addColorStop(1, "#020103");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 筒の縁金属リング
    const rim = viewR * 1.035;
    grad = ctx.createRadialGradient(cx, cy, viewR * 0.99, cx, cy, rim + viewR * 0.05);
    grad.addColorStop(0, "rgba(148,120,90,.5)");
    grad.addColorStop(0.35, "rgba(84,66,52,.55)");
    grad.addColorStop(1, "rgba(20,14,10,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rim + viewR * 0.05, 0, Math.PI * 2);
    ctx.arc(cx, cy, viewR * 0.985, 0, Math.PI * 2, true);
    ctx.fill();

    // 筒内面のかすかなハイライト弧（回転で動く → 回している実感）
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tubeAngle);
    ctx.strokeStyle = "rgba(255, 234, 200, .06)";
    ctx.lineWidth = viewR * 0.05;
    ctx.beginPath();
    ctx.arc(0, 0, rim + viewR * 0.028, -2.4, -1.1);
    ctx.stroke();
    ctx.strokeStyle = "rgba(200, 220, 255, .045)";
    ctx.beginPath();
    ctx.arc(0, 0, rim + viewR * 0.028, 0.6, 1.7);
    ctx.stroke();
    ctx.restore();
  }
};
