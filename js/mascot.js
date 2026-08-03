// ============================================================
// みずみちラボ - マスコット「ぷるちゃん」(みずのしずく)
// ============================================================
"use strict";

const Mascot = {
  canvas: null, ctx: null,
  mood: "idle",          // idle | happy | wow
  moodT: 0,
  blinkT: 0, blink: 0,
  squash: 0,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  },

  react(mood) {
    this.mood = mood;
    this.moodT = mood === "happy" ? 3.2 : 1.6;
    this.squash = 1;
  },

  step(dt) {
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 0.14;
      this.blinkT = 2 + Math.random() * 3;
    }
    if (this.blink > 0) this.blink -= dt;
    if (this.moodT > 0) {
      this.moodT -= dt;
      if (this.moodT <= 0) this.mood = "idle";
    }
    this.squash *= 0.9;
  },

  draw(now) {
    const ctx = this.ctx;
    const s = this.canvas.width;
    ctx.clearRect(0, 0, s, s);
    const cx = s * 0.5, cy = s * 0.58;
    const bob = Math.sin(now * 0.003) * s * 0.03;
    const jump = this.mood === "happy" ? Math.abs(Math.sin(now * 0.012)) * -s * 0.08 : 0;
    const sq = 1 + this.squash * 0.25 * Math.sin(now * 0.03);

    ctx.save();
    ctx.translate(cx, cy + bob + jump);
    ctx.scale(2 - sq, sq);

    // からだ (しずく)
    const r = s * 0.32;
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r * 1.5);
    g.addColorStop(0, "#aee6f8");
    g.addColorStop(1, "#4db4de");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.55);
    ctx.bezierCurveTo(r * 1.2, -r * 0.25, r * 1.05, r * 0.6, 0, r * 0.8);
    ctx.bezierCurveTo(-r * 1.05, r * 0.6, -r * 1.2, -r * 0.25, 0, -r * 1.55);
    ctx.fill();
    // ハイライト
    ctx.fillStyle = "rgba(255,255,255,.75)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.35, -r * 0.5, r * 0.14, r * 0.24, -0.4, 0, 7);
    ctx.fill();

    // かお
    const blink = this.blink > 0;
    ctx.fillStyle = "#2b5a78";
    if (this.mood === "wow") {
      ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.05, r * 0.12, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.05, r * 0.12, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(0, r * 0.3, r * 0.16, 0, 7); ctx.fill();
    } else {
      if (blink) {
        ctx.strokeStyle = "#2b5a78"; ctx.lineWidth = r * 0.09; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(-r * 0.42, -r * 0.05); ctx.lineTo(-r * 0.18, -r * 0.05); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(r * 0.18, -r * 0.05); ctx.lineTo(r * 0.42, -r * 0.05); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.05, r * 0.1, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.05, r * 0.1, 0, 7); ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(-r * 0.27, -r * 0.09, r * 0.035, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(r * 0.33, -r * 0.09, r * 0.035, 0, 7); ctx.fill();
      }
      // くち
      ctx.strokeStyle = "#2b5a78"; ctx.lineWidth = r * 0.08; ctx.lineCap = "round";
      ctx.beginPath();
      if (this.mood === "happy") ctx.arc(0, r * 0.14, r * 0.24, 0.25, Math.PI - 0.25);
      else ctx.arc(0, r * 0.16, r * 0.15, 0.35, Math.PI - 0.35);
      ctx.stroke();
      // ほっぺ
      ctx.fillStyle = "rgba(255,150,180,.5)";
      ctx.beginPath(); ctx.ellipse(-r * 0.52, r * 0.14, r * 0.12, r * 0.08, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(r * 0.52, r * 0.14, r * 0.12, r * 0.08, 0, 0, 7); ctx.fill();
    }
    ctx.restore();

    // happy のとき キラキラ
    if (this.mood === "happy") {
      const ph = (now * 0.004) % (Math.PI * 2);
      ctx.fillStyle = "#ffd93b";
      Icons.star(ctx, cx + Math.cos(ph) * s * 0.42, cy - s * 0.2 + Math.sin(ph * 2) * s * 0.1, s * 0.06, "#ffd93b");
      Icons.star(ctx, cx - Math.cos(ph) * s * 0.4, cy - s * 0.3, s * 0.045, "#ffe9a8");
    }
  },
};
