'use strict';
/* ==========================================================
   まるパン
   固有の変身:
   - こねた量 → グルテン → 生地の表面のなめらかさ / 弾力
     (押して離すと跳ね返る強さ・へこみの戻る速さが変わる)
   - まるめた量 → 形の整い方
   - あたためた時間 → 発酵のふくらみ (むくむく育つ)
   - 焼き時間 → 窯のび + 焼き色
   - 最後につつくと ぷにぷに はずむ (こね具合がはね方に残る)
   ========================================================== */
(function () {

  const def = {
    id: 'bread',
    color: '#f7d9a8',
    icon(ctx, r) {
      ell(ctx, 0, r * 0.15, r * 0.95, r * 0.7, '#c98a3e');
      ell(ctx, 0, r * 0.05, r * 0.92, r * 0.68, '#e8b25f');
      ell(ctx, -r * 0.3, -r * 0.15, r * 0.3, r * 0.2, 'rgba(255,255,255,0.45)');
      ctx.strokeStyle = '#b97a35'; ctx.lineWidth = r * 0.07;
      ctx.beginPath(); ctx.arc(0, r * 0.05, r * 0.5, -2.6, -0.5); ctx.stroke();
    },

    steps(sc) {
      const F = sc.food;
      F.flour = false; F.water = 0; F.yeast = false;
      F.gluten = 0; F.proof = 0; F.brown = 0;
      F.balls = [];

      const doughAt = () => ({ x: App.W / 2, y: App.H * 0.55 });

      /* ================= step 1 : ingredients ================= */
      let pouring = false;
      const itemsAt = () => ({
        flour: { x: App.W * 0.2, y: App.H * 0.24 },
        water: { x: App.W * 0.8, y: App.H * 0.24 },
        yeast: { x: App.W * 0.5, y: App.H * 0.2 }
      });
      const s1 = {
        hint: 'tap',
        hintAt() {
          const it = itemsAt();
          return !F.flour ? it.flour : (!F.yeast ? it.yeast : it.water);
        },
        update(dt) {
          if (pouring && App.pointer.down) {
            F.water = Math.min(1, F.water + dt * 0.42);
          } else pouring = false;
        },
        draw(ctx) {
          const S = App.S, it = itemsAt(), d = doughAt();
          const r = Math.min(App.W * 0.32, 180 * S);
          drawBowl(ctx, d.x, d.y, r, '#9fd98a');
          ctx.save(); bowlClip(ctx, d.x, d.y, r);
          const b = bowlInner(d.x, d.y, r);
          if (F.flour) ell(ctx, b.x, b.y + b.ry * 0.1, b.rx * 0.7, b.ry * 0.62, '#f9f3e4');
          if (F.water > 0) ell(ctx, b.x, b.y + b.ry * 0.2, b.rx * (0.3 + F.water * 0.5), b.ry * (0.3 + F.water * 0.4), 'rgba(160,214,240,0.8)');
          if (F.yeast) {
            ctx.fillStyle = '#e8c26b';
            for (let i = 0; i < 10; i++) circle(ctx, b.x + (n1(i * 3) - 0.5) * b.rx, b.y + (n1(i * 7) - 0.4) * b.ry, 3.4 * S);
          }
          ctx.restore();
          if (!F.flour) {
            ctx.fillStyle = '#f7ead2';
            rr(ctx, it.flour.x - 38 * S, it.flour.y - 46 * S, 76 * S, 92 * S, 12 * S); ctx.fill();
            ctx.fillStyle = '#e8d5ac';
            rr(ctx, it.flour.x - 38 * S, it.flour.y - 46 * S, 76 * S, 24 * S, 12 * S); ctx.fill();
            ell(ctx, it.flour.x, it.flour.y + 10 * S, 24 * S, 18 * S, '#fff');
          }
          if (!F.yeast) {
            ctx.fillStyle = '#e8a13f';
            rr(ctx, it.yeast.x - 26 * S, it.yeast.y - 32 * S, 52 * S, 64 * S, 10 * S); ctx.fill();
            ctx.fillStyle = '#c9822a';
            rr(ctx, it.yeast.x - 26 * S, it.yeast.y - 32 * S, 52 * S, 18 * S, 8 * S); ctx.fill();
            circle(ctx, it.yeast.x, it.yeast.y + 8 * S, 12 * S, '#fbe9c0');
          }
          if (pouring && App.pointer.down) {
            drawPitcher(ctx, d.x - 60 * S, d.y - r - 60 * S, S * 1.1, -0.9, '#d8ecfa', '#aad6f0');
            drawStream(ctx, d.x - 95 * S, d.y - r - 75 * S, d.x - 20 * S, d.y - 20 * S, 9 * S, 'rgba(160,214,240,0.9)');
          } else {
            drawPitcher(ctx, it.water.x, it.water.y, S * 1.1, 0, '#d8ecfa', '#aad6f0');
          }
        },
        down(p) {
          const S = App.S, it = itemsAt(), d = doughAt();
          if (!F.flour && dist(p.x, p.y, it.flour.x, it.flour.y) < 70 * S) {
            F.flour = true; Snd.plop();
            for (let i = 0; i < 14; i++) {
              sc.parts.add({ x: d.x + rnd(-70, 70) * S, y: d.y - rnd(0, 50) * S, color: '#fff', r: rnd(5, 11) * S, vy: -rnd(20, 60) * S, life: rnd(0.4, 0.8), kind: 'steam', grow: 9 * S });
            }
            return;
          }
          if (!F.yeast && dist(p.x, p.y, it.yeast.x, it.yeast.y) < 64 * S) {
            F.yeast = true; Snd.chime();
            sparkleBurst(sc.parts, d.x, d.y - 30 * S, '#ffd94f', 10);
            return;
          }
          if (dist(p.x, p.y, it.water.x, it.water.y) < 80 * S) { pouring = true; Snd.tick(); }
        },
        up() { pouring = false; },
        done: () => F.flour && F.yeast && F.water > 0.2
      };

      /* ================= step 2 : knead ================= */
      let ox = 0, oy = 0, ovx = 0, ovy = 0;
      let dimples = [];
      let kneadSnd = 0;
      const s2 = {
        hint: 'drag',
        hintOpt: { dx: 0.8, dy: 0.5 },
        hintAt() { const d = doughAt(); return { x: d.x, y: d.y }; },
        update(dt) {
          const p = App.pointer, d = doughAt(), S = App.S;
          const R = 120 * S;
          kneadSnd -= dt;
          if (p.down && dist(p.x, p.y, d.x, d.y) < R * 1.6) {
            /* dough follows the finger a little; travel builds gluten */
            const tx = clamp(p.x - d.x, -55 * S, 55 * S);
            const ty = clamp(p.y - d.y, -45 * S, 45 * S);
            ox = lerp(ox, tx, 0.4); oy = lerp(oy, ty, 0.4);
            ovx = ovy = 0;
            const travel = Math.hypot(p.x - p.px, p.y - p.py);
            if (travel > 1) {
              F.gluten = Math.min(1, F.gluten + travel * 0.00075 / S * S);
              if (kneadSnd <= 0 && travel > 8 * S) { Snd.knead(); kneadSnd = 0.25; }
              if (Math.random() < 0.1) {
                sc.parts.add({ x: d.x + ox + rnd(-60, 60) * S, y: d.y + oy + rnd(20, 60) * S, color: '#fff', r: rnd(3, 7) * S, vy: -rnd(10, 40) * S, life: 0.5, kind: 'steam', grow: 6 * S });
              }
            }
          } else {
            /* spring back — stiffer & bouncier the more it was kneaded */
            const k = 40 + F.gluten * 220, damp = 4 + (1 - F.gluten) * 6;
            ovx += (-k * ox - damp * ovx) * dt; ox += ovx * dt;
            ovy += (-k * oy - damp * ovy) * dt; oy += ovy * dt;
          }
          for (const di of dimples) di.amp *= Math.pow(0.02 + (1 - F.gluten) * 0.5, dt * (1 + F.gluten * 4));
          dimples = dimples.filter(di => di.amp > 0.5);
        },
        draw(ctx) {
          const S = App.S, d = doughAt();
          /* floured board */
          ell(ctx, d.x, d.y + 30 * S, 230 * S, 120 * S, '#f2d9ae');
          ell(ctx, d.x, d.y + 26 * S, 218 * S, 110 * S, '#fbf0da');
          const cx = d.x + ox, cy = d.y + oy;
          const sq = clamp(Math.hypot(ox, oy) / (70 * S), 0, 0.5);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(Math.atan2(oy, ox));
          ctx.scale(1 + sq * 0.5, 1 - sq * 0.35);
          ctx.rotate(-Math.atan2(oy, ox));
          const irr = 0.05 + 0.15 * (1 - F.gluten);
          blobPath(ctx, 0, 8 * S, 118 * S, irr, 3.3);
          ctx.fillStyle = mixc('#ecd7a8', '#f8ecd0', F.gluten); ctx.fill();
          blobPath(ctx, 0, 0, 112 * S, irr, 3.3);
          ctx.fillStyle = mixc('#f2dfb4', '#fdf3dc', F.gluten); ctx.fill();
          /* rough lumpy shading fades away as gluten builds */
          ctx.globalAlpha = (1 - F.gluten) * 0.5;
          ctx.fillStyle = '#dcc28c';
          for (let i = 0; i < 7; i++) {
            ell(ctx, (n1(i * 5) - 0.5) * 150 * S, (n1(i * 9 + 1) - 0.5) * 110 * S, (10 + n1(i) * 16) * S, (7 + n1(i * 2) * 10) * S);
          }
          ctx.globalAlpha = 1;
          /* smooth shine appears when kneaded */
          ctx.globalAlpha = F.gluten * 0.5;
          ell(ctx, -40 * S, -42 * S, 34 * S, 20 * S, '#ffffff');
          ctx.globalAlpha = 1;
          /* dimples from pokes */
          for (const di of dimples) {
            ctx.globalAlpha = clamp(di.amp / 20, 0, 0.4);
            ell(ctx, di.x, di.y, di.amp * S, di.amp * 0.7 * S, '#c9ab74');
          }
          ctx.globalAlpha = 1;
          ctx.restore();
        },
        up(p, tap) {
          if (tap) {
            const d = doughAt(), S = App.S;
            if (dist(p.x, p.y, d.x + ox, d.y + oy) < 120 * S) {
              dimples.push({ x: p.x - d.x - ox, y: p.y - d.y - oy, amp: 18 });
              ovy -= 60 * S * (0.3 + F.gluten);
              Snd.knead();
            }
          }
        },
        done: () => F.gluten > 0.55
      };

      /* ================= step 3 : divide & round ================= */
      const s3 = {
        hint: 'stir',
        hintOpt: { r: 52 },
        hintAt() {
          const b = F.balls.find(b => b.round < 0.45) || F.balls[0];
          return b ? { x: b.px * App.W, y: b.py * App.H } : { x: App.W / 2, y: App.H / 2 };
        },
        enter() {
          F.balls = [0, 1, 2].map(i => ({
            px: 0.25 + i * 0.25, py: 0.55 + (i === 1 ? 0.08 : 0),
            round: 0, seed: rnd(10), stir: new Stir(), spin: 0,
            squish: 0, sqv: 0
          }));
          Snd.plop();
        },
        update(dt) {
          const p = App.pointer, S = App.S;
          for (const b of F.balls) {
            const bx = b.px * App.W, by = b.py * App.H;
            const sp = b.stir.feed(p, bx, by, 95 * S, dt);
            if (sp > 1) {
              b.round = Math.min(1, b.round + sp * dt * 0.05);
              b.spin += sp * dt * 0.4;
              if (Math.random() < dt * 3) Snd.tick();
            }
          }
        },
        draw(ctx) {
          const S = App.S;
          ell(ctx, App.W / 2, App.H * 0.6, App.W * 0.44, 130 * S, '#fbf0da');
          for (const b of F.balls) {
            const bx = b.px * App.W, by = b.py * App.H;
            ctx.save();
            ctx.translate(bx, by);
            ctx.rotate(Math.sin(b.spin) * 0.12);
            const irr = 0.04 + 0.2 * (1 - b.round);
            blobPath(ctx, 0, 6 * S, 62 * S, irr, b.seed);
            ctx.fillStyle = '#e8d3a4'; ctx.fill();
            blobPath(ctx, 0, 0, 58 * S, irr, b.seed);
            ctx.fillStyle = '#f8ecd0'; ctx.fill();
            ctx.globalAlpha = b.round * 0.5;
            ell(ctx, -18 * S, -22 * S, 16 * S, 10 * S, '#ffffff');
            ctx.globalAlpha = 1;
            ctx.restore();
          }
        },
        done: () => F.balls.length > 0 && F.balls.every(b => b.round > 0.45)
      };

      /* ================= step 4 : warm proof ================= */
      let warm = false;
      const s4 = {
        hint: 'hold',
        hintAt() { return { x: App.W / 2, y: App.H * 0.55 }; },
        update(dt) {
          warm = App.pointer.down;
          if (warm) {
            F.proof = Math.min(1, F.proof + dt * 0.22);
            if (Math.random() < 0.15) steamPuff(sc.parts, App.W / 2 + rnd(-120, 120) * App.S, App.H * 0.4);
            if (Math.random() < dt * 2) Snd.tick();
          }
        },
        draw(ctx) {
          const S = App.S, cx = App.W / 2, cy = App.H * 0.58;
          /* warm nest box */
          ctx.fillStyle = '#e8b87d';
          rr(ctx, cx - App.W * 0.4, cy - 90 * S, App.W * 0.8, 220 * S, 26 * S); ctx.fill();
          ctx.fillStyle = '#fbf0da';
          rr(ctx, cx - App.W * 0.38, cy - 74 * S, App.W * 0.76, 190 * S, 22 * S); ctx.fill();
          if (warm) {
            const g = ctx.createRadialGradient(cx, cy, 20 * S, cx, cy, App.W * 0.42);
            g.addColorStop(0, 'rgba(255,190,90,0.4)'); g.addColorStop(1, 'rgba(255,190,90,0)');
            ctx.fillStyle = g;
            ctx.fillRect(cx - App.W * 0.45, cy - 160 * S, App.W * 0.9, 340 * S);
          }
          const breathe = 1 + 0.025 * Math.sin(App.time * 2.4) * (0.3 + F.proof);
          F.balls.forEach((b, i) => {
            const bx = cx + (i - 1) * App.W * 0.22, by = cy + 20 * S;
            const sc2 = (1 + F.proof * 0.6) * breathe;
            ctx.save();
            ctx.translate(bx, by); ctx.scale(sc2, sc2 * 0.92);
            const irr = 0.04 + 0.18 * (1 - b.round);
            blobPath(ctx, 0, 5 * S, 56 * S, irr, b.seed);
            ctx.fillStyle = '#e8d3a4'; ctx.fill();
            blobPath(ctx, 0, 0, 53 * S, irr, b.seed);
            ctx.fillStyle = '#fdf3dc'; ctx.fill();
            ctx.globalAlpha = 0.4;
            ell(ctx, -16 * S, -18 * S, 14 * S, 9 * S, '#ffffff');
            ctx.globalAlpha = 1;
            ctx.restore();
          });
        },
        done: () => F.proof > 0.4
      };

      /* ================= step 5 : bake ================= */
      const s5 = {
        hint: 'hold',
        hintAt() { return { x: App.W / 2, y: App.H * 0.78 }; },
        enter() { Snd.setSizzle(0.25); },
        update(dt) {
          F.brown = Math.min(1.15, F.brown + dt * 0.062);
          if (Math.random() < 0.12) steamPuff(sc.parts, App.W / 2 + rnd(-80, 80) * App.S, App.H * 0.24);
        },
        ovenBox() {
          const S = App.S;
          const w = Math.min(App.W * 0.82, 520 * S), h = Math.min(App.H * 0.62, 500 * S);
          return { x: App.W / 2, y: App.H * 0.52, w, h };
        },
        up(p, tap) {
          if (!tap) return;
          const o = this.ovenBox();
          if (Math.abs(p.x - o.x) < o.w * 0.44 && Math.abs(p.y - (o.y + o.h * 0.05)) < o.h * 0.36) {
            Ouch.trigger(p.x, p.y);
          }
        },
        draw(ctx) {
          const S = App.S;
          const w = Math.min(App.W * 0.82, 520 * S), h = Math.min(App.H * 0.62, 500 * S);
          drawHeatMark(ctx, App.W / 2, App.H * 0.52 - h / 2 - 34 * S, S);
          drawMitt(ctx, App.W / 2 + w * 0.32, App.H * 0.52 - h / 2 - 44 * S, S, 0.25);
          drawOven(ctx, App.W / 2, App.H * 0.52, w, h, 0, (cx, cy, ww, wh) => {
            /* oven spring: well-kneaded dough jumps up more in the heat */
            const springK = 1 + F.gluten * 0.38 * clamp(F.brown * 4, 0, 1);
            F.balls.forEach((b, i) => {
              const bx = cx + (i - 1) * ww * 0.28, by = cy;
              const sc2 = (0.8 + F.proof * 0.5) * springK;
              ctx.save();
              ctx.translate(bx, by); ctx.scale(sc2, sc2 * 0.9);
              const irr = 0.03 + 0.14 * (1 - b.round);
              blobPath(ctx, 0, 0, 46 * S, irr, b.seed);
              ctx.fillStyle = bakeColor(clamp(F.brown, 0, 1)); ctx.fill();
              ctx.globalAlpha = 0.35;
              ell(ctx, -14 * S, -16 * S, 13 * S, 8 * S, '#ffffff');
              ctx.globalAlpha = 1;
              ctx.restore();
            });
          });
        },
        done: () => F.brown > 0.2
      };

      /* ================= step 6 : finish ================= */
      let pokes = [];
      const s6 = {
        enter() {
          confettiBurst(sc.parts);
          Snd.tada();
          pokes = F.balls.map(() => ({ x: 0, v: 0 }));
        },
        update(dt) {
          const k = 60 + F.gluten * 200, damp = 3.5 + (1 - F.gluten) * 5;
          for (const pk of pokes) {
            pk.v += (-k * pk.x - damp * pk.v) * dt;
            pk.x += pk.v * dt;
          }
        },
        draw(ctx) {
          const S = App.S, cx = App.W / 2, cy = App.H * 0.55;
          /* basket */
          ell(ctx, cx, cy + 60 * S, App.W * 0.38, 90 * S, '#c98a4e');
          ell(ctx, cx, cy + 50 * S, App.W * 0.36, 80 * S, '#e8b87d');
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(cx, cy + 50 * S, App.W * 0.36, 80 * S, 0, 0, TAU);
          ctx.clip();
          ctx.strokeStyle = 'rgba(140,80,30,0.22)'; ctx.lineWidth = 3 * S;
          for (let i = -3; i <= 3; i++) {
            ctx.beginPath();
            ctx.ellipse(cx + i * App.W * 0.09, cy + 66 * S, App.W * 0.05, 70 * S, 0, 0, TAU);
            ctx.stroke();
          }
          ctx.restore();
          F.balls.forEach((b, i) => {
            const bx = cx + (i - 1) * App.W * 0.2, by = cy + (i === 1 ? -12 : 14) * S;
            const size = 56 * S * (0.9 + F.proof * 0.45 + F.gluten * 0.2);
            const pk = pokes[i];
            const sy = 1 + clamp(pk.x, -0.5, 0.5), sx = 1 - clamp(pk.x, -0.5, 0.5) * 0.7;
            ctx.save();
            ctx.translate(bx, by + size * 0.5);
            ctx.scale(sx, sy);
            ctx.translate(0, -size * 0.5);
            const irr = 0.03 + 0.12 * (1 - b.round);
            blobPath(ctx, 0, 4 * S, size, irr, b.seed);
            ctx.fillStyle = mixc(bakeColor(clamp(F.brown, 0, 1)), '#000', 0.15); ctx.fill();
            blobPath(ctx, 0, 0, size * 0.96, irr, b.seed);
            ctx.fillStyle = bakeColor(clamp(F.brown, 0, 1)); ctx.fill();
            ctx.globalAlpha = 0.5;
            ell(ctx, -size * 0.3, -size * 0.35, size * 0.26, size * 0.16, '#ffffff');
            ctx.globalAlpha = 1;
            ctx.restore();
            if (Math.random() < 0.01) steamPuff(sc.parts, bx, by - size);
          });
          drawEndBtns(ctx);
        },
        down(p) {
          if (handleEndBtns(sc, p)) return;
          const S = App.S, cx = App.W / 2, cy = App.H * 0.55;
          F.balls.forEach((b, i) => {
            const bx = cx + (i - 1) * App.W * 0.2, by = cy + (i === 1 ? -12 : 14) * S;
            if (dist(p.x, p.y, bx, by) < 90 * S) {
              pokes[i].x = -0.28;
              pokes[i].v = 0;
              Snd.knead();
              sparkleBurst(sc.parts, bx, by - 60 * S, '#ffd94f', 4);
            }
          });
        },
        done: () => false
      };

      return [s1, s2, s3, s4, s5, s6];
    }
  };

  DISHES.push(def);
})();
