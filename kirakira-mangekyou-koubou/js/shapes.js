/* ═══════════════════════════════════════════════════════════
   shapes.js — つつ断面（オブジェクト室の壁）と のぞきあな の幾何

   つつの形は見た目ではなく「なかみの運動」を変える変数。
   まる: なめらかに転がる / しかく: 角に溜まってカタンと落ちる
   ぺちゃんこ: 狭い側に詰まる / ほし: くぼみごとに小さな山
   ═══════════════════════════════════════════════════════════ */
"use strict";

KKM.Shapes = (() => {

  /* 壁の内側符号付き距離と外向き法線。
     dist > 0 : 壁まで dist だけ余裕がある（内側）
     dist < 0 : 壁の外に出ている */
  function wall(tube, x, y, R) {
    switch (tube) {
      case "square": {
        const h = R * 0.84, cr = R * 0.24;
        const ax = Math.abs(x), ay = Math.abs(y);
        const qx = ax - (h - cr), qy = ay - (h - cr);
        let sd, nx, ny;
        if (qx > 0 && qy > 0) {
          const len = Math.hypot(qx, qy) || 1e-6;
          sd = len - cr;
          nx = (qx / len) * Math.sign(x || 1);
          ny = (qy / len) * Math.sign(y || 1);
        } else if (qx > qy) {
          sd = qx - cr;
          nx = Math.sign(x || 1); ny = 0;
        } else {
          sd = qy - cr;
          nx = 0; ny = Math.sign(y || 1);
        }
        return { dist: -sd, nx, ny };
      }
      case "flat": {
        const a = R * 1.02, b = R * 0.60;
        const f = Math.hypot(x / a, y / b);
        const dist = (1 - f) * b;                   // 近似（衝突用途には十分）
        let nx = x / (a * a), ny = y / (b * b);
        const nl = Math.hypot(nx, ny) || 1e-6;
        return { dist, nx: nx / nl, ny: ny / nl };
      }
      case "star": {
        const r = Math.hypot(x, y) || 1e-6;
        const th = Math.atan2(y, x);
        const rw = R * (0.82 + 0.16 * Math.cos(5 * th));
        const drw = -R * 0.16 * 5 * Math.sin(5 * th);
        // 法線 ≈ er - (rw'/r)·eθ
        const er = { x: x / r, y: y / r };
        const et = { x: -y / r, y: x / r };
        let nx = er.x - (drw / r) * et.x;
        let ny = er.y - (drw / r) * et.y;
        const nl = Math.hypot(nx, ny) || 1e-6;
        return { dist: rw - r, nx: nx / nl, ny: ny / nl };
      }
      default: {  // round
        const d = Math.hypot(x, y) || 1e-6;
        return { dist: R - d, nx: x / d, ny: y / d };
      }
    }
  }

  /* 壁の輪郭パス（ctx は中心が原点、単位 px、半径 R px） */
  function buildWallPath(ctx, tube, R) {
    ctx.beginPath();
    switch (tube) {
      case "square": {
        const h = R * 0.84, cr = R * 0.24;
        ctx.moveTo(-h + cr, -h);
        ctx.arcTo(h, -h, h, h, cr);
        ctx.arcTo(h, h, -h, h, cr);
        ctx.arcTo(-h, h, -h, -h, cr);
        ctx.arcTo(-h, -h, h, -h, cr);
        ctx.closePath();
        break;
      }
      case "flat":
        ctx.ellipse(0, 0, R * 1.02, R * 0.60, 0, 0, Math.PI * 2);
        break;
      case "star": {
        const N = 72;
        for (let i = 0; i <= N; i++) {
          const th = (i / N) * Math.PI * 2;
          const rw = R * (0.82 + 0.16 * Math.cos(5 * th));
          const x = Math.cos(th) * rw, y = Math.sin(th) * rw;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        break;
      }
      default:
        ctx.arc(0, 0, R, 0, Math.PI * 2);
    }
  }

  /* なかみを降らせるときの初期位置の横はば（形ごとに安全な範囲） */
  function spawnHalfWidth(tube, R) {
    switch (tube) {
      case "square": return R * 0.65;
      case "flat":   return R * 0.7;
      case "star":   return R * 0.5;
      default:       return R * 0.45 * 2 * 0.5;
    }
  }

  /* ── のぞきあな（視野の枠）のパス。中心 (cx, cy)・半径 r ── */
  function buildHolePath(ctx, hole, cx, cy, r) {
    ctx.beginPath();
    switch (hole) {
      case "hoshi": {
        const pts = 5, inner = 0.60;
        const rot = -Math.PI / 2;
        for (let i = 0; i < pts * 2; i++) {
          const a = rot + (i / (pts * 2)) * Math.PI * 2;
          const rr = (i % 2 === 0 ? 1.06 : inner) * r;
          const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        break;
      }
      case "heart": {
        const s = r * 1.1;
        ctx.moveTo(cx, cy + s * 0.85);
        ctx.bezierCurveTo(cx - s * 1.35, cy + s * 0.05, cx - s * 0.95, cy - s * 0.95, cx, cy - s * 0.35);
        ctx.bezierCurveTo(cx + s * 0.95, cy - s * 0.95, cx + s * 1.35, cy + s * 0.05, cx, cy + s * 0.85);
        ctx.closePath();
        break;
      }
      default:
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
  }

  return { wall, buildWallPath, buildHolePath, spawnHalfWidth };
})();
