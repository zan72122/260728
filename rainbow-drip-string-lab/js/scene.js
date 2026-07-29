// 背景(こぢんまりした実験ボード)と、上部の雨雲ディスペンサー。

import { CONFIG } from './config.js';
import { rybToRgb, rgbCss, shade } from './color.js';
import { sounds } from './audio.js';

// --------------------------------------------------------------- 背景
export function drawBackground(ctx, w, h, groundY, time) {
  // やわらかい壁
  const wall = ctx.createLinearGradient(0, 0, 0, h);
  wall.addColorStop(0, '#fdf3f7');
  wall.addColorStop(0.5, '#f7eff9');
  wall.addColorStop(1, '#eef2fb');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);

  // 控えめな水玉模様(位置は決定的に)
  ctx.fillStyle = 'rgba(220,200,235,0.18)';
  const step = 90;
  for (let gy = 60; gy < groundY - 40; gy += step) {
    for (let gx = ((gy / step) % 2) * step * 0.5 + 30; gx < w; gx += step) {
      ctx.beginPath();
      ctx.arc(gx, gy, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 木の棚(床)
  const floorGrad = ctx.createLinearGradient(0, groundY, 0, h);
  floorGrad.addColorStop(0, '#e9c9a3');
  floorGrad.addColorStop(1, '#d9b285');
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, groundY, w, h - groundY);
  // 棚のふち
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(0, groundY, w, 3);
  // 木目
  ctx.strokeStyle = 'rgba(170,125,80,0.25)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    const yy = groundY + 8 + i * ((h - groundY) / 4.5);
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.bezierCurveTo(w * 0.3, yy + 3, w * 0.6, yy - 3, w, yy + 2);
    ctx.stroke();
  }
}

// --------------------------------------------------------------- 雨雲
export class Cloud {
  constructor() {
    this.x = 200;
    this.y = 90;
    this.active = false;   // 押されている間 true
    this.dripTimer = 0;
    this.puff = 0;         // 滴下時のぷるん
    this.w = 118;          // タッチ判定の幅(大きめ)
    this.h = 84;
  }

  layout(w, h, topBarBottom) {
    this.y = Math.max(topBarBottom + 46, h * CONFIG.CLOUD_Y_RATIO);
    this.x = Math.min(Math.max(this.x, 70), w - 70);
  }

  hit(x, y) {
    return Math.abs(x - this.x) < this.w / 2 + 16 && Math.abs(y - this.y) < this.h / 2 + 22;
  }

  update(dt, world) {
    this.puff = Math.max(0, this.puff - dt * 4);
    if (this.active) {
      this.dripTimer -= dt;
      if (this.dripTimer <= 0) {
        this.dripTimer = CONFIG.DRIP_INTERVAL;
        this.drip(world);
      }
    } else {
      this.dripTimer = 0;
    }
  }

  /** 選択中の色のしずくを1粒落とす */
  drip(world) {
    const color = world.currentColor;
    const jitter = (Math.random() - 0.5) * 26;
    if (color.rainbow) {
      // 虹モード: 小粒をぱらぱらと
      for (let i = 0; i < 2; i++) {
        world.droplets.spawn(this.x + (Math.random() - 0.5) * 44, this.y + 30, null, {
          rainbow: true, vol: 0.7, vx: (Math.random() - 0.5) * 24,
        });
      }
    } else {
      world.droplets.spawn(this.x + jitter, this.y + 30, color.ryb, {
        vol: CONFIG.DROP_BASE_VOL, vx: (Math.random() - 0.5) * 12,
      });
    }
    this.puff = 1;
    world.firstDripDone = true;
    sounds.plop(1);
  }

  draw(ctx, world, time) {
    const squash = 1 + this.puff * 0.06;
    const breathe = 1 + Math.sin(time * 1.8) * 0.015;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(squash * breathe, (2 - squash) * breathe);

    // おなかは選択中の色にほんのり染まる
    const color = world.currentColor;
    const bellyRgb = color.rainbow ? [200, 160, 255] : rybToRgb(color.ryb);

    ctx.shadowColor = 'rgba(150,120,160,0.25)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
    // もこもこの雲本体
    const puffs = [
      [-36, 4, 26], [0, -12, 33], [36, 4, 26], [0, 12, 30],
    ];
    ctx.beginPath();
    for (const [px, py, pr] of puffs) {
      ctx.moveTo(px + pr, py);
      ctx.arc(px, py, pr, 0, Math.PI * 2);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.shadowBlur = 0;
    // 色づくおなか
    ctx.beginPath();
    ctx.ellipse(0, 20, 34, 12, 0, 0, Math.PI);
    ctx.fillStyle = rgbCss(shade(bellyRgb, 0.45), 0.85);
    ctx.fill();

    // ねむたげな目と口
    ctx.strokeStyle = '#8b7a90';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    for (const ex of [-13, 13]) {
      ctx.beginPath();
      ctx.arc(ex, -2, 5, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 8, 4, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();
    // ほっぺ
    ctx.fillStyle = 'rgba(255,160,180,0.4)';
    for (const ex of [-24, 24]) {
      ctx.beginPath();
      ctx.arc(ex, 6, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 押している間、下からしずくがちらっと見える
    if (this.active) {
      const t = (time * 6) % 1;
      ctx.beginPath();
      ctx.arc(this.x, this.y + 32 + t * 10, 5 * (1 - t * 0.4), 0, Math.PI * 2);
      ctx.fillStyle = color.rainbow
        ? `hsla(${(time * 240) % 360},85%,62%,${0.9 - t * 0.6})`
        : rgbCss(bellyRgb, 0.9 - t * 0.6);
      ctx.fill();
    }
  }
}

/** はじめてのヒント: 雲を指さすアニメーション(文字なし) */
export function drawHint(ctx, cloud, time) {
  const bob = Math.sin(time * 3.2) * 9;
  const x = cloud.x;
  const y = cloud.y + 74 + bob;
  ctx.save();
  // ふわふわ光る輪
  ctx.beginPath();
  ctx.arc(cloud.x, cloud.y, 62 + Math.sin(time * 3.2) * 6, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,190,90,${0.45 + Math.sin(time * 3.2) * 0.2})`;
  ctx.lineWidth = 4;
  ctx.stroke();
  // 指さし
  ctx.font = '44px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('👆', x, y);
  ctx.restore();
}
