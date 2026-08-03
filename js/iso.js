// ============================================================
// みずみちラボ - 真アイソメ投影 (座標変換・view算出・スクリーン→グリッド判定)
//   px = view.ox + (gx - gy) * view.tw / 2
//   py = view.oy + (gx + gy) * view.th / 2 - h * view.eh
//   (0,0) が画面奥(上)、(GW,GH) が画面手前(下)
//
//   全画面カバー型 (FULLSCREEN_SPEC §1):
//   ワールド菱形が画面矩形を完全に覆うよう tw を決め、パン・ズームなしの固定カメラにする。
//   画面に映る(+余白)セルだけを Iso.active に記録し、描画・シミュ・pick を絞り込む。
// ============================================================
"use strict";

const Iso = {
  EH_RATIO: 0.30,     // 高さ1ユニットぶんの壁px (tw に対する比)
  active: null,       // 直近の computeActive で計算したアクティブセル (Uint8Array(GW*GH) | null)
  activeBounds: null, // アクティブセルの外接矩形 {minX, maxX, minY, maxY} (グリッド座標, セル index) | null

  // ステージ寸法から view を計算する(カバー型)。
  // ワールド菱形(半幅 A=(GW+GH)*tw/4, 半高 B=(GW+GH)*tw/8)が画面矩形を
  // 8%マージンつきで内包する tw を選び、ワールド菱形の中心を画面中心に合わせる。
  // pad 引数は互換のため残すが未使用。
  fitView(stageW, stageH, pad) {
    const GW = CFG.GW, GH = CFG.GH;
    const sw = stageW, sh = stageH;
    const tw = 1.08 * (2 * sw + 4 * sh) / (GW + GH);
    const th = tw / 2;
    const eh = tw * this.EH_RATIO;
    const cs = tw / 2;
    const ox = sw / 2 - (GW - GH) * tw / 4;          // 正方形グリッドなら sw/2
    const oy = sh / 2 - (GW + GH) * tw / 8;           // ワールド菱形の中心 = 画面中心
    const view = { ox, oy, tw, th, eh, cs, w: sw, h: sh };
    this.computeActive(view);
    return view;
  },

  // 画面に映る(+余白)セルを判定し Iso.active (Uint8Array(GW*GH)) を更新する。
  // 判定はセル中心 project(view, x+0.5, y+0.5, 0) の画面座標が
  //   -2*tw ≤ px ≤ sw+2*tw かつ -(MAX_H*eh + tw) ≤ py ≤ sh + 1.5*tw
  // を満たすかどうか。上方向の余白が大きいのは、山の上面が h*eh ぶん
  // 持ち上がって画面内に入るため。
  computeActive(view) {
    const GW = CFG.GW, GH = CFG.GH;
    const sw = view.w, sh = view.h, tw = view.tw, eh = view.eh;
    const minPx = -2 * tw, maxPx = sw + 2 * tw;
    const minPy = -(CFG.MAX_H * eh + tw), maxPy = sh + 1.5 * tw;
    const active = new Uint8Array(GW * GH);
    let minX = GW, maxX = -1, minY = GH, maxY = -1;
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const p = this.project(view, x + 0.5, y + 0.5, 0);
        if (p.px >= minPx && p.px <= maxPx && p.py >= minPy && p.py <= maxPy) {
          active[y * GW + x] = 1;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    this.active = active;
    this.activeBounds = maxX >= minX ? { minX, maxX, minY, maxY } : null;
    return active;
  },

  // セル index i がアクティブか判定(Iso.active が未計算なら常に true 扱い)
  isActive(i) {
    return this.active ? !!this.active[i] : true;
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

  // スクリーン座標 → グリッド座標 (h=0 平面の逆変換)。clamp しない。
  // 地形生成・配置(画面のどのへんかからグリッド位置を決める)に使う。
  gridAtScreen(view, sx, sy) {
    const hw = view.tw / 2, hh = view.th / 2;
    const dx = (sx - view.ox) / hw, dy = (sy - view.oy) / hh;
    return { x: (dy + dx) / 2, y: (dy - dx) / 2 };
  },

  // 画面 y 座標に対応する対角線値 d = x+y (h=0 平面)
  gridDiagAtY(view, sy) {
    return (sy - view.oy) / (view.th / 2);
  },

  // スクリーン座標 → グリッド座標。アクティブセルの上面ひし形だけを
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
        if (!this.isActive(i)) continue; // 画面外セルは走査対象外
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
    // ヒットなし: h=0 平面での逆変換を、アクティブ領域の外接矩形内に clamp
    const g = this.gridAtScreen(view, sx, sy);
    let gx = g.x, gy = g.y;
    if (gx <= -2 || gx >= GW + 2 || gy <= -2 || gy >= GH + 2) return null;
    const b = this.activeBounds;
    if (b) {
      gx = clamp(gx, b.minX, b.maxX + 1 - 0.001);
      gy = clamp(gy, b.minY, b.maxY + 1 - 0.001);
    } else {
      gx = clamp(gx, 0, GW - 0.001);
      gy = clamp(gy, 0, GH - 0.001);
    }
    return { x: gx, y: gy };
  },
};
