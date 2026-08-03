// ============================================================
// みずみちラボ - ジオラマ描画
//   縦オブリーク投影: screenX = ox + x*cs
//                     screenY = oy + y*rs - h*eh
//   奥の行から手前の行へ描き、段差は「壁面」として描く
// ============================================================
"use strict";

const Render = {
  canvas: null, ctx: null,
  view: { ox: 0, oy: 0, cs: 12, rs: 9, eh: 7, w: 0, h: 0 },
  dpr: 1,
  fish: { t: -3, x: 8, y: 26 },   // ときどきはねる さかな
  boat: { x: 33, y: 26.5 },

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.resize();
  },

  resize() {
    const st = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(2, Math.round(st.width * this.dpr));
    this.canvas.height = Math.max(2, Math.round(st.height * this.dpr));
    const W = st.width, H = st.height;
    // マップ全体 (壁の高さぶんを含む) が収まる cs を計算
    const worldW = CFG.GW;                                  // cs 単位
    const worldH = CFG.GH * CFG.ROW + CFG.MAX_H * CFG.EH;   // cs 単位
    const pad = 18;
    const cs = Math.min((W - pad * 2) / worldW, (H - pad * 2) / worldH);
    const v = this.view;
    v.cs = cs; v.rs = cs * CFG.ROW; v.eh = cs * CFG.EH;
    v.ox = (W - CFG.GW * cs) / 2;
    v.oy = (H - CFG.GH * v.rs + CFG.MAX_H * v.eh) / 2;
    v.w = W; v.h = H;
  },

  // スクリーン座標 → セル (高さを考慮して手前から探す)
  pick(sx, sy) {
    const { ox, oy, cs, rs, eh } = this.view;
    const fx = (sx - ox) / cs;
    const x = Math.floor(fx);
    if (x < 0 || x >= CFG.GW) return null;
    for (let y = CFG.GH - 1; y >= 0; y--) {
      const h = World.h[idx(x, y)] + Water.w[idx(x, y)];
      const top = oy + y * rs - h * eh;
      const hS = (y + 1 < CFG.GH) ? World.h[idx(x, y + 1)] + Water.w[idx(x, y + 1)] : 0;
      const bottom = oy + (y + 1) * rs - hS * eh;
      if (sy >= top && sy <= Math.max(top + rs, bottom)) {
        return { x: fx, y: y + clamp((sy - top) / rs, 0, 0.99) };
      }
    }
    // 地面レベルでフォールバック
    const fy = (sy - oy) / rs;
    if (fy < -2 || fy > CFG.GH + 2) return null;
    return { x: fx, y: clamp(fy, 0, CFG.GH - 0.01) };
  },

  // ---------- セルの色 ----------
  topColor(i, x, y) {
    const t = World.type[i], h = World.h[i];
    let c;
    switch (t) {
      case T_SAND: c = mixRGB(PAL.sandLow, PAL.sand, clamp((h - 0.9) / 0.7, 0, 1)); break;
      case T_GRASS: {
        const k = clamp((h - 1.3) / 3.2, 0, 1);
        c = mixRGB(PAL.grass, PAL.grassHigh, k);
        break;
      }
      case T_ROCK:
        c = h > 5.6 ? PAL.snow : mixRGB(PAL.rock, PAL.rockHigh, clamp((h - 4.2) / 1.6, 0, 1));
        break;
      case T_RIVER: c = PAL.riverbed; break;
      case T_DITCH: c = PAL.ditch; break;
      case T_LEVEE: c = PAL.levee; break;
      case T_PLAT: c = PAL.plat; break;
      case T_SEA: c = PAL.seafloor; break;
      default: c = PAL.grass;
    }
    // 斜面の陰影 (ひかりは左上おく から)
    const hL = inGrid(x - 1, y) ? World.h[idx(x - 1, y)] : h;
    const hR = inGrid(x + 1, y) ? World.h[idx(x + 1, y)] : h;
    const hU = inGrid(x, y - 1) ? World.h[idx(x, y - 1)] : h;
    const hD = inGrid(x, y + 1) ? World.h[idx(x, y + 1)] : h;
    let lum = 1 + (hR - hL) * -0.05 + (hD - hU) * 0.09;
    // 等高線ふうの ごく薄い しまもよう (ジオラマの層)
    if (t !== T_SEA && t !== T_LEVEE) {
      lum *= (Math.floor(h * 1.4) % 2 === 0) ? 1.0 : 0.975;
    }
    lum = clamp(lum, 0.7, 1.3);
    return [c[0] * lum, c[1] * lum, c[2] * lum];
  },

  wallColor(i) {
    const t = World.type[i];
    if (t === T_LEVEE) return PAL.wallLevee;
    if (t === T_ROCK) return PAL.wallRock;
    if (t === T_PLAT) return PAL.wallPlat;
    return PAL.wallSoil;
  },

  // ---------- メイン描画 ----------
  draw(now) {
    const ctx = this.ctx;
    const v = this.view;
    const { ox, oy, cs, rs, eh } = v;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.drawTable(ctx, v);
    this.drawTray(ctx, v);

    const GW = CFG.GW, GH = CFG.GH;
    const h = World.h, w = Water.w, type = World.type, sea = World.seaMask;

    // 行ごとに: 地形 → 水 → オブジェクト
    for (let y = 0; y < GH; y++) {
      // --- 地形 ---
      for (let x = 0; x < GW; x++) {
        const i = idx(x, y);
        const hh = h[i];
        const px = ox + x * cs;
        const topY = oy + y * rs - hh * eh;

        // 上面
        const c = this.topColor(i, x, y);
        // ぬれあと: すこし濃く、あおっぽく
        const wet = Water.wet[i];
        if (wet > 0.03 && w[i] < 0.02 && !sea[i]) {
          const k = wet * 0.35;
          c[0] = lerp(c[0], c[0] * 0.62, k);
          c[1] = lerp(c[1], c[1] * 0.72, k);
          c[2] = lerp(c[2], c[2] * 0.86 + 30, k);
        }
        ctx.fillStyle = "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")";
        ctx.fillRect(px, topY, cs + 0.7, rs + 0.7);

        // 手前への壁面 (段差)
        const hS = (y + 1 < GH) ? h[idx(x, y + 1)] : 0;
        const drop = hh - hS;
        if (drop > 0.02) {
          const wallH = drop * eh;
          const wallY = topY + rs;
          // ちいさな段差は地表色をすこし暗く (なだらかな等高線)、
          // おおきな段差は土や石の壁 (がけ・だんめん)
          const soil = this.wallColor(i);
          const wk = clamp((drop - 0.5) / 0.8, 0, 1);
          const wc = mixRGB([c[0] * 0.87, c[1] * 0.87, c[2] * 0.9], soil, wk);
          const grad = ctx.createLinearGradient(0, wallY, 0, wallY + wallH);
          grad.addColorStop(0, rgb(wc, 1.02));
          grad.addColorStop(1, rgb(wc, 0.78));
          ctx.fillStyle = grad;
          ctx.fillRect(px, wallY - 0.5, cs + 0.7, wallH + 0.5);
          // 壁の上ふち: あかるいライン (はっきりした がけ だけ)
          if (drop > 0.9) {
            ctx.fillStyle = "rgba(255,255,255,.3)";
            ctx.fillRect(px, wallY - 0.5, cs + 0.7, Math.max(1, cs * 0.06));
          }
          // たかだいには かいだん
          if (World.stairs[i] && drop > 0.6) {
            this.drawStairs(ctx, px, wallY, cs, wallH);
          } else if (drop > 0.8 && type[i] !== T_LEVEE) {
            // 地層のよこ線
            ctx.fillStyle = "rgba(120,85,40,.10)";
            const n = Math.min(4, Math.floor(wallH / (cs * 0.4)));
            for (let k = 1; k <= n; k++) {
              ctx.fillRect(px, wallY + wallH * k / (n + 1), cs + 0.7, Math.max(1, cs * 0.04));
            }
          }
          if (type[i] === T_LEVEE) {
            // ていぼうの いしがき模様
            ctx.strokeStyle = "rgba(140,140,150,.35)";
            ctx.lineWidth = Math.max(1, cs * 0.04);
            const rows2 = Math.max(1, Math.floor(wallH / (cs * 0.34)));
            for (let k = 1; k <= rows2; k++) {
              const yy = wallY + wallH * k / (rows2 + 1);
              ctx.beginPath(); ctx.moveTo(px, yy); ctx.lineTo(px + cs, yy); ctx.stroke();
            }
            ctx.beginPath(); ctx.moveTo(px + cs * 0.5, wallY); ctx.lineTo(px + cs * 0.5, wallY + wallH); ctx.stroke();
          }
        }

        // ていぼうの上面: まるいふちどり
        if (type[i] === T_LEVEE) {
          ctx.fillStyle = "rgba(255,255,255,.5)";
          ctx.fillRect(px + cs * 0.08, topY + rs * 0.08, cs * 0.84, Math.max(1, cs * 0.09));
          ctx.fillStyle = "rgba(120,120,130,.18)";
          ctx.fillRect(px + cs * 0.08, topY + rs * 0.8, cs * 0.84, Math.max(1, cs * 0.09));
        }
        // かわらの小石
        if (type[i] === T_RIVER && ((x * 7 + y * 13) % 5 === 0)) {
          ctx.fillStyle = "rgba(255,255,255,.4)";
          ctx.beginPath();
          ctx.ellipse(px + cs * (0.25 + ((x * 31 + y * 17) % 10) / 20), topY + rs * 0.5, cs * 0.09, cs * 0.06, 0, 0, 7);
          ctx.fill();
        }
      }

      // --- 水 ---
      this.drawWaterRow(ctx, y, now);

      // --- 行に属するオブジェクト ---
      this.drawObjectsOnRow(ctx, y, now);
    }

    // 海の生きもの
    this.drawSeaLife(ctx, now);

    // みくらべ: まえの水の跡をピンクのてんせんで
    if (Modes.compareMask) this.drawCompareOutline(ctx, now);

    // おだいのターゲットマーカー
    if (Modes.current === "quest") Modes.drawQuestMarkers(ctx, this.view, now);

    Particles.draw(ctx, this.view, now);

    // 指カーソル
    if (Input.cursor) this.drawCursor(ctx, now);
  },

  // ---------- 背景: つくえ + トレイ ----------
  drawTable(ctx, v) {
    ctx.fillStyle = PAL.wood1;
    ctx.fillRect(0, 0, v.w, v.h);
    ctx.fillStyle = PAL.wood2;
    for (let i = 0; i < 6; i++) {
      const yy = (i + 0.5) * v.h / 6 + Math.sin(i * 5) * 8;
      ctx.fillRect(0, yy, v.w, 2.5);
    }
    ctx.fillStyle = "rgba(255,255,255,.06)";
    ctx.fillRect(0, 0, v.w, v.h * 0.25);
  },

  drawTray(ctx, v) {
    const { ox, oy, cs, rs, eh } = v;
    const pad = cs * 0.9;
    const x0 = ox - pad, y0 = oy - CFG.MAX_H * eh - pad * 0.6;
    const x1 = ox + CFG.GW * cs + pad, y1 = oy + CFG.GH * rs + pad * 0.8;
    ctx.save();
    ctx.shadowColor = PAL.trayShadow;
    ctx.shadowBlur = cs * 1.4;
    ctx.shadowOffsetY = cs * 0.5;
    ctx.fillStyle = PAL.trayEdge;
    rr(ctx, x0, y0, x1 - x0, y1 - y0, cs * 1.3);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = PAL.tray;
    rr(ctx, x0 + cs * 0.28, y0 + cs * 0.28, x1 - x0 - cs * 0.56, y1 - y0 - cs * 0.56, cs);
    ctx.fill();
  },

  drawStairs(ctx, px, wallY, cs, wallH) {
    const steps = Math.max(2, Math.round(wallH / (cs * 0.3)));
    ctx.fillStyle = "#e8d9b8";
    ctx.fillRect(px + cs * 0.12, wallY, cs * 0.76, wallH);
    for (let k = 0; k < steps; k++) {
      ctx.fillStyle = k % 2 ? "#d9c69c" : "#efe3c4";
      ctx.fillRect(px + cs * 0.12, wallY + wallH * k / steps, cs * 0.76, wallH / steps * 0.85);
    }
    ctx.strokeStyle = "rgba(120,85,40,.25)";
    ctx.lineWidth = Math.max(1, cs * 0.04);
    ctx.strokeRect(px + cs * 0.12, wallY, cs * 0.76, wallH);
  },

  // ---------- 水の描画 ----------
  drawWaterRow(ctx, y, now) {
    const v = this.view;
    const { ox, oy, cs, rs, eh } = v;
    const GW = CFG.GW, GH = CFG.GH;
    const h = World.h, w = Water.w, sea = World.seaMask;

    for (let x = 0; x < GW; x++) {
      const i = idx(x, y);
      const d = w[i];
      if (d < 0.015) continue;
      const surf = h[i] + d;
      const px = ox + x * cs;
      const py = oy + y * rs - surf * eh;

      const isSea = sea[i] === 1;
      const depthK = clamp(d / (isSea ? 1.0 : 0.6), 0, 1);
      const c = isSea
        ? mixRGB(PAL.seaShallow, PAL.seaDeep, depthK)
        : mixRGB(PAL.waterShallow, PAL.waterDeep, depthK);
      // 海のなみ模様
      let lum = 1;
      if (isSea) {
        lum = 1 + 0.035 * Math.sin(x * 0.5 + y * 0.9 - now * 0.0028) + 0.025 * Math.sin(x * 0.23 - now * 0.0016);
      } else {
        lum = 1 + 0.035 * Math.sin(x * 0.8 + y * 0.6 + now * 0.003);
      }
      const alpha = clamp(0.5 + depthK * 0.38, 0, 0.9);
      ctx.fillStyle = rgba(c, alpha, lum);

      // となりに水がない側の角をまるく → ぷるんとした ふち
      const wL = x > 0 ? w[i - 1] : 1, wR = x < GW - 1 ? w[i + 1] : 1;
      const wU = y > 0 ? w[i - GW] : 1, wD = y < GH - 1 ? w[i + GW] : 1;
      const e = 0.015;
      const rad = cs * 0.42;
      const rTL = (wL < e || wU < e) ? rad : 0;
      const rTR = (wR < e || wU < e) ? rad : 0;
      const rBL = (wL < e || wD < e) ? rad : 0;
      const rBR = (wR < e || wD < e) ? rad : 0;
      this.roundedCell(ctx, px, py, cs + 0.7, rs + 0.7, rTL, rTR, rBR, rBL);
      ctx.fill();

      // 水の手前壁 (だんさを流れおちる水)
      const jS = (y + 1 < GH) ? idx(x, y + 1) : -1;
      const surfS = jS >= 0 ? h[jS] + w[jS] : 0;
      const dropW = surf - Math.max(surfS, h[i]);
      if (dropW > 0.1 && (jS < 0 || surf - surfS > 0.1)) {
        const fallH = clamp((surf - surfS), 0, 3) * eh;
        ctx.fillStyle = rgba(mixRGB(c, [255, 255, 255], 0.25), alpha * 0.9);
        ctx.fillRect(px, py + rs, cs + 0.7, fallH);
        // おちる水の白いすじ
        if (fallH > cs * 0.3) {
          ctx.fillStyle = "rgba(255,255,255,.45)";
          const ph = (now * 0.006 + x * 1.3) % 1;
          ctx.fillRect(px + cs * 0.2, py + rs + fallH * ph * 0.7, cs * 0.12, fallH * 0.3);
          ctx.fillRect(px + cs * 0.6, py + rs + fallH * ((ph + 0.4) % 1) * 0.7, cs * 0.1, fallH * 0.25);
        }
      }

      // ふちの白いハイライト (みずのぷるん感)
      if (wU < e) {
        ctx.strokeStyle = "rgba(255,255,255,.55)";
        ctx.lineWidth = Math.max(1, cs * 0.08);
        ctx.beginPath();
        ctx.moveTo(px + rTL * 0.7, py + cs * 0.05);
        ctx.lineTo(px + cs - rTR * 0.7, py + cs * 0.05);
        ctx.stroke();
      }

      // なぎさの あわあわ
      if (isSea && y > 0 && !sea[i - GW] && w[i - GW] < 0.03) {
        const ph = 0.5 + 0.5 * Math.sin(now * 0.0022 + x * 0.8);
        ctx.fillStyle = "rgba(255,255,255," + (0.35 + ph * 0.35) + ")";
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          ctx.arc(px + cs * (0.2 + k * 0.3), py + rs * 0.18 + ph * rs * 0.1, cs * (0.1 + 0.04 * Math.sin(x * 3 + k * 2)), 0, 7);
        }
        ctx.fill();
      }

      // きらきら・あわ (ときどき)
      const glow = Water.flowGlow[i];
      if (glow > 0.3 && Math.random() < glow * 0.018) Particles.sparkle(x + Math.random(), y + Math.random() * 0.5, surf);
      if (isSea && Math.random() < 0.0007) Particles.sparkle(x + Math.random(), y + Math.random() * 0.5, surf);
      if (!isSea && d > 0.25 && Math.random() < 0.002) Particles.bubble(x + Math.random(), y + Math.random() * 0.5, surf);
    }
  },

  roundedCell(ctx, x, y, w2, h2, rTL, rTR, rBR, rBL) {
    ctx.beginPath();
    ctx.moveTo(x + rTL, y);
    ctx.lineTo(x + w2 - rTR, y);
    if (rTR) ctx.quadraticCurveTo(x + w2, y, x + w2, y + rTR);
    ctx.lineTo(x + w2, y + h2 - rBR);
    if (rBR) ctx.quadraticCurveTo(x + w2, y + h2, x + w2 - rBR, y + h2);
    ctx.lineTo(x + rBL, y + h2);
    if (rBL) ctx.quadraticCurveTo(x, y + h2, x, y + h2 - rBL);
    ctx.lineTo(x, y + rTL);
    if (rTL) ctx.quadraticCurveTo(x, y, x + rTL, y);
    ctx.closePath();
  },

  // ---------- オブジェクト ----------
  drawObjectsOnRow(ctx, y, now) {
    const v = this.view;
    const { ox, oy, cs, rs, eh } = v;
    // 建物 (2x2 の下端の行で描く)
    for (const b of World.buildings) {
      if (b.y + 1 !== y) continue;
      const gx = b.x + 1, gy = b.y + 1.4;
      const hh = World.h[idx(b.x, b.y)];
      const px = ox + gx * cs;
      const py = oy + gy * rs - hh * eh;
      drawBuildingObj(ctx, b, px, py, cs, now);
    }
    // 木
    for (const t of World.trees) {
      if (Math.round(t.y) !== y) continue;
      const i = idx(clamp(Math.round(t.x), 0, CFG.GW - 1), clamp(Math.round(t.y), 0, CFG.GH - 1));
      const px = ox + (t.x + 0.5) * cs;
      const py = oy + (t.y + 0.7) * rs - World.h[i] * eh;
      drawTreeObj(ctx, t, px, py, cs, now);
    }
    // 花 (水にしずんでいたら かくす)
    for (const f of World.flowers) {
      if (Math.floor(f.y) !== y) continue;
      const i = idx(clamp(Math.floor(f.x), 0, CFG.GW - 1), clamp(Math.floor(f.y), 0, CFG.GH - 1));
      if (Water.w[i] > 0.08) continue;
      const px = ox + f.x * cs;
      const py = oy + f.y * rs - World.h[i] * eh;
      drawFlowerObj(ctx, f, px, py, cs);
    }
    // 湧き水マーク
    for (const s of World.springs) {
      if (Math.round(s.y) !== y) continue;
      const i = idx(Math.round(s.x), Math.round(s.y));
      const px = ox + (s.x + 0.5) * cs;
      const py = oy + (s.y + 0.4) * rs - (World.h[i] + Water.w[i]) * eh;
      const ph = 0.5 + 0.5 * Math.sin(now * 0.005);
      ctx.globalAlpha = 0.5 + ph * 0.4;
      drawDropShape(ctx, px, py - cs * 0.5 - ph * cs * 0.15, cs * 0.26, "#7fd4ee");
      ctx.globalAlpha = 1;
    }
  },

  drawSeaLife(ctx, now) {
    const v = this.view;
    const { ox, oy, cs, rs, eh } = v;
    // ふね
    const b = this.boat;
    const bi = idx(Math.round(b.x), Math.round(b.y));
    if (World.seaMask[bi]) {
      const surf = World.h[bi] + Water.w[bi];
      drawBoat(ctx, ox + b.x * cs, oy + b.y * rs - surf * eh, cs * 0.9, now);
    }
    // さかなのジャンプ
    const f = this.fish;
    if (f.t < 0) {
      f.t = 0;
      f.wait = 4 + Math.random() * 6;
      // 海のセルをさがす
      for (let tries = 0; tries < 20; tries++) {
        const x = 2 + Math.floor(Math.random() * (CFG.GW - 4));
        const y = CFG.GH - 2 - Math.floor(Math.random() * 4);
        if (World.seaMask[idx(x, y)]) { f.x = x; f.y = y; break; }
      }
    }
    f.t += 1 / 60;
    if (f.t > f.wait && f.t < f.wait + 1.1) {
      const ph = (f.t - f.wait) / 1.1;
      const i = idx(Math.round(f.x), Math.round(f.y));
      const surf = World.h[i] + Water.w[i];
      drawFish(ctx, ox + f.x * cs, oy + f.y * rs - surf * eh, cs * 0.8, ph);
      if (ph < 0.08 || ph > 0.92) Particles.splash(f.x, f.y, surf);
    } else if (f.t >= f.wait + 1.1) {
      f.t = -1;
    }
  },

  // ---------- みくらべの跡 ----------
  drawCompareOutline(ctx, now) {
    const v = this.view;
    const { ox, oy, cs, rs, eh } = v;
    const m = Modes.compareMask;
    ctx.save();
    ctx.strokeStyle = "rgba(255,110,160,.85)";
    ctx.lineWidth = Math.max(2, cs * 0.13);
    ctx.setLineDash([cs * 0.4, cs * 0.3]);
    ctx.lineDashOffset = -now * 0.01;
    ctx.lineCap = "round";
    for (let y = 0; y < CFG.GH; y++) {
      for (let x = 0; x < CFG.GW; x++) {
        const i = idx(x, y);
        if (!m[i]) continue;
        const hh = World.h[i] + Water.w[i];
        const px = ox + x * cs;
        const py = oy + y * rs - hh * eh;
        // 外周だけ線を引く
        if (y === 0 || !m[i - CFG.GW]) {
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + cs, py); ctx.stroke();
        }
        if (y === CFG.GH - 1 || !m[i + CFG.GW]) {
          ctx.beginPath(); ctx.moveTo(px, py + rs); ctx.lineTo(px + cs, py + rs); ctx.stroke();
        }
        if (x === 0 || !m[i - 1]) {
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + rs); ctx.stroke();
        }
        if (x === CFG.GW - 1 || !m[i + 1]) {
          ctx.beginPath(); ctx.moveTo(px + cs, py); ctx.lineTo(px + cs, py + rs); ctx.stroke();
        }
      }
    }
    ctx.restore();
  },

  // ---------- カーソル ----------
  drawCursor(ctx, now) {
    const c = Input.cursor;
    const v = this.view;
    const i = idx(clamp(Math.floor(c.x), 0, CFG.GW - 1), clamp(Math.floor(c.y), 0, CFG.GH - 1));
    const surf = World.h[i] + Water.w[i];
    const px = v.ox + c.x * v.cs;
    const py = v.oy + c.y * v.rs - surf * v.eh;
    const pulse = 1 + 0.12 * Math.sin(now * 0.012);
    let r = v.cs * 1.2, col = "rgba(255,255,255,.75)";
    const tl = Input.tool;
    if (tl === "mountain" || tl === "plateau") { r = v.cs * 2.3; col = "rgba(170,220,120,.8)"; }
    else if (tl === "ditch") { r = v.cs * 1.0; col = "rgba(190,170,110,.85)"; }
    else if (tl === "river") { r = v.cs * 1.4; col = "rgba(120,210,235,.85)"; }
    else if (tl === "levee") { r = v.cs * 0.8; col = "rgba(230,230,235,.9)"; }
    else if (tl === "water") { r = v.cs * 1.1; col = "rgba(110,205,240,.9)"; }
    else if (tl === "eraser") { r = v.cs * 1.6; col = "rgba(255,160,190,.85)"; }
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(2, v.cs * 0.12);
    ctx.beginPath();
    ctx.ellipse(px, py, r * pulse, r * pulse * 0.62, 0, 0, 7);
    ctx.stroke();

    // 建物ゴースト
    if (tl === "building" && Input.down) {
      drawBuildingObj(ctx, { kind: Input.buildingKind, wet: 0, happy: 0 }, px, py, v.cs, now);
    }
  },
};
