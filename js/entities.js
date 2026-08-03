// ============================================================
// みずみちラボ - 建物・木・花・ふねの描画
//   (px, py) = 建物の足もと中央のスクリーン座標, cs = セルpx
// ============================================================
"use strict";

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- おうち ----------
function drawHouse(ctx, px, py, s, wet) {
  const w = s * 1.9, bh = s * 1.15, rh = s * 0.85;
  ctx.save();
  ctx.translate(px, py);
  // かべ
  ctx.fillStyle = wet > 0.4 ? "#efe6da" : "#fff6e8";
  rr(ctx, -w / 2, -bh, w, bh, s * 0.12); ctx.fill();
  // よこの影
  ctx.fillStyle = "rgba(160,120,80,.14)";
  ctx.fillRect(w / 2 - s * 0.28, -bh + s * 0.1, s * 0.28, bh - s * 0.1);
  // やね
  ctx.fillStyle = "#f2988f";
  ctx.beginPath();
  ctx.moveTo(-w / 2 - s * 0.18, -bh);
  ctx.lineTo(0, -bh - rh);
  ctx.lineTo(w / 2 + s * 0.18, -bh);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.25)";
  ctx.beginPath();
  ctx.moveTo(-w / 2 - s * 0.18, -bh);
  ctx.lineTo(0, -bh - rh);
  ctx.lineTo(0, -bh);
  ctx.closePath(); ctx.fill();
  // えんとつ
  ctx.fillStyle = "#d9836f";
  ctx.fillRect(w * 0.18, -bh - rh * 0.82, s * 0.22, rh * 0.5);
  // ドア
  ctx.fillStyle = "#c98b5a";
  rr(ctx, -s * 0.19, -s * 0.62, s * 0.38, s * 0.62, s * 0.1); ctx.fill();
  // まど
  ctx.fillStyle = "#bfe6f2";
  rr(ctx, -w / 2 + s * 0.18, -bh + s * 0.22, s * 0.34, s * 0.3, s * 0.06); ctx.fill();
  rr(ctx, w / 2 - s * 0.52, -bh + s * 0.22, s * 0.34, s * 0.3, s * 0.06); ctx.fill();
  ctx.restore();
}

// ---------- おみせ ----------
function drawShop(ctx, px, py, s, wet) {
  const w = s * 2.0, bh = s * 1.1;
  ctx.save();
  ctx.translate(px, py);
  ctx.fillStyle = wet > 0.4 ? "#e8e2d2" : "#fdf3d8";
  rr(ctx, -w / 2, -bh, w, bh, s * 0.12); ctx.fill();
  // ひさし(しましま)
  const ah = s * 0.34;
  ctx.save();
  ctx.beginPath();
  rr(ctx, -w / 2 - s * 0.1, -bh, w + s * 0.2, ah, s * 0.1);
  ctx.clip();
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? "#ffffff" : "#f7a8bc";
    ctx.fillRect(-w / 2 - s * 0.1 + i * (w + s * 0.2) / 8, -bh, (w + s * 0.2) / 8 + 1, ah);
  }
  ctx.restore();
  // ひさしのカーブしたふち
  ctx.fillStyle = "rgba(0,0,0,.06)";
  ctx.fillRect(-w / 2 - s * 0.1, -bh + ah - s * 0.05, w + s * 0.2, s * 0.05);
  // かんばん(りんご)
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(0, -bh - s * 0.28, s * 0.26, 0, 7); ctx.fill();
  ctx.fillStyle = "#ef6f6f";
  ctx.beginPath(); ctx.arc(0, -bh - s * 0.28, s * 0.15, 0, 7); ctx.fill();
  ctx.strokeStyle = "#7fb069"; ctx.lineWidth = s * 0.05;
  ctx.beginPath(); ctx.moveTo(0, -bh - s * 0.4); ctx.quadraticCurveTo(s * 0.1, -bh - s * 0.5, s * 0.14, -bh - s * 0.46); ctx.stroke();
  // まど(おおきなショーウィンドウ)
  ctx.fillStyle = "#bfe6f2";
  rr(ctx, -w / 2 + s * 0.16, -bh + ah + s * 0.1, w * 0.42, s * 0.5, s * 0.08); ctx.fill();
  // ドア
  ctx.fillStyle = "#c98b5a";
  rr(ctx, w * 0.08, -s * 0.58, s * 0.36, s * 0.58, s * 0.08); ctx.fill();
  ctx.restore();
}

// ---------- ほいくえん ----------
function drawSchool(ctx, px, py, s, wet, now) {
  const w = s * 2.3, bh = s * 1.2, rh = s * 0.7;
  ctx.save();
  ctx.translate(px, py);
  ctx.fillStyle = wet > 0.4 ? "#e6e0cd" : "#fdf6da";
  rr(ctx, -w / 2, -bh, w, bh, s * 0.14); ctx.fill();
  // おおきなやね
  ctx.fillStyle = "#f7b263";
  ctx.beginPath();
  ctx.moveTo(-w / 2 - s * 0.22, -bh);
  ctx.quadraticCurveTo(0, -bh - rh * 1.7, w / 2 + s * 0.22, -bh);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.22)";
  ctx.beginPath();
  ctx.moveTo(-w / 2 - s * 0.22, -bh);
  ctx.quadraticCurveTo(-w * 0.2, -bh - rh * 1.5, 0, -bh - rh * 0.85);
  ctx.lineTo(0, -bh); ctx.closePath(); ctx.fill();
  // おひさまマーク
  ctx.fillStyle = "#ffd93b";
  ctx.beginPath(); ctx.arc(0, -bh - s * 0.12, s * 0.2, 0, 7); ctx.fill();
  ctx.strokeStyle = "#ffd93b"; ctx.lineWidth = s * 0.05;
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * s * 0.26, -bh - s * 0.12 + Math.sin(a) * s * 0.26);
    ctx.lineTo(Math.cos(a) * s * 0.34, -bh - s * 0.12 + Math.sin(a) * s * 0.34);
    ctx.stroke();
  }
  // はた
  const fx = w / 2 + s * 0.1, wave = Math.sin(now * 0.004) * s * 0.06;
  ctx.strokeStyle = "#b0906a"; ctx.lineWidth = s * 0.06;
  ctx.beginPath(); ctx.moveTo(fx, -bh); ctx.lineTo(fx, -bh - s * 0.95); ctx.stroke();
  ctx.fillStyle = "#8fd0f0";
  ctx.beginPath();
  ctx.moveTo(fx, -bh - s * 0.95);
  ctx.quadraticCurveTo(fx + s * 0.3, -bh - s * 0.9 + wave, fx + s * 0.55, -bh - s * 0.82 + wave);
  ctx.lineTo(fx, -bh - s * 0.62);
  ctx.closePath(); ctx.fill();
  // ドア x2
  ctx.fillStyle = "#e78fa5";
  rr(ctx, -s * 0.42, -s * 0.6, s * 0.36, s * 0.6, s * 0.1); ctx.fill();
  ctx.fillStyle = "#8fc7e8";
  rr(ctx, s * 0.06, -s * 0.6, s * 0.36, s * 0.6, s * 0.1); ctx.fill();
  // まるいまど
  ctx.fillStyle = "#bfe6f2";
  ctx.beginPath(); ctx.arc(-w / 2 + s * 0.34, -bh + s * 0.36, s * 0.15, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(w / 2 - s * 0.34, -bh + s * 0.36, s * 0.15, 0, 7); ctx.fill();
  ctx.restore();
}

function drawBuildingObj(ctx, b, px, py, cs, now) {
  const s = cs * 1.05;
  // 足もとの影 (アイソメ比 2:1 のひし形グリッドに合わせる)
  ctx.fillStyle = "rgba(110,80,40,.18)";
  ctx.beginPath();
  ctx.ellipse(px, py + cs * 0.1, s * 0.82, s * 0.41, 0, 0, 7);
  ctx.fill();
  const bounce = b.happy > 0 ? Math.abs(Math.sin(now * 0.012)) * -cs * 0.18 * Math.min(1, b.happy) : 0;
  if (b.kind === "house") drawHouse(ctx, px, py + bounce, s, b.wet);
  else if (b.kind === "shop") drawShop(ctx, px, py + bounce, s, b.wet);
  else drawSchool(ctx, px, py + bounce, s, b.wet, now);

  // ぬれたら: ちいさな しずくマーク (こわくない)
  if (b.wet > 0.35) {
    const t = now * 0.003;
    for (let i = 0; i < 2; i++) {
      const ph = (t + i * 0.5) % 1;
      const dy = -s * 1.9 - ph * s * 0.5;
      ctx.globalAlpha = (1 - ph) * 0.8 * b.wet;
      drawDropShape(ctx, px + (i - 0.5) * s * 0.6, py + dy, s * 0.16, "#6fc6e8");
      ctx.globalAlpha = 1;
    }
  }
  // まもれたら: にこにこ
  if (b.happy > 0.1) {
    const a = Math.min(1, b.happy);
    ctx.globalAlpha = a;
    const yy = py - s * 2.35 + Math.sin(now * 0.006) * s * 0.08;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(px, yy, s * 0.34, 0, 7); ctx.fill();
    ctx.fillStyle = "#ffd93b";
    ctx.beginPath(); ctx.arc(px, yy, s * 0.28, 0, 7); ctx.fill();
    ctx.fillStyle = "#7a5a1e";
    ctx.beginPath(); ctx.arc(px - s * 0.1, yy - s * 0.05, s * 0.035, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(px + s * 0.1, yy - s * 0.05, s * 0.035, 0, 7); ctx.fill();
    ctx.strokeStyle = "#7a5a1e"; ctx.lineWidth = s * 0.04; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(px, yy + s * 0.02, s * 0.13, 0.3, Math.PI - 0.3); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawDropShape(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.5);
  ctx.bezierCurveTo(x + r * 1.15, y - r * 0.25, x + r, y + r * 0.55, x, y + r * 0.75);
  ctx.bezierCurveTo(x - r, y + r * 0.55, x - r * 1.15, y - r * 0.25, x, y - r * 1.5);
  ctx.fill();
}

// ---------- き ----------
function drawTreeObj(ctx, t, px, py, cs, now) {
  const s = cs * t.s;
  const sway = Math.sin(now * 0.0012 + t.ph) * s * 0.05;
  // 足もとの影 (アイソメ比 2:1)
  ctx.fillStyle = "rgba(110,80,40,.16)";
  ctx.beginPath(); ctx.ellipse(px, py + cs * 0.06, s * 0.44, s * 0.22, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "#a9825d";
  ctx.fillRect(px - s * 0.09, py - s * 0.72, s * 0.18, s * 0.75);
  const g1 = "#79c46b", g2 = "#95d783";
  ctx.fillStyle = g1;
  ctx.beginPath(); ctx.arc(px - s * 0.28 + sway, py - s * 0.85, s * 0.36, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(px + s * 0.28 + sway, py - s * 0.85, s * 0.36, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(px + sway, py - s * 1.18, s * 0.42, 0, 7); ctx.fill();
  ctx.fillStyle = g2;
  ctx.beginPath(); ctx.arc(px - s * 0.12 + sway, py - s * 1.22, s * 0.26, 0, 7); ctx.fill();
}

// ---------- はな ----------
const FLOWER_COLORS = ["#ff9db8", "#ffd93b", "#ffffff"];
function drawFlowerObj(ctx, f, px, py, cs) {
  const s = cs * 0.16;
  // 足もとの ちいさな影 (アイソメ比 2:1) で接地感を出す
  ctx.fillStyle = "rgba(110,80,40,.14)";
  ctx.beginPath(); ctx.ellipse(px, py + cs * 0.02, s * 0.5, s * 0.25, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = "#7fb069"; ctx.lineWidth = Math.max(1, s * 0.3);
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - s * 1.6); ctx.stroke();
  ctx.fillStyle = FLOWER_COLORS[f.c];
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(px + Math.cos(a) * s * 0.8, py - s * 1.6 + Math.sin(a) * s * 0.8, s * 0.55, 0, 7);
    ctx.fill();
  }
  ctx.fillStyle = "#ffb03b";
  ctx.beginPath(); ctx.arc(px, py - s * 1.6, s * 0.45, 0, 7); ctx.fill();
}

// ---------- ふね ----------
function drawBoat(ctx, px, py, s, now) {
  const bob = Math.sin(now * 0.0021) * s * 0.1;
  const tilt = Math.sin(now * 0.0017) * 0.06;
  ctx.save();
  ctx.translate(px, py + bob);
  ctx.rotate(tilt);
  ctx.fillStyle = "rgba(255,255,255,.35)";
  ctx.beginPath(); ctx.ellipse(0, s * 0.22, s * 1.15, s * 0.28, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "#ef8f6f";
  ctx.beginPath();
  ctx.moveTo(-s * 0.9, -s * 0.1);
  ctx.lineTo(s * 0.9, -s * 0.1);
  ctx.lineTo(s * 0.55, s * 0.38);
  ctx.lineTo(-s * 0.55, s * 0.38);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#b0906a"; ctx.lineWidth = s * 0.09;
  ctx.beginPath(); ctx.moveTo(0, -s * 0.1); ctx.lineTo(0, -s * 1.25); ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(0, -s * 1.25);
  ctx.quadraticCurveTo(s * 0.75, -s * 0.9, s * 0.08, -s * 0.22);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ffe9a8";
  ctx.beginPath();
  ctx.moveTo(-s * 0.06, -s * 1.05);
  ctx.quadraticCurveTo(-s * 0.55, -s * 0.75, -s * 0.06, -s * 0.3);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ---------- おさかな (ときどきジャンプ) ----------
function drawFish(ctx, px, py, s, ph) {
  // ph 0..1 のジャンプ弧
  const jx = (ph - 0.5) * s * 3;
  const jy = -Math.sin(ph * Math.PI) * s * 1.6;
  const rot = (ph - 0.5) * 2.4;
  ctx.save();
  ctx.translate(px + jx, py + jy);
  ctx.rotate(rot);
  ctx.fillStyle = "#8fd0f0";
  ctx.beginPath(); ctx.ellipse(0, 0, s * 0.42, s * 0.26, 0, 0, 7); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-s * 0.3, 0);
  ctx.lineTo(-s * 0.62, -s * 0.24);
  ctx.lineTo(-s * 0.62, s * 0.24);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#31597a";
  ctx.beginPath(); ctx.arc(s * 0.2, -s * 0.05, s * 0.045, 0, 7); ctx.fill();
  ctx.restore();
}
