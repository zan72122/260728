// ============================================================
// みずみちラボ - ジオラマ描画 (真アイソメ投影)
//   px = view.ox + (gx - gy) * view.tw / 2
//   py = view.oy + (gx + gy) * view.th / 2 - h * view.eh
//   対角線 s = x + y の昇順(奥→手前)に、各セルの上面ひし形+右面+左面を描く
// ============================================================
"use strict";

// 2点間の内分点 (スクリーン座標)
function lerpPt(a, b, t) { return { px: lerp(a.px, b.px, t), py: lerp(a.py, b.py, t) }; }

const Render = {
  canvas: null, ctx: null,
  view: { ox: 0, oy: 0, tw: 20, th: 10, eh: 6, cs: 10, w: 0, h: 0 },
  dpr: 1,
  fish: { t: -3, x: 8, y: 26, wait: 5 },   // ときどきはねる さかな
  _boatCell: null, _boatMapRef: null,      // ふねの位置 (World.h の参照でキャッシュ有効性を判定)

  _activeSRange: null, // { sMin, sMax }: アクティブセルが存在する対角線 s の範囲 (resize で更新)

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.resize();
  },

  resize() {
    const st = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(2, Math.round(st.width * this.dpr));
    this.canvas.height = Math.max(2, Math.round(st.height * this.dpr));
    this.view = Iso.fitView(st.width, st.height, 18); // fitView が Iso.active も更新する
    this.computeActiveSRange();
  },

  // Iso.active を1回だけ走査して、アクティブセルが存在する対角線 s の範囲を求める
  // (毎フレームの s ループを画面に映る範囲だけに絞り込むための下ごしらえ)
  computeActiveSRange() {
    const GW = CFG.GW, GH = CFG.GH;
    const maxS = (GW - 1) + (GH - 1);
    if (!Iso.active) { this._activeSRange = { sMin: 0, sMax: maxS }; return; }
    let sMin = maxS, sMax = 0, found = false;
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        if (!Iso.active[idx(x, y)]) continue;
        const s = x + y;
        if (s < sMin) sMin = s;
        if (s > sMax) sMax = s;
        found = true;
      }
    }
    this._activeSRange = found ? { sMin, sMax } : { sMin: 0, sMax: maxS };
  },

  // スクリーン座標 → セル
  pick(sx, sy) {
    return Iso.pick(this.view, sx, sy);
  },

  // ---------- セルの色 ----------
  topColor(i, x, y) {
    const t = World.type[i], h = World.h[i];
    let c;
    switch (t) {
      case T_SAND: c = mixRGB(PAL.sandLow, PAL.sand, clamp((h - 0.9) / 0.7, 0, 1)); break;
      case T_GRASS: {
        const k = clamp((h - 1.3) / 3.2, 0, 1);
        c = mixRGB(PAL.grass, PAL.grassHigh, k);
        break;
      }
      case T_ROCK:
        c = h > 5.8 ? PAL.snow : mixRGB(PAL.rock, PAL.rockHigh, clamp((h - 4.6) / 1.4, 0, 1));
        break;
      case T_RIVER: c = PAL.riverbed; break;
      case T_DITCH: c = PAL.ditch; break;
      case T_LEVEE: c = PAL.levee; break;
      case T_PLAT: c = PAL.plat; break;
      case T_SEA: c = PAL.seafloor; break;
      default: c = PAL.grass;
    }
    // 斜面の陰影 (ひかりは左上おく から)
    const hL = inGrid(x - 1, y) ? World.h[idx(x - 1, y)] : h;
    const hR = inGrid(x + 1, y) ? World.h[idx(x + 1, y)] : h;
    const hU = inGrid(x, y - 1) ? World.h[idx(x, y - 1)] : h;
    const hD = inGrid(x, y + 1) ? World.h[idx(x, y + 1)] : h;
    let lum = 1 + (hR - hL) * -0.05 + (hD - hU) * 0.09;
    // 等高線ふうの ごく薄い しまもよう (ジオラマの層)
    if (t !== T_SEA && t !== T_LEVEE) {
      lum *= (Math.floor(h * 1.4) % 2 === 0) ? 1.0 : 0.975;
    }
    lum = clamp(lum, 0.7, 1.3);
    return [c[0] * lum, c[1] * lum, c[2] * lum];
  },

  wallColor(i) {
    const t = World.type[i];
    if (t === T_LEVEE) return PAL.wallLevee;
    if (t === T_ROCK) return PAL.wallRock;
    if (t === T_PLAT) return PAL.wallPlat;
    return PAL.wallSoil;
  },

  // ---------- メイン描画 ----------
  draw(now) {
    const ctx = this.ctx;
    const v = this.view;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // 保険の下地: 机・トレイは廃止し、画面ぜんたいを淡い色でぬるだけ
    // (通常はアクティブセルの地形で全て覆われるので見えない)
    ctx.fillStyle = PAL.tray;
    ctx.fillRect(0, 0, v.w, v.h);

    const GW = CFG.GW, GH = CFG.GH;
    const maxS = (GW - 1) + (GH - 1);
    const range = this._activeSRange || { sMin: 0, sMax: maxS };
    for (let s = range.sMin; s <= range.sMax; s++) {
      const yFrom = Math.max(0, s - (GW - 1));
      const yTo = Math.min(GH - 1, s);
      for (let y = yFrom; y <= yTo; y++) {
        const x = s - y;
        if (!Iso.isActive(idx(x, y))) continue;
        this.drawCell(ctx, v, x, y);
      }
      IsoWater.drawDiagonal(ctx, v, s, now);
      this.drawObjectsForS(ctx, v, s, now);
    }

    // 海の生きもの
    this.drawSeaLife(ctx, v, now);

    // みくらべ: まえの水の跡をピンクのてんせんで
    if (Modes.compareMask) this.drawCompareOutline(ctx, v, now);

    // おだいのターゲットマーカー
    if (Modes.current === "quest") Modes.drawQuestMarkers(ctx, v, now);

    Particles.draw(ctx, v, now);

    // 指カーソル
    if (Input.cursor) this.drawCursor(ctx, v, now);
  },

  // ---------- 背景: つくえ + トレイ ----------
  drawTable(ctx, v) {
    ctx.fillStyle = PAL.wood1;
    ctx.fillRect(0, 0, v.w, v.h);
    ctx.fillStyle = PAL.wood2;
    for (let i = 0; i < 6; i++) {
      const yy = (i + 0.5) * v.h / 6 + Math.sin(i * 5) * 8;
      ctx.fillRect(0, yy, v.w, 2.5);
    }
    ctx.fillStyle = "rgba(255,255,255,.06)";
    ctx.fillRect(0, 0, v.w, v.h * 0.25);
  },

  // 角丸ポリゴンのパスを begin する (fill/stroke は呼び出し側)
  roundedPolyPath(ctx, pts, r) {
    const n = pts.length;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
      const d1x = p1.px - p0.px, d1y = p1.py - p0.py, len1 = Math.hypot(d1x, d1y) || 1;
      const d2x = p2.px - p1.px, d2y = p2.py - p1.py, len2 = Math.hypot(d2x, d2y) || 1;
      const rr2 = Math.min(r, len1 * 0.45, len2 * 0.45);
      const a = { px: p1.px - d1x / len1 * rr2, py: p1.py - d1y / len1 * rr2 };
      const b = { px: p1.px + d2x / len2 * rr2, py: p1.py + d2y / len2 * rr2 };
      if (i === 0) ctx.moveTo(a.px, a.py); else ctx.lineTo(a.px, a.py);
      ctx.quadraticCurveTo(p1.px, p1.py, b.px, b.py);
    }
    ctx.closePath();
  },

  // マップのひし形にそった、角丸ひし形の白い盤
  drawTray(ctx, v) {
    const GW = CFG.GW, GH = CFG.GH;
    const N0 = Iso.project(v, 0, 0, 0);
    const E0 = Iso.project(v, GW, 0, 0);
    const S0 = Iso.project(v, GW, GH, 0);
    const W0 = Iso.project(v, 0, GH, 0);
    const padXY = v.cs * 0.9;
    const padTop = padXY + CFG.MAX_H * v.eh + padXY * 0.6; // 山の高さぶんの余白
    const outer = [
      { px: N0.px, py: N0.py - padTop },
      { px: E0.px + padXY, py: E0.py },
      { px: S0.px, py: S0.py + padXY },
      { px: W0.px - padXY, py: W0.py },
    ];
    ctx.save();
    ctx.shadowColor = PAL.trayShadow;
    ctx.shadowBlur = v.cs * 1.4;
    ctx.shadowOffsetY = v.cs * 0.5;
    ctx.fillStyle = PAL.trayEdge;
    this.roundedPolyPath(ctx, outer, v.cs * 1.3);
    ctx.fill();
    ctx.restore();

    const inset = v.cs * 0.28;
    const inner = [
      { px: N0.px, py: N0.py - (padTop - inset) },
      { px: E0.px + (padXY - inset), py: E0.py },
      { px: S0.px, py: S0.py + (padXY - inset) },
      { px: W0.px - (padXY - inset), py: W0.py },
    ];
    ctx.fillStyle = PAL.tray;
    this.roundedPolyPath(ctx, inner, v.cs * 1.0);
    ctx.fill();
  },

  // ---------- 面をつくる小物 ----------
  wallPath(ctx, top1, top2, bot1, bot2) {
    ctx.beginPath();
    ctx.moveTo(top1.px, top1.py);
    ctx.lineTo(top2.px, top2.py);
    ctx.lineTo(bot2.px, bot2.py);
    ctx.lineTo(bot1.px, bot1.py);
    ctx.closePath();
  },

  // 壁の帯 (t0〜t1: 上→下の割合)
  wallStrip(ctx, top1, top2, bot1, bot2, t0, t1) {
    t0 = clamp(t0, 0, 1); t1 = clamp(t1, 0, 1);
    const a = lerpPt(top1, bot1, t0), b = lerpPt(top2, bot2, t0);
    const c = lerpPt(top2, bot2, t1), d = lerpPt(top1, bot1, t1);
    ctx.beginPath();
    ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.lineTo(c.px, c.py); ctx.lineTo(d.px, d.py);
    ctx.closePath();
  },

  drawStairsFace(ctx, top1, top2, bot1, bot2) {
    const cs = this.view.cs;
    const dropPx = bot1.py - top1.py;
    const steps = Math.max(2, Math.round(dropPx / (cs * 0.3)));
    ctx.fillStyle = "#e8d9b8";
    this.wallPath(ctx, top1, top2, bot1, bot2); ctx.fill();
    for (let k = 0; k < steps; k++) {
      ctx.fillStyle = k % 2 ? "#d9c69c" : "#efe3c4";
      const t0 = k / steps, t1 = t0 + (1 / steps) * 0.85;
      this.wallStrip(ctx, top1, top2, bot1, bot2, t0, t1); ctx.fill();
    }
    ctx.strokeStyle = "rgba(120,85,40,.25)"; ctx.lineWidth = Math.max(1, cs * 0.04);
    this.wallPath(ctx, top1, top2, bot1, bot2); ctx.stroke();
  },

  // 段差の面 (右面 or 左面) をひとつ描く
  //   top1-top2: 上面の共有辺 (右面なら E-S、左面なら W-S)
  //   drop: となりとの高さの差、mult: 面の明度 (右0.72 / 左0.86)
  //   c: セル上面の色 (ぬれ反映ずみ)、isLeftFace: 階段を描いてよいか
  drawWallFace(ctx, view, i, top1, top2, drop, mult, c, isLeftFace, type) {
    if (drop <= 0.02) return;
    const eh = view.eh, cs = view.cs;
    const bot1 = { px: top1.px, py: top1.py + drop * eh };
    const bot2 = { px: top2.px, py: top2.py + drop * eh };
    // 上面ひし形との境界: 別ポリゴンどうしのAAで生じる1px未満のすきま/濃いふちを消すため、
    // 壁の上ふちだけ わずかに上(上面がわ)へ重ねてから描く(重なりは上面の不透明色で隠れる)
    const OL = 0.75;
    const etop1 = { px: top1.px, py: top1.py - OL };
    const etop2 = { px: top2.px, py: top2.py - OL };
    // ちいさな段差は上面色を暗くした色、おおきな段差は土/石/堤防の壁色へブレンド
    const wk = clamp((drop - 0.5) / 0.8, 0, 1);
    const soil = this.wallColor(i);
    const baseC = [c[0] * mult, c[1] * mult, c[2] * mult];
    const wc = mixRGB(baseC, soil, wk);
    const dark = [wc[0] * 0.88, wc[1] * 0.88, wc[2] * 0.88];
    const light = [Math.min(255, wc[0] * 1.12), Math.min(255, wc[1] * 1.12), Math.min(255, wc[2] * 1.12)];
    const darkStyle = "rgb(" + (dark[0] | 0) + "," + (dark[1] | 0) + "," + (dark[2] | 0) + ")";
    const lightStyle = "rgb(" + (light[0] | 0) + "," + (light[1] | 0) + "," + (light[2] | 0) + ")";

    // 縦グラデの近似 (2色 fill): 下地を暗色でぬり、上がわだけ明色をかさねる
    ctx.fillStyle = darkStyle;
    this.wallPath(ctx, etop1, etop2, bot1, bot2);
    ctx.fill();
    ctx.strokeStyle = darkStyle; ctx.lineWidth = 1; ctx.stroke(); // となりとのすじ消し
    ctx.fillStyle = lightStyle;
    this.wallStrip(ctx, etop1, etop2, bot1, bot2, 0, 0.55);
    ctx.fill();

    if (isLeftFace && World.stairs[i] && drop > 0.6) {
      // たかだいには かいだん (左面のみ)
      this.drawStairsFace(ctx, etop1, etop2, bot1, bot2);
    } else if (drop > 0.8 && type !== T_LEVEE) {
      // 地層のよこ線
      const n = Math.min(4, Math.floor((drop * eh) / (cs * 0.4)));
      ctx.fillStyle = "rgba(120,85,40,.10)";
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        this.wallStrip(ctx, top1, top2, bot1, bot2, t - 0.035, t + 0.035);
        ctx.fill();
      }
    }
    if (type === T_LEVEE) {
      // ていぼうの いしがき模様 (よこ線+たて線)
      ctx.strokeStyle = "rgba(140,140,150,.35)";
      ctx.lineWidth = Math.max(1, cs * 0.04);
      const rows2 = Math.max(1, Math.floor((drop * eh) / (cs * 0.34)));
      for (let k = 1; k <= rows2; k++) {
        const t = k / (rows2 + 1);
        const a = lerpPt(top1, bot1, t), b = lerpPt(top2, bot2, t);
        ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
      }
      const ca = lerpPt(top1, top2, 0.5), cb = lerpPt(bot1, bot2, 0.5);
      ctx.beginPath(); ctx.moveTo(ca.px, ca.py); ctx.lineTo(cb.px, cb.py); ctx.stroke();
    }
    // 壁の上ふち: あかるいライン (はっきりした がけ だけ)
    if (drop > 0.9) {
      ctx.fillStyle = "rgba(255,255,255,.3)";
      this.wallStrip(ctx, top1, top2, bot1, bot2, 0, 0.09);
      ctx.fill();
    }
  },

  // ---------- 1セルぶんの地形 (上面+右面+左面) ----------
  drawCell(ctx, view, x, y) {
    const i = idx(x, y);
    const h = World.h[i];
    const [N, E, S, W] = Iso.cellCorners(view, x, y, h);
    let c = this.topColor(i, x, y);
    // ぬれあと: すこし濃く、あおっぽく
    const wet = Water.wet[i];
    if (wet > 0.03 && Water.w[i] < 0.02 && !World.seaMask[i]) {
      const k = wet * 0.35;
      c = [lerp(c[0], c[0] * 0.62, k), lerp(c[1], c[1] * 0.72, k), lerp(c[2], c[2] * 0.86 + 30, k)];
    }
    const topFill = "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")";
    ctx.fillStyle = topFill;
    ctx.beginPath();
    ctx.moveTo(N.px, N.py); ctx.lineTo(E.px, E.py); ctx.lineTo(S.px, S.py); ctx.lineTo(W.px, W.py);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = topFill; ctx.lineWidth = 1; ctx.stroke(); // となりとのすじ消し

    const type = World.type[i];
    if (type === T_LEVEE) {
      // ていぼうの上面: まるいふちどり (おく=あかるい、てまえ=かげ)
      const cs = view.cs;
      ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = Math.max(1, cs * 0.09);
      let a = lerpPt(N, E, 0.08), b = lerpPt(N, E, 0.92);
      ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
      a = lerpPt(N, W, 0.08); b = lerpPt(N, W, 0.92);
      ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
      ctx.strokeStyle = "rgba(120,120,130,.18)";
      a = lerpPt(S, E, 0.08); b = lerpPt(S, E, 0.92);
      ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
      a = lerpPt(S, W, 0.08); b = lerpPt(S, W, 0.92);
      ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
    }
    if (type === T_RIVER && ((x * 7 + y * 13) % 5 === 0)) {
      // かわらの小石
      const ex = 0.25 + ((x * 31 + y * 17) % 10) / 20;
      const pt = Iso.project(view, x + ex, y + 0.5, h);
      ctx.fillStyle = "rgba(255,255,255,.4)";
      ctx.beginPath();
      ctx.ellipse(pt.px, pt.py, view.cs * 0.09, view.cs * 0.06, 0, 0, 7);
      ctx.fill();
    }

    // S角 (x+1,y+1) は右面/左面の両方の遠い端であり、斜め隣セルの高さもここで
    // 顔をだす。まっすぐ hR / hL だけで壁の底を決めると、斜め隣がさらに低い
    // ときに三角形のすきまができて奥の地形が透けてしまうので、既に壁が立つ
    // 場合はその角の高さもふまえて底をふかくし、すきまをふさぐ。
    const hDiag = inGrid(x + 1, y + 1) ? World.h[idx(x + 1, y + 1)] : 0;
    // 右面 (+x側)
    const hR = inGrid(x + 1, y) ? World.h[idx(x + 1, y)] : 0;
    let dropR = h - hR;
    if (dropR > 0.02) dropR = Math.max(dropR, h - hDiag);
    this.drawWallFace(ctx, view, i, E, S, dropR, 0.72, c, false, type);
    // 左面 (+y側)
    const hL = inGrid(x, y + 1) ? World.h[idx(x, y + 1)] : 0;
    let dropL = h - hL;
    if (dropL > 0.02) dropL = Math.max(dropL, h - hDiag);
    this.drawWallFace(ctx, view, i, W, S, dropL, 0.86, c, true, type);
  },

  // ---------- 対角線 s に属するオブジェクト ----------
  drawObjectsForS(ctx, view, s, now) {
    // 建物 (2x2 の手前角のとき)
    for (const b of World.buildings) {
      if (s !== b.x + b.y + 2) continue;
      const hh = World.h[idx(b.x, b.y)];
      const p = Iso.project(view, b.x + 1, b.y + 1.4, hh);
      drawBuildingObj(ctx, b, p.px, p.py, view.cs, now);
    }
    // 木
    for (const t of World.trees) {
      if (s !== Math.floor(t.x) + Math.floor(t.y)) continue;
      const i = idx(clamp(Math.floor(t.x), 0, CFG.GW - 1), clamp(Math.floor(t.y), 0, CFG.GH - 1));
      const p = Iso.project(view, t.x + 0.5, t.y + 0.7, World.h[i]);
      drawTreeObj(ctx, t, p.px, p.py, view.cs, now);
    }
    // 花 (水にしずんでいたら かくす)
    for (const f of World.flowers) {
      if (s !== Math.floor(f.x) + Math.floor(f.y)) continue;
      const i = idx(clamp(Math.floor(f.x), 0, CFG.GW - 1), clamp(Math.floor(f.y), 0, CFG.GH - 1));
      if (Water.w[i] > 0.08) continue;
      const p = Iso.project(view, f.x, f.y, World.h[i]);
      drawFlowerObj(ctx, f, p.px, p.py, view.cs);
    }
    // 湧き水マーク
    for (const sp of World.springs) {
      if (s !== Math.floor(sp.x) + Math.floor(sp.y)) continue;
      const i = idx(clamp(Math.floor(sp.x), 0, CFG.GW - 1), clamp(Math.floor(sp.y), 0, CFG.GH - 1));
      const p = Iso.project(view, sp.x + 0.5, sp.y + 0.4, World.h[i] + Water.w[i]);
      const ph = 0.5 + 0.5 * Math.sin(now * 0.005);
      ctx.globalAlpha = 0.5 + ph * 0.4;
      drawDropShape(ctx, p.px, p.py - view.cs * 0.5 - ph * view.cs * 0.15, view.cs * 0.26, "#7fd4ee");
      ctx.globalAlpha = 1;
    }
  },

  // ---------- 海の生きもの ----------
  // 手前寄りのふかい海セルをえらぶ (マップ再生成で World.h の参照が変わったら選びなおす)
  pickBoatCell() {
    const GW = CFG.GW, GH = CFG.GH;
    let best = null, bestScore = -Infinity;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const i = idx(x, y);
      if (!World.seaMask[i]) continue;
      const score = y * 2 - World.h[i] * 4; // てまえ(y大)ほど、ふかい(h小)ほど高スコア
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
    return best;
  },

  drawSeaLife(ctx, view, now) {
    const GW = CFG.GW, GH = CFG.GH;
    if (this._boatMapRef !== World.h) {
      this._boatMapRef = World.h;
      this._boatCell = this.pickBoatCell();
    }
    // ふね
    if (this._boatCell) {
      const bi = idx(this._boatCell.x, this._boatCell.y);
      if (World.seaMask[bi]) {
        const surf = World.h[bi] + Water.w[bi];
        const p = Iso.project(view, this._boatCell.x + 0.5, this._boatCell.y + 0.5, surf);
        drawBoat(ctx, p.px, p.py, view.cs * 0.9, now);
      }
    }
    // さかなのジャンプ
    const f = this.fish;
    if (f.t < 0) {
      f.t = 0;
      f.wait = 4 + Math.random() * 6;
      for (let tries = 0; tries < 20; tries++) {
        const x = 2 + Math.floor(Math.random() * (GW - 4));
        const y = GH - 2 - Math.floor(Math.random() * 4);
        if (World.seaMask[idx(x, y)]) { f.x = x; f.y = y; break; }
      }
    }
    f.t += 1 / 60;
    if (f.t > f.wait && f.t < f.wait + 1.1) {
      const ph = (f.t - f.wait) / 1.1;
      const i = idx(Math.round(f.x), Math.round(f.y));
      const surf = World.h[i] + Water.w[i];
      const p = Iso.project(view, f.x + 0.5, f.y + 0.5, surf);
      drawFish(ctx, p.px, p.py, view.cs * 0.8, ph);
      if (ph < 0.08 || ph > 0.92) Particles.splash(f.x, f.y, surf);
    } else if (f.t >= f.wait + 1.1) {
      f.t = -1;
    }
  },

  // ---------- みくらべの跡 ----------
  drawCompareOutline(ctx, view, now) {
    const m = Modes.compareMask;
    const GW = CFG.GW, GH = CFG.GH;
    ctx.save();
    ctx.strokeStyle = "rgba(255,110,160,.85)";
    ctx.lineWidth = Math.max(2, view.cs * 0.13);
    ctx.setLineDash([view.cs * 0.4, view.cs * 0.3]);
    ctx.lineDashOffset = -now * 0.01;
    ctx.lineCap = "round";
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const i = idx(x, y);
        if (!m[i]) continue;
        const hh = World.h[i] + Water.w[i];
        const [N, E, S, W] = Iso.cellCorners(view, x, y, hh);
        // 露出辺だけ線を引く (§2 の共有辺マッピング)
        if (y === 0 || !m[i - GW]) { // 隣(x,y-1) = N-E辺
          ctx.beginPath(); ctx.moveTo(N.px, N.py); ctx.lineTo(E.px, E.py); ctx.stroke();
        }
        if (x === 0 || !m[i - 1]) { // 隣(x-1,y) = N-W辺
          ctx.beginPath(); ctx.moveTo(N.px, N.py); ctx.lineTo(W.px, W.py); ctx.stroke();
        }
        if (x === GW - 1 || !m[i + 1]) { // 隣(x+1,y) = E-S辺
          ctx.beginPath(); ctx.moveTo(E.px, E.py); ctx.lineTo(S.px, S.py); ctx.stroke();
        }
        if (y === GH - 1 || !m[i + GW]) { // 隣(x,y+1) = W-S辺
          ctx.beginPath(); ctx.moveTo(W.px, W.py); ctx.lineTo(S.px, S.py); ctx.stroke();
        }
      }
    }
    ctx.restore();
  },

  // ---------- カーソル ----------
  drawCursor(ctx, view, now) {
    const c = Input.cursor;
    const i = idx(clamp(Math.floor(c.x), 0, CFG.GW - 1), clamp(Math.floor(c.y), 0, CFG.GH - 1));
    const surf = World.h[i] + Water.w[i];
    const p = Iso.project(view, c.x, c.y, surf);
    const pulse = 1 + 0.12 * Math.sin(now * 0.012);
    let r = view.cs * 1.2, col = "rgba(255,255,255,.75)";
    const tl = Input.tool;
    if (tl === "mountain" || tl === "plateau") { r = view.cs * 2.3; col = "rgba(170,220,120,.8)"; }
    else if (tl === "ditch") { r = view.cs * 1.0; col = "rgba(190,170,110,.85)"; }
    else if (tl === "river") { r = view.cs * 1.4; col = "rgba(120,210,235,.85)"; }
    else if (tl === "levee") { r = view.cs * 0.8; col = "rgba(230,230,235,.9)"; }
    else if (tl === "water") { r = view.cs * 1.1; col = "rgba(110,205,240,.9)"; }
    else if (tl === "eraser") { r = view.cs * 1.6; col = "rgba(255,160,190,.85)"; }
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(2, view.cs * 0.12);
    ctx.beginPath();
    ctx.ellipse(p.px, p.py, r * pulse, r * pulse * 0.5, 0, 0, 7); // 2:1 のだえん
    ctx.stroke();

    // 建物ゴースト
    if (tl === "building" && Input.down) {
      drawBuildingObj(ctx, { kind: Input.buildingKind, wet: 0, happy: 0 }, p.px, p.py, view.cs, now);
    }
  },
};
