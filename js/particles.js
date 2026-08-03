// ============================================================
// みずみちラボ - パーティクル (きらきら・あわ・しぶき・はな)
//   ワールド座標 (セル単位) + 高さ z で管理し、描画時に投影
// ============================================================
"use strict";

const Particles = {
  list: [],

  add(p) {
    if (this.list.length > 260) this.list.shift();
    this.list.push(p);
  },

  // 水面のきらめき
  sparkle(x, y, z) {
    this.add({ kind: "sparkle", x, y, z, life: 1, decay: 0.02 + Math.random() * 0.02, r: 0.06 + Math.random() * 0.1 });
  },
  // あわ
  bubble(x, y, z) {
    this.add({ kind: "bubble", x, y, z, vz: 0.02 + Math.random() * 0.02, life: 1, decay: 0.022, r: 0.05 + Math.random() * 0.08 });
  },
  // 注いだときのしぶき
  splash(x, y, z) {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add({
        kind: "drop", x, y, z: z + 0.3,
        vx: Math.cos(a) * 0.05, vy: Math.sin(a) * 0.04, vz: 0.06 + Math.random() * 0.06,
        life: 1, decay: 0.04, r: 0.08 + Math.random() * 0.07,
      });
    }
  },
  // けしたときのもくもく
  poof(x, y, z) {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add({
        kind: "puff", x: x + Math.cos(a) * 0.4, y: y + Math.sin(a) * 0.3, z: z + 0.4,
        vx: Math.cos(a) * 0.03, vy: Math.sin(a) * 0.02, vz: 0.015,
        life: 1, decay: 0.03, r: 0.3 + Math.random() * 0.25,
      });
    }
  },
  // 成功のおはな・キラ
  bloom(x, y, z) {
    for (let i = 0; i < 3; i++) {
      this.add({
        kind: "petal", x: x + (Math.random() - 0.5) * 1.6, y: y + (Math.random() - 0.5) * 1.2, z: z + 0.2,
        vz: 0.03, vx: (Math.random() - 0.5) * 0.02, vy: -0.01,
        life: 1, decay: 0.008, r: 0.16 + Math.random() * 0.1,
        c: FLOWER_COLORS[Math.floor(Math.random() * 3)], rot: Math.random() * 6.28,
      });
    }
    this.add({ kind: "star", x, y, z: z + 0.8, vz: 0.02, life: 1, decay: 0.012, r: 0.25 });
  },
  // タップの波紋
  ring(x, y, z) {
    this.add({ kind: "ring", x, y, z, life: 1, decay: 0.05, r: 0.2 });
  },

  step() {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= p.decay;
      if (p.vx) p.x += p.vx;
      if (p.vy) p.y += p.vy;
      if (p.vz) { p.z += p.vz; if (p.kind === "drop") p.vz -= 0.006; }
      if (p.kind === "ring") p.r += 0.09;
      if (p.life <= 0) L.splice(i, 1);
    }
  },

  // view: Iso の view ({ox, oy, tw, th, eh, cs, ...})
  draw(ctx, view, now) {
    const cs = view.cs;
    for (const p of this.list) {
      const pr = Iso.project(view, p.x, p.y, p.z);
      const px = pr.px, py = pr.py;
      const a = clamp(p.life, 0, 1);
      switch (p.kind) {
        case "sparkle": {
          const tw = 0.6 + 0.4 * Math.sin(now * 0.02 + p.x * 7);
          ctx.globalAlpha = a * tw;
          ctx.fillStyle = "#ffffff";
          const r = p.r * cs;
          ctx.beginPath();
          ctx.moveTo(px, py - r * 2);
          ctx.quadraticCurveTo(px + r * 0.3, py - r * 0.3, px + r * 2, py);
          ctx.quadraticCurveTo(px + r * 0.3, py + r * 0.3, px, py + r * 2);
          ctx.quadraticCurveTo(px - r * 0.3, py + r * 0.3, px - r * 2, py);
          ctx.quadraticCurveTo(px - r * 0.3, py - r * 0.3, px, py - r * 2);
          ctx.fill();
          break;
        }
        case "bubble":
          ctx.globalAlpha = a * 0.7;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = Math.max(1, cs * 0.05);
          ctx.beginPath(); ctx.arc(px, py, p.r * cs, 0, 7); ctx.stroke();
          break;
        case "drop":
          ctx.globalAlpha = a * 0.85;
          ctx.fillStyle = "#9fe0f2";
          ctx.beginPath(); ctx.arc(px, py, p.r * cs, 0, 7); ctx.fill();
          break;
        case "puff":
          ctx.globalAlpha = a * 0.5;
          ctx.fillStyle = "#ffffff";
          ctx.beginPath(); ctx.arc(px, py, p.r * cs * (1.6 - a * 0.6), 0, 7); ctx.fill();
          break;
        case "petal": {
          ctx.globalAlpha = a;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(p.rot + now * 0.002);
          ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.ellipse(0, 0, p.r * cs, p.r * cs * 0.55, 0, 0, 7); ctx.fill();
          ctx.restore();
          break;
        }
        case "star": {
          ctx.globalAlpha = a;
          ctx.fillStyle = "#ffe36b";
          const r = p.r * cs;
          ctx.save(); ctx.translate(px, py); ctx.rotate(now * 0.003);
          ctx.beginPath();
          for (let k = 0; k < 10; k++) {
            const rr2 = k % 2 ? r * 0.45 : r;
            const an = k / 10 * Math.PI * 2 - Math.PI / 2;
            if (k === 0) ctx.moveTo(Math.cos(an) * rr2, Math.sin(an) * rr2);
            else ctx.lineTo(Math.cos(an) * rr2, Math.sin(an) * rr2);
          }
          ctx.closePath(); ctx.fill();
          ctx.restore();
          break;
        }
        case "ring":
          ctx.globalAlpha = a * 0.7;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = Math.max(1.5, cs * 0.09);
          ctx.beginPath();
          ctx.ellipse(px, py, p.r * cs, p.r * cs * 0.5, 0, 0, 7);
          ctx.stroke();
          break;
      }
    }
    ctx.globalAlpha = 1;
  },
};
