// ライブ描画。背景・かみ・かげ・ひも・カップを毎フレーム描く。
import { getLayout } from './layout.js';
import { roundRectPath, TAU, clamp } from './utils.js';

export class Renderer {
  constructor(canvas, sand) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sand = sand;
    this.dpr = 1;
    this.bg = null;
    this.rebuildBackground();
  }

  setDpr(dpr) {
    this.dpr = dpr;
  }

  rebuildBackground() {
    const { stage } = getLayout();
    const c = document.createElement('canvas');
    c.width = stage.w;
    c.height = stage.h;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, stage.h);
    grad.addColorStop(0, '#ffe9f2');
    grad.addColorStop(0.5, '#f3ecff');
    grad.addColorStop(1, '#e2f4ff');
    g.fillStyle = grad;
    g.fillRect(0, 0, stage.w, stage.h);
    g.globalAlpha = 0.16;
    for (let i = 0; i < 40; i++) {
      g.fillStyle = ['#ffffff', '#ffd6e8', '#cfe8ff'][i % 3];
      g.beginPath();
      g.arc(Math.random() * stage.w, Math.random() * stage.h, 6 + Math.random() * 22, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    this.bg = c;
  }

  draw(s) {
    const c = this.ctx;
    const { stage, paper, anchor, cup } = getLayout();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.drawImage(this.bg, 0, 0, stage.w, stage.h);

    this.drawPaper(c, paper, s.slideX || 0);

    const pos = s.pend.pos;
    this.drawShadow(c, paper, pos, cup);
    this.sand.drawFx(c);
    this.drawString(c, anchor, pos, cup, s.pend.vx);
    this.drawCup(c, pos, cup, s);
  }

  drawPaper(c, paper, slideX) {
    c.save();
    c.translate(slideX, 0);
    c.shadowColor = 'rgba(120, 90, 140, 0.25)';
    c.shadowBlur = 24;
    c.shadowOffsetY = 10;
    roundRectPath(c, paper.x, paper.y, paper.w, paper.h, paper.r);
    c.fillStyle = '#ffffff';
    c.fill();
    c.shadowColor = 'transparent';
    c.drawImage(this.sand.floor, 0, 0);
    const tapeW = Math.min(76, paper.w * 0.1);
    this.drawTape(c, paper.x + paper.w * 0.04, paper.y - 6, -0.22, '#ffd6a5', tapeW);
    this.drawTape(c, paper.x + paper.w - tapeW - paper.w * 0.04, paper.y - 6, 0.22, '#bde0fe', tapeW);
    c.restore();
  }

  drawTape(c, x, y, angle, color, tapeW) {
    c.save();
    c.translate(x + tapeW / 2, y + 12);
    c.rotate(angle);
    c.globalAlpha = 0.85;
    c.fillStyle = color;
    c.fillRect(-tapeW / 2, -13, tapeW, 26);
    c.restore();
  }

  drawShadow(c, paper, pos, cup) {
    c.save();
    roundRectPath(c, paper.x, paper.y, paper.w, paper.h, paper.r);
    c.clip();
    c.fillStyle = 'rgba(80, 60, 90, 0.13)';
    c.beginPath();
    c.ellipse(pos.x, pos.y + 6 * getLayout().scale, cup.w * 0.52, cup.w * 0.24, 0, 0, TAU);
    c.fill();
    c.restore();
  }

  drawString(c, anchor, pos, cup, vx) {
    const scale = getLayout().scale;
    c.fillStyle = '#b998e8';
    roundRectPath(c, anchor.x - 34 * scale, anchor.y - 20 * scale, 68 * scale, 18 * scale, 8 * scale);
    c.fill();
    c.fillStyle = '#9a7bd0';
    c.beginPath();
    c.arc(anchor.x, anchor.y, 7 * scale, 0, TAU);
    c.fill();
    const bend = clamp(-vx * 0.028, -50 * scale, 50 * scale);
    c.strokeStyle = 'rgba(150, 120, 100, 0.9)';
    c.lineWidth = 3 * scale;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(anchor.x, anchor.y + 4 * scale);
    c.quadraticCurveTo(
      (anchor.x + pos.x) / 2 + bend,
      (anchor.y + pos.y) / 2,
      pos.x,
      pos.y - cup.h * 0.52,
    );
    c.stroke();
  }

  drawCup(c, pos, cup, s) {
    const scale = getLayout().scale;
    const tilt = clamp(s.pend.vx * 0.00045, -0.2, 0.2);
    const w = cup.w;
    const h = cup.h;
    c.save();
    c.translate(pos.x, pos.y);
    c.rotate(tilt);

    const top = -h / 2;
    const bot = h / 2 - 8 * scale;
    c.beginPath();
    c.moveTo(-w / 2, top);
    c.lineTo(w / 2, top);
    c.lineTo(w * 0.36, bot);
    c.quadraticCurveTo(0, bot + 8 * scale, -w * 0.36, bot);
    c.closePath();
    c.fillStyle = '#fff8ef';
    c.fill();
    c.lineWidth = 3 * scale;
    c.strokeStyle = '#e8cdb0';
    c.stroke();

    const level = this.sand.level;
    if (level > 0.02) {
      const fillTop = top + 8 * scale + (1 - level) * (h - 22 * scale);
      c.save();
      c.clip();
      c.fillStyle = s.sandColor;
      c.globalAlpha = 0.9;
      c.fillRect(-w / 2, fillTop, w, h);
      c.globalAlpha = 1;
      c.restore();
    }

    c.beginPath();
    c.ellipse(0, top, w / 2 + 3 * scale, 7 * scale, 0, 0, TAU);
    c.fillStyle = '#ffe3ee';
    c.fill();
    c.strokeStyle = '#f0b9cf';
    c.stroke();

    c.fillStyle = '#8a6d5a';
    c.beginPath();
    c.arc(-11 * scale, -4 * scale, 2.6 * scale, 0, TAU);
    c.arc(11 * scale, -4 * scale, 2.6 * scale, 0, TAU);
    c.fill();
    c.strokeStyle = '#8a6d5a';
    c.lineWidth = 2.4 * scale;
    c.beginPath();
    c.arc(0, 2 * scale, 7 * scale, 0.15 * Math.PI, 0.85 * Math.PI);
    c.stroke();
    c.fillStyle = 'rgba(250, 160, 180, 0.5)';
    c.beginPath();
    c.arc(-17 * scale, 3 * scale, 4 * scale, 0, TAU);
    c.arc(17 * scale, 3 * scale, 4 * scale, 0, TAU);
    c.fill();

    c.fillStyle = '#c9a688';
    c.beginPath();
    c.ellipse(0, bot + 6 * scale, 5.5 * scale, 2.6 * scale, 0, 0, TAU);
    c.fill();
    if (level > 0) {
      c.strokeStyle = s.sandColor;
      c.globalAlpha = 0.75;
      c.lineWidth = 3.2 * scale;
      c.beginPath();
      c.moveTo(0, bot + 7 * scale);
      c.lineTo(0, bot + 20 * scale);
      c.stroke();
      c.globalAlpha = 1;
    }
    c.restore();
  }
}
