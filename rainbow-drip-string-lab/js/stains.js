// 水彩のにじみ・シミを溜めるオフスクリーンレイヤー。
// 毎フレーム描き直さず「スタンプ」として蓄積するので、
// シミがいくら増えても描画コストは一定に保たれる。

import { CONFIG } from './config.js';
import { rybToRgb, rgbCss, shade } from './color.js';

export class StainLayer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.fadeTimer = 0;
  }

  resize(w, h) {
    // 既存のシミはリサイズ時に引き伸ばしてコピーする
    const old = this.canvas;
    const copy = document.createElement('canvas');
    copy.width = old.width;
    copy.height = old.height;
    if (old.width > 0) copy.getContext('2d').drawImage(old, 0, 0);
    this.canvas.width = Math.max(1, Math.round(w));
    this.canvas.height = Math.max(1, Math.round(h));
    if (copy.width > 1) {
      this.ctx.drawImage(copy, 0, 0, copy.width, copy.height, 0, 0, w, h);
    }
  }

  /**
   * 水彩風のにじみを1つ押す。
   * ふちがやわらかい円を、少しずらしながら数枚重ねて不規則さを出す。
   */
  stamp(x, y, radius, ryb, alpha = 0.16, clipRect = null) {
    const ctx = this.ctx;
    const rgb = rybToRgb(ryb);
    ctx.save();
    if (clipRect) {
      ctx.beginPath();
      ctx.rect(clipRect.x, clipRect.y, clipRect.w, clipRect.h);
      ctx.clip();
    }
    const blobs = 3;
    for (let i = 0; i < blobs; i++) {
      const rr = radius * (0.65 + Math.random() * 0.55);
      const ox = (Math.random() - 0.5) * radius * 0.7;
      const oy = (Math.random() - 0.5) * radius * 0.5;
      const grad = ctx.createRadialGradient(x + ox, y + oy, rr * 0.1, x + ox, y + oy, rr);
      grad.addColorStop(0, rgbCss(rgb, alpha));
      grad.addColorStop(0.7, rgbCss(shade(rgb, 0.1), alpha * 0.55));
      grad.addColorStop(1, rgbCss(rgb, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 古いシミをゆっくり退色させる(呼び出しは周期的) */
  update(dt) {
    this.fadeTimer += dt;
    if (this.fadeTimer >= CONFIG.STAIN_FADE_INTERVAL) {
      this.fadeTimer = 0;
      const ctx = this.ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${CONFIG.STAIN_FADE_ALPHA})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();
    }
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(ctx) {
    if (this.canvas.width > 1) ctx.drawImage(this.canvas, 0, 0);
  }
}
