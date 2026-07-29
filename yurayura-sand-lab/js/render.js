// ライブ描画。背景・かみ・かげ・ひも・カップを毎フレーム描く。
// 堆積そのものは SandSystem の床キャンバスを貼り付けるだけ。
import { STAGE, PAPER, ANCHOR, CUP } from './config.js';
import { roundRectPath, TAU, clamp } from './utils.js';

export class Renderer {
  constructor(canvas, sand) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sand = sand;
    this.bg = this.buildBackground();
  }

  /** ラボの机っぽいパステル背景を一度だけ作っておく */
  buildBackground() {
    const c = document.createElement('canvas');
    c.width = STAGE.W;
    c.height = STAGE.H;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, STAGE.H);
    grad.addColorStop(0, '#ffe9f2');
    grad.addColorStop(0.5, '#f3ecff');
    grad.addColorStop(1, '#e2f4ff');
    g.fillStyle = grad;
    g.fillRect(0, 0, STAGE.W, STAGE.H);
    // 遠くにただよう水玉
    g.globalAlpha = 0.16;
    for (let i = 0; i < 40; i++) {
      g.fillStyle = ['#ffffff', '#ffd6e8', '#cfe8ff'][i % 3];
      g.beginPath();
      g.arc(Math.random() * STAGE.W, Math.random() * STAGE.H, 6 + Math.random() * 22, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    return c;
  }

  /**
   * @param {object} s 描画に必要な状態
   *   pend, sandColor, slideX(かみ替えアニメ), t
   */
  draw(s) {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.drawImage(this.bg, 0, 0);

    this.drawPaper(c, s.slideX || 0);

    const pos = s.pend.pos;
    this.drawShadow(c, pos);
    this.sand.drawFx(c);
    this.drawString(c, pos, s.pend.vx);
    this.drawCup(c, pos, s);
  }

  drawPaper(c, slideX) {
    // かみの下の影
    c.save();
    c.translate(slideX, 0);
    c.shadowColor = 'rgba(120, 90, 140, 0.25)';
    c.shadowBlur = 24;
    c.shadowOffsetY = 10;
    roundRectPath(c, PAPER.x, PAPER.y, PAPER.w, PAPER.h, PAPER.r);
    c.fillStyle = '#ffffff';
    c.fill();
    c.shadowColor = 'transparent';
    // 堆積キャンバス(かみの色+すな)
    c.drawImage(this.sand.floor, 0, 0);
    // マスキングテープ風の角かざり
    this.drawTape(c, PAPER.x + 26, PAPER.y - 6, -0.22, '#ffd6a5');
    this.drawTape(c, PAPER.x + PAPER.w - 96, PAPER.y - 6, 0.22, '#bde0fe');
    c.restore();
  }

  drawTape(c, x, y, angle, color) {
    c.save();
    c.translate(x + 35, y + 12);
    c.rotate(angle);
    c.globalAlpha = 0.85;
    c.fillStyle = color;
    c.fillRect(-38, -13, 76, 26);
    c.restore();
  }

  drawShadow(c, pos) {
    c.save();
    roundRectPath(c, PAPER.x, PAPER.y, PAPER.w, PAPER.h, PAPER.r);
    c.clip();
    c.fillStyle = 'rgba(80, 60, 90, 0.13)';
    c.beginPath();
    c.ellipse(pos.x, pos.y + 6, CUP.w * 0.52, CUP.w * 0.24, 0, 0, TAU);
    c.fill();
    c.restore();
  }

  drawString(c, pos, vx) {
    // フックの土台
    c.fillStyle = '#b998e8';
    roundRectPath(c, ANCHOR.x - 34, ANCHOR.y - 20, 68, 18, 8);
    c.fill();
    c.fillStyle = '#9a7bd0';
    c.beginPath();
    c.arc(ANCHOR.x, ANCHOR.y, 7, 0, TAU);
    c.fill();
    // ひも:速度でしなる二次曲線
    const bend = clamp(-vx * 0.028, -50, 50);
    c.strokeStyle = 'rgba(150, 120, 100, 0.9)';
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(ANCHOR.x, ANCHOR.y + 4);
    c.quadraticCurveTo(
      (ANCHOR.x + pos.x) / 2 + bend,
      (ANCHOR.y + pos.y) / 2,
      pos.x,
      pos.y - CUP.h * 0.52
    );
    c.stroke();
  }

  drawCup(c, pos, s) {
    const tilt = clamp(s.pend.vx * 0.00045, -0.2, 0.2);
    const w = CUP.w;
    const h = CUP.h;
    c.save();
    c.translate(pos.x, pos.y);
    c.rotate(tilt);

    // 本体(下がすこし細いカップ)
    const top = -h / 2;
    const bot = h / 2 - 8;
    c.beginPath();
    c.moveTo(-w / 2, top);
    c.lineTo(w / 2, top);
    c.lineTo(w * 0.36, bot);
    c.quadraticCurveTo(0, bot + 8, -w * 0.36, bot);
    c.closePath();
    c.fillStyle = '#fff8ef';
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = '#e8cdb0';
    c.stroke();

    // 中のすな(残量で高さが変わる)
    const level = this.sand.level;
    if (level > 0.02) {
      const fillTop = top + 8 + (1 - level) * (h - 22);
      c.save();
      c.clip();
      c.fillStyle = s.sandColor;
      c.globalAlpha = 0.9;
      c.fillRect(-w / 2, fillTop, w, h);
      c.globalAlpha = 1;
      c.restore();
    }

    // ふち
    c.beginPath();
    c.ellipse(0, top, w / 2 + 3, 7, 0, 0, TAU);
    c.fillStyle = '#ffe3ee';
    c.fill();
    c.strokeStyle = '#f0b9cf';
    c.stroke();

    // かお(にっこり)
    c.fillStyle = '#8a6d5a';
    c.beginPath();
    c.arc(-11, -4, 2.6, 0, TAU);
    c.arc(11, -4, 2.6, 0, TAU);
    c.fill();
    c.strokeStyle = '#8a6d5a';
    c.lineWidth = 2.4;
    c.beginPath();
    c.arc(0, 2, 7, 0.15 * Math.PI, 0.85 * Math.PI);
    c.stroke();
    // ほっぺ
    c.fillStyle = 'rgba(250, 160, 180, 0.5)';
    c.beginPath();
    c.arc(-17, 3, 4, 0, TAU);
    c.arc(17, 3, 4, 0, TAU);
    c.fill();

    // そこの穴と、こぼれるすなのすじ
    c.fillStyle = '#c9a688';
    c.beginPath();
    c.ellipse(0, bot + 6, 5.5, 2.6, 0, 0, TAU);
    c.fill();
    if (level > 0) {
      c.strokeStyle = s.sandColor;
      c.globalAlpha = 0.75;
      c.lineWidth = 3.2;
      c.beginPath();
      c.moveTo(0, bot + 7);
      c.lineTo(0, bot + 20);
      c.stroke();
      c.globalAlpha = 1;
    }
    c.restore();
  }
}
