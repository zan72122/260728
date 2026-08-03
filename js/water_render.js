// ============================================================
// みずみちラボ - 水の描画 (真アイソメ)
//   対角線 s = x+y の地形を描いた直後に呼ばれる。
//   水面 = h + w の高さのひし形。ぷるんとしたふち・なぎさの泡・
//   だんさを落ちる水・きらきら/あわ の発生をここでまとめて担当する。
// ============================================================
"use strict";

// 半透明のふち継ぎ目対策: 点を整数pxへスナップする (となり同士でぴったり
// おなじ境界線になるようにし、アンチエイリアスの半端カバー率をなくす)
function snapPt(p) { return { px: Math.round(p.px), py: Math.round(p.py) }; }

const IsoWater = {
  // 対角線 s 上の全セルの水を描く
  drawDiagonal(ctx, view, s, now) {
    const GW = CFG.GW, GH = CFG.GH;
    const h = World.h, w = Water.w, sea = World.seaMask;
    const e = 0.015;

    const yFrom = Math.max(0, s - (GW - 1));
    const yTo = Math.min(GH - 1, s);
    for (let y = yFrom; y <= yTo; y++) {
      const x = s - y;
      const i = idx(x, y);
      const d = w[i];
      if (d < e) continue;

      const surf = h[i] + d;
      const isSea = sea[i] === 1;
      const depthK = clamp(d / (isSea ? 1.0 : 0.6), 0, 1);
      const c = isSea
        ? mixRGB(PAL.seaShallow, PAL.seaDeep, depthK)
        : mixRGB(PAL.waterShallow, PAL.waterDeep, depthK);
      // ゆらぐ模様 (海はなみ、陸水はさざなみ)
      let lum = 1;
      if (isSea) {
        lum = 1 + 0.035 * Math.sin(x * 0.5 + y * 0.9 - now * 0.0028) + 0.025 * Math.sin(x * 0.23 - now * 0.0016);
      } else {
        lum = 1 + 0.035 * Math.sin(x * 0.8 + y * 0.6 + now * 0.003);
      }
      const alpha = clamp(0.5 + depthK * 0.38, 0, 0.9);

      // 隣セルの水の有無 (となりに水がない側の角をまるめて ぷるんとしたふちに)
      const wW = x > 0 ? w[i - 1] : 1;      // (x-1, y)
      const wE = x < GW - 1 ? w[i + 1] : 1; // (x+1, y)
      const wN = y > 0 ? w[i - GW] : 1;     // (x, y-1)
      const wS = y < GH - 1 ? w[i + GW] : 1;// (x, y+1)
      const exposedN = wN < e; // N-E辺 側 (奥, (x,y-1)側)
      const exposedW = wW < e; // N-W辺 側 (奥, (x-1,y)側)
      const exposedE = wE < e; // E-S辺 側 (手前右)
      const exposedS = wS < e; // W-S辺 側 (手前左)

      const [N, E, S, W] = Iso.cellCorners(view, x, y, surf);
      // 半透明どうしの継ぎ目対策: となりも水のときは同じ辺をとなり同士べつべつに
      // アンチエイリアスして塗ることになり、境界の1pxがどちらの塗りも
      // 半端なカバー率になって色が濃く/薄くずれて見える。ぬりのパスの頂点を
      // 整数pxへスナップして両側の形をぴったりそろえ、境界のあいまいな
      // 半端カバー率のピクセルが出ないようにする(となり同士で同じ位置に丸まる)。
      const fN = snapPt(N), fE = snapPt(E), fS = snapPt(S), fW = snapPt(W);
      ctx.fillStyle = rgba(c, alpha, lum);
      this.roundedDiamond(ctx, fN, fE, fS, fW, view.cs * 0.4, exposedN, exposedE, exposedS, exposedW);
      ctx.fill();

      // 奥側 (N-E, N-W辺) の露出には白い細ハイライト
      if (exposedN || exposedW) {
        ctx.strokeStyle = "rgba(255,255,255,.55)";
        ctx.lineWidth = Math.max(1, view.cs * 0.08);
        ctx.beginPath();
        if (exposedW) { ctx.moveTo(W.px, W.py); ctx.lineTo(N.px, N.py); }
        else ctx.moveTo(N.px, N.py);
        if (exposedN) { if (!exposedW) ctx.moveTo(N.px, N.py); ctx.lineTo(E.px, E.py); }
        ctx.stroke();
      }

      // だんさを流れおちる水: 右隣(x+1,y) → 右面(E-S辺)、左隣(x,y+1) → 左面(W-S辺)
      // (グリッド外は 0 として、地図のはしから おちる ようすも描く)
      const jR = x + 1 < GW ? idx(x + 1, y) : -1;
      const surfR = jR >= 0 ? h[jR] + w[jR] : 0;
      if (surf - surfR > 0.1) {
        this.drawFall(ctx, view, E, S, surf, surfR, c, alpha, now, x, 0);
      }
      const jL = y + 1 < GH ? idx(x, y + 1) : -1;
      const surfL = jL >= 0 ? h[jL] + w[jL] : 0;
      if (surf - surfL > 0.1) {
        this.drawFall(ctx, view, W, S, surf, surfL, c, alpha, now, x, 1);
      }

      // なぎさの あわあわ (海セルで奥側 (x,y-1) が陸のとき)
      if (isSea && exposedN && !(y > 0 && sea[i - GW])) {
        const cx = (N.px + E.px) / 2, cy = (N.py + E.py) / 2;
        const ph = 0.5 + 0.5 * Math.sin(now * 0.0022 + x * 0.8);
        ctx.fillStyle = "rgba(255,255,255," + (0.35 + ph * 0.35) + ")";
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const ox2 = (k - 1) * view.cs * 0.3;
          ctx.moveTo(cx + ox2 + view.cs * (0.1 + 0.04 * Math.sin(x * 3 + k * 2)), cy + ph * view.th * 0.2);
          ctx.arc(cx + ox2, cy + ph * view.th * 0.2, view.cs * (0.1 + 0.04 * Math.sin(x * 3 + k * 2)), 0, 7);
        }
        ctx.fill();
      }

      // きらきら・あわ (ときどき)
      const glow = Water.flowGlow[i];
      if (glow > 0.3 && Math.random() < glow * 0.018) Particles.sparkle(x + Math.random(), y + Math.random() * 0.5, surf);
      if (isSea && Math.random() < 0.0007) Particles.sparkle(x + Math.random(), y + Math.random() * 0.5, surf);
      if (!isSea && d > 0.25 && Math.random() < 0.002) Particles.bubble(x + Math.random(), y + Math.random() * 0.5, surf);
    }
  },

  // ひし形 N-E-S-W を、露出辺の頂点をまるめて描く (ぷるんとしたふち)
  // exposedN: N-E辺 (奥右), exposedE: E-S辺 (手前右), exposedS: W-S辺 (手前左), exposedW: N-W辺 (奥左)
  roundedDiamond(ctx, N, E, S, W, rad, exposedN, exposedE, exposedS, exposedW) {
    // 各頂点の丸め量: その頂点に接する2辺のどちらかが露出していれば丸める
    const rN = (exposedN || exposedW) ? rad : 0;
    const rE = (exposedN || exposedE) ? rad : 0;
    const rS = (exposedE || exposedS) ? rad : 0;
    const rW = (exposedS || exposedW) ? rad : 0;
    const pts = [N, E, S, W];
    const rs = [rN, rE, rS, rW];
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const p0 = pts[(k + 3) % 4], p1 = pts[k], p2 = pts[(k + 1) % 4];
      const r = rs[k];
      if (r <= 0) {
        if (k === 0) ctx.moveTo(p1.px, p1.py); else ctx.lineTo(p1.px, p1.py);
        continue;
      }
      // p1 に向かう辺、p1 から出る辺を r ぶんだけ手前で丸める
      const d01 = Math.hypot(p1.px - p0.px, p1.py - p0.py) || 1;
      const d12 = Math.hypot(p2.px - p1.px, p2.py - p1.py) || 1;
      const rr = Math.min(r, d01 * 0.45, d12 * 0.45);
      const a = { px: p1.px + (p0.px - p1.px) * rr / d01, py: p1.py + (p0.py - p1.py) * rr / d01 };
      const b = { px: p1.px + (p2.px - p1.px) * rr / d12, py: p1.py + (p2.py - p1.py) * rr / d12 };
      if (k === 0) ctx.moveTo(a.px, a.py); else ctx.lineTo(a.px, a.py);
      ctx.quadraticCurveTo(p1.px, p1.py, b.px, b.py);
    }
    ctx.closePath();
  },

  // だんさを流れおちる水 (面: 上端2点 P0-P1、水面差 surf→surfNext、side: 0=右面(明るめ) 1=左面)
  drawFall(ctx, view, P0, P1, surf, surfNext, c, alpha, now, x, side) {
    const fallH = clamp(surf - surfNext, 0, 3) * view.eh;
    const bottomOfs = fallH;
    ctx.fillStyle = rgba(mixRGB(c, [255, 255, 255], 0.25), alpha * 0.9);
    ctx.beginPath();
    ctx.moveTo(P0.px, P0.py);
    ctx.lineTo(P1.px, P1.py);
    ctx.lineTo(P1.px, P1.py + bottomOfs);
    ctx.lineTo(P0.px, P0.py + bottomOfs);
    ctx.closePath();
    ctx.fill();

    // おちる水の白いすじ
    if (fallH > view.cs * 0.3) {
      ctx.fillStyle = "rgba(255,255,255,.45)";
      const mx = (P0.px + P1.px) / 2, my0 = (P0.py + P1.py) / 2;
      const w2 = Math.max(1.5, view.cs * 0.12);
      const ph = (now * 0.006 + x * 1.3 + side * 0.5) % 1;
      ctx.fillRect(mx - w2 * 1.4, my0 + fallH * ph * 0.7, w2, fallH * 0.3);
      ctx.fillRect(mx + w2 * 0.6, my0 + fallH * ((ph + 0.4) % 1) * 0.7, w2 * 0.8, fallH * 0.25);
    }
  },
};
