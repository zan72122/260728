// ============================================================
// みずみちラボ - 真アイソメ投影 (座標変換・view算出・スクリーン→グリッド判定)
//   px = view.ox + (gx - gy) * view.tw / 2
//   py = view.oy + (gx + gy) * view.th / 2 - h * view.eh
//   (0,0) が画面奥(上)、(GW,GH) が画面手前(下)
// ============================================================
"use strict";

const Iso = {
  EH_RATIO: 0.30,   // 高さ1ユニットぶんの壁px (tw に対する比)

  // ステージ寸法から view を計算。マップ全体(高さ MAX_H の壁ぶんも含む)+ pad が収まる
  // tw を選び、中央配置した view を返す。
  fitView(stageW, stageH, pad) {
    pad = pad === undefined ? 0 : pad;
    const GW = CFG.GW, GH = CFG.GH;
    // tw=1 のときの外接サイズ (§3 参照)
    const worldW = (GW + GH) / 2;
    const worldH = (GW + GH) / 4 + CFG.MAX_H * this.EH_RATIO;
    const availW = Math.max(1, stageW - pad * 2);
    const availH = Math.max(1, stageH - pad * 2);
    const tw = Math.max(1, Math.min(availW / worldW, availH / worldH));
    const th = tw / 2;
    const eh = tw * this.EH_RATIO;
    const cs = tw / 2;
    // マップ全体の描画サイズぶんを中央配置
    const mapW = (GW + GH) * tw / 2;
    const mapH = (GW + GH) * th / 2 + CFG.MAX_H * eh;
    const ox = (stageW - mapW) / 2 + (GH * tw / 2); // (0,0)-(GW,0)-(0,GH)-(GW,GH) の中心合わせ
    const oy = (stageH - mapH) / 2 + CFG.MAX_H * eh;
    return { ox, oy, tw, th, eh, cs, w: stageW, h: stageH };
  },

  // グリッド座標 (gx, gy) と高さ h をスクリーン座標に投影
  project(view, gx, gy, h) {
    const px = view.ox + (gx - gy) * view.tw / 2;
    const py = view.oy + (gx + gy) * view.th / 2 - h * view.eh;
    return { px, py };
  },

  // セル (x, y) の上面ひし形の4隅 [N, E, S, W] (すべて同じ h)
  cellCorners(view, x, y, h) {
    const N = this.project(view, x, y, h);
    const E = this.project(view, x + 1, y, h);
    const S = this.project(view, x + 1, y + 1, h);
    const W = this.project(view, x, y + 1, h);
    return [N, E, S, W];
  },

  // ctx にセル上面のひし形パスを begin する (fill/stroke は呼び出し側)
  diamondPath(ctx, view, x, y, h) {
    const [N, E, S, W] = this.cellCorners(view, x, y, h);
    ctx.beginPath();
    ctx.moveTo(N.px, N.py);
    ctx.lineTo(E.px, E.py);
    ctx.lineTo(S.px, S.py);
    ctx.lineTo(W.px, W.py);
    ctx.closePath();
  },

  // スクリーン座標 → グリッド座標。World.h + Water.w の上面ひし形を
  // s = x+y の降順 (手前→奥) に内外判定し、最初にヒットしたセルの小数グリッド座標を返す。
  pick(view, sx, sy) {
    const GW = CFG.GW, GH = CFG.GH;
    const hw = view.tw / 2, hh = view.th / 2;
    const maxS = (GW - 1) + (GH - 1);
    for (let s = maxS; s >= 0; s--) {
      const yFrom = Math.max(0, s - (GW - 1));
      const yTo = Math.min(GH - 1, s);
      for (let y = yTo; y >= yFrom; y--) {
        const x = s - y;
        const i = idx(x, y);
        const h = World.h[i] + Water.w[i];
        const c = this.project(view, x + 0.5, y + 0.5, h);
        const dx = sx - c.px, dy = sy - c.py;
        if (Math.abs(dx) / hw + Math.abs(dy) / hh <= 1) {
          // ヒットしたセルの高さで逆変換し、セル範囲に clamp
          const ddx = (sx - view.ox) / hw, ddy = (sy + h * view.eh - view.oy) / hh;
          const gx = (ddy + ddx) / 2, gy = (ddy - ddx) / 2;
          return { x: clamp(gx, x, x + 1), y: clamp(gy, y, y + 1) };
        }
      }
    }
    // ヒットなし: h=0 平面での逆変換をグリッド範囲に clamp
    const dx = (sx - view.ox) / hw, dy = (sy - view.oy) / hh;
    const gx = (dy + dx) / 2, gy = (dy - dx) / 2;
    if (gx <= -2 || gx >= GW + 2 || gy <= -2 || gy >= GH + 2) return null;
    return { x: clamp(gx, 0, GW - 0.001), y: clamp(gy, 0, GH - 0.001) };
  },
};
