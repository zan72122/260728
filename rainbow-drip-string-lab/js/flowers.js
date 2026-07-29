// 花。水をあげると育ち、あげた水の色で花びらが染まる。
// 段階: 0=芽 → 1..MAX=だんだん大きく咲く。最大まで育つとキラキラする。

import { CONFIG } from './config.js';
import { mixRyb, rybToRgb, rgbCss, shade } from './color.js';
import { sounds } from './audio.js';

export class Flower {
  constructor(xRatio, seedRyb = [1, 0.2, 0.3]) {
    this.xRatio = xRatio;
    this.stage = 0;
    this.water = 0;             // 次の段階までの水量
    this.petalRyb = seedRyb.slice();
    this.bloomPulse = 0;        // 咲いた瞬間のふくらみ
    this.sparkleTimer = 1;
    this.swayPhase = Math.random() * 10;
    this.x = 0; this.groundY = 0; this.scale = 1;
  }

  layout(w, groundY, scale) {
    this.x = this.xRatio * w;
    this.groundY = groundY;
    this.scale = scale;
  }

  /** 花の根元付近に落ちた水を飲む */
  drink(vol, ryb, world) {
    this.petalRyb = mixRyb(this.petalRyb, 3, ryb, vol * 1.5);
    this.water += vol;
    if (this.water >= CONFIG.FLOWER_BLOOM_STEP && this.stage < CONFIG.FLOWER_MAX_STAGE) {
      this.water -= CONFIG.FLOWER_BLOOM_STEP;
      this.stage++;
      this.bloomPulse = 1;
      world.particles.sparkle(this.x, this.headY(), 6);
      sounds.chime();
    } else {
      world.particles.sparkle(this.x, this.groundY - 8, 2);
    }
  }

  /** 花の頭の高さ */
  stemH() { return (24 + this.stage * 15) * this.scale; }
  headY() { return this.groundY - this.stemH(); }
  headR() { return (7 + this.stage * 4.4) * this.scale * (1 + this.bloomPulse * 0.25); }

  update(dt, world, time) {
    this.bloomPulse = Math.max(0, this.bloomPulse - dt * 1.8);
    // 満開の花はゆったりきらめく
    if (this.stage >= CONFIG.FLOWER_MAX_STAGE) {
      this.sparkleTimer -= dt;
      if (this.sparkleTimer <= 0) {
        this.sparkleTimer = 2.2 + Math.random() * 2;
        world.particles.sparkle(this.x, this.headY(), 4);
        sounds.sparkle();
      }
    }
  }

  draw(ctx, time) {
    const sway = Math.sin(time * 1.4 + this.swayPhase) * (2 + this.stage);
    const headX = this.x + sway;
    const headY = this.headY();
    const rgb = rybToRgb(this.petalRyb);
    ctx.save();
    // 茎
    ctx.beginPath();
    ctx.moveTo(this.x, this.groundY);
    ctx.quadraticCurveTo(this.x + sway * 0.4, (this.groundY + headY) / 2, headX, headY);
    ctx.strokeStyle = '#5cad63';
    ctx.lineWidth = Math.max(3, 3 + this.stage) * this.scale;
    ctx.lineCap = 'round';
    ctx.stroke();
    // 葉っぱ
    if (this.stage >= 1) {
      const ly = this.groundY - this.stemH() * 0.45;
      for (const side of [-1, 1]) {
        if (side > 0 && this.stage < 2) continue;
        ctx.beginPath();
        ctx.ellipse(this.x + side * 9 * this.scale, ly, 10 * this.scale, 4.5 * this.scale, side * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = '#69c06f';
        ctx.fill();
      }
    }
    // 花びら
    const R = this.headR();
    if (this.stage === 0) {
      // つぼみ(「ここにお水をあげてね」と分かる大きさにする)
      ctx.beginPath();
      ctx.ellipse(headX, headY, 9 * this.scale, 12 * this.scale, sway * 0.02, 0, Math.PI * 2);
      ctx.fillStyle = '#8fd18a';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(headX - 2 * this.scale, headY - 3 * this.scale, 3 * this.scale, 4.5 * this.scale, -0.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fill();
    } else {
      const petals = 6;
      for (let i = 0; i < petals; i++) {
        const ang = (i / petals) * Math.PI * 2 + time * 0.08;
        const px = headX + Math.cos(ang) * R * 0.72;
        const py = headY + Math.sin(ang) * R * 0.72;
        const grad = ctx.createRadialGradient(px, py, 1, px, py, R * 0.62);
        grad.addColorStop(0, rgbCss(shade(rgb, 0.4)));
        grad.addColorStop(1, rgbCss(rgb));
        ctx.beginPath();
        ctx.ellipse(px, py, R * 0.58, R * 0.44, ang, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }
      // 中心のお顔
      ctx.beginPath();
      ctx.arc(headX, headY, R * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = '#ffdf6b';
      ctx.fill();
      if (this.stage >= 2) {
        const er = Math.max(1.1, R * 0.05);
        ctx.fillStyle = '#7a5a3a';
        ctx.beginPath();
        ctx.arc(headX - R * 0.14, headY - R * 0.05, er, 0, Math.PI * 2);
        ctx.arc(headX + R * 0.14, headY - R * 0.05, er, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(headX, headY + R * 0.1, R * 0.13, 0, Math.PI);
        ctx.strokeStyle = '#7a5a3a';
        ctx.lineWidth = Math.max(1, R * 0.045);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  reset() {
    // 「おかたづけ」でも花は1段階だけ残す(積み上げた喜びを全部は消さない)
    this.stage = Math.min(this.stage, 1);
    this.water = 0;
  }
}
