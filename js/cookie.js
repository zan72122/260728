'use strict';
/* ==========================================================
   サクサククッキー
   固有の変身:
   - バターを指でこすってやわらかくする (形がだんだんくたっと)
   - めんぼうを転がした場所だけ生地がうすくなる「厚さマップ」
     (転がし方で厚いところ・うすいところができる)
   - 型抜きした場所の厚さがクッキーごとに記録される
   - 焼くと、うすいクッキーほど早くこんがり → 同じ天板で焼きムラが出る
   - 食べるとかじり跡が残る (サクサク音+かけら)
   ========================================================== */
(function () {

  const COLS = 7, ROWS = 5;

  const def = {
    id: 'cookie',
    color: '#f2d9c0',
    icon(ctx, r) {
      starPath(ctx, -r * 0.25, -r * 0.2, r * 0.55, 5, 0.55);
      ctx.fillStyle = '#e0a052'; ctx.fill();
      heartPath(ctx, r * 0.35, r * 0.35, r * 0.42);
      ctx.fillStyle = '#c98a3e'; ctx.fill();
      ctx.fillStyle = '#8a5a28';
      circle(ctx, -r * 0.3, -r * 0.25, r * 0.07);
      circle(ctx, -r * 0.1, -r * 0.05, r * 0.07);
      circle(ctx, r * 0.35, r * 0.3, r * 0.06);
    },

    steps(sc) {
      const F = sc.food;
      F.soft = 0; F.sugar = false; F.flour = false;
      F.grid = [];
      for (let r = 0; r < ROWS; r++) { F.grid.push(new Array(COLS).fill(1)); }
      F.cookies = []; F.holes = [];
      F.cutter = 0;

      const doughAt = () => ({
        x: App.W / 2, y: App.H * 0.52,
        rx: Math.min(App.W * 0.36, 210 * App.S) * (1 + F.thinned * 0.25),
        ry: Math.min(App.H * 0.24, 150 * App.S) * (1 + F.thinned * 0.2)
      });
      F.thinned = 0;

      function cellAt(x, y) {
        const d = doughAt();
        const u = (x - d.x) / d.rx, v = (y - d.y) / d.ry;
        if (u * u + v * v > 1) return null;
        const c = clamp(Math.floor((u + 1) / 2 * COLS), 0, COLS - 1);
        const r = clamp(Math.floor((v + 1) / 2 * ROWS), 0, ROWS - 1);
        return { c, r };
      }
      function avgTh() {
        let s = 0, n = 0;
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { s += F.grid[r][c]; n++; }
        return s / n;
      }

      function shapePath(ctx, shape, x, y, r) {
        if (shape === 0) starPath(ctx, x, y, r, 5, 0.55);
        else if (shape === 1) heartPath(ctx, x, y, r);
        else flowerPath(ctx, x, y, r);
      }

      /* ================= step 1 : soften butter ================= */
      let rubX = 0;
      const butterAt = () => ({ x: App.W / 2, y: App.H * 0.55 });
      const itemsAt = () => ({
        sugar: { x: App.W * 0.2, y: App.H * 0.24 },
        flour: { x: App.W * 0.8, y: App.H * 0.24 }
      });
      const s1 = {
        hint: 'rub',
        hintAt() { const b = butterAt(); return { x: b.x, y: b.y }; },
        update(dt) {
          const p = App.pointer, b = butterAt();
          if (p.down && dist(p.x, p.y, b.x, b.y) < 130 * App.S) {
            const dx = Math.abs(p.x - p.px);
            if (dx > 1) {
              F.soft = Math.min(1, F.soft + dx * 0.0012);
              rubX = clamp((p.x - b.x) / (90 * App.S), -1, 1);
              if (Math.random() < 0.08) Snd.knead();
            }
          }
        },
        draw(ctx) {
          const S = App.S, b = butterAt(), it = itemsAt();
          ell(ctx, b.x, b.y + 46 * S, 190 * S, 70 * S, '#fbf0da');
          /* butter block slumps and spreads as it softens */
          const w = lerp(120, 230, F.soft) * S, h = lerp(96, 40, F.soft) * S;
          ctx.save();
          ctx.translate(b.x + rubX * 8 * S, b.y + 20 * S);
          ctx.fillStyle = '#f2ce6b';
          rr(ctx, -w / 2, -h, w, h, lerp(12, 22, F.soft) * S); ctx.fill();
          ctx.fillStyle = '#f9e194';
          rr(ctx, -w / 2, -h, w, h * 0.42, lerp(12, 20, F.soft) * S); ctx.fill();
          ctx.globalAlpha = F.soft * 0.6;
          ell(ctx, -w * 0.2, -h * 0.7, w * 0.2, h * 0.16, '#ffffff');
          ctx.globalAlpha = 1;
          ctx.restore();
          if (F.sugar) {
            ctx.fillStyle = '#fff';
            for (let i = 0; i < 14; i++) {
              circle(ctx, b.x + (n1(i * 3) - 0.5) * 180 * S, b.y + 10 * S + (n1(i * 7) - 0.5) * 60 * S, 2.5 * S);
            }
          }
          if (!F.sugar) {
            ctx.fillStyle = '#fdfdfd';
            rr(ctx, it.sugar.x - 30 * S, it.sugar.y - 38 * S, 60 * S, 76 * S, 12 * S); ctx.fill();
            ctx.fillStyle = '#d8e4f2';
            rr(ctx, it.sugar.x - 30 * S, it.sugar.y - 38 * S, 60 * S, 20 * S, 10 * S); ctx.fill();
            ctx.fillStyle = '#eee';
            for (let i = 0; i < 5; i++) circle(ctx, it.sugar.x + (n1(i) - 0.5) * 34 * S, it.sugar.y + 12 * S, 3 * S);
          }
          if (!F.flour) {
            ctx.fillStyle = '#f7ead2';
            rr(ctx, it.flour.x - 34 * S, it.flour.y - 42 * S, 68 * S, 84 * S, 12 * S); ctx.fill();
            ctx.fillStyle = '#e8d5ac';
            rr(ctx, it.flour.x - 34 * S, it.flour.y - 42 * S, 68 * S, 22 * S, 10 * S); ctx.fill();
            ell(ctx, it.flour.x, it.flour.y + 8 * S, 20 * S, 15 * S, '#fff');
          }
        },
        down(p) {
          const S = App.S, it = itemsAt(), b = butterAt();
          if (!F.sugar && dist(p.x, p.y, it.sugar.x, it.sugar.y) < 66 * S) {
            F.sugar = true; Snd.chime();
            sparkleBurst(sc.parts, b.x, b.y - 20 * S, '#ffffff', 12);
            return;
          }
          if (!F.flour && dist(p.x, p.y, it.flour.x, it.flour.y) < 66 * S) {
            F.flour = true; Snd.plop();
            for (let i = 0; i < 12; i++) {
              sc.parts.add({ x: b.x + rnd(-90, 90) * S, y: b.y - rnd(0, 40) * S, color: '#fff', r: rnd(5, 10) * S, vy: -rnd(20, 50) * S, life: 0.6, kind: 'steam', grow: 8 * S });
            }
          }
        },
        done: () => F.soft > 0.5 && F.sugar && F.flour
      };

      /* ================= step 2 : roll — local thickness map ================= */
      let pinY = 0, rolling = false;
      const s2 = {
        hint: 'rub',
        hintAt() { const d = doughAt(); return { x: d.x, y: d.y }; },
        update(dt) {
          const p = App.pointer, d = doughAt(), S = App.S;
          if (p.down && rolling) {
            pinY = clamp(p.y, d.y - d.ry, d.y + d.ry);
            const dx = Math.abs(p.x - p.px);
            if (dx > 1) {
              /* thin only the rows the pin is rolling over */
              const v = (pinY - d.y) / d.ry;
              const row = clamp(Math.floor((v + 1) / 2 * ROWS), 0, ROWS - 1);
              for (let r2 = Math.max(0, row - 1); r2 <= Math.min(ROWS - 1, row + 1); r2++) {
                const fall = r2 === row ? 1 : 0.35;
                for (let c = 0; c < COLS; c++) {
                  const old = F.grid[r2][c];
                  F.grid[r2][c] = Math.max(0.22, old - dx * 0.00045 * fall);
                  F.thinned += (old - F.grid[r2][c]) * 0.01;
                }
              }
              if (Math.random() < 0.1) { Snd.tick(); }
              if (Math.random() < 0.06) {
                sc.parts.add({ x: p.x + rnd(-60, 60) * S, y: pinY + rnd(-10, 10) * S, color: '#fff', r: rnd(3, 6) * S, vy: -rnd(10, 40) * S, life: 0.5, kind: 'steam', grow: 5 * S });
              }
            }
          }
        },
        draw(ctx) {
          const S = App.S, d = doughAt();
          ell(ctx, d.x, d.y + 14 * S, d.rx * 1.12, d.ry * 1.12, '#fbf0da');
          /* dough slab: side wall height follows the remaining thickness */
          const hSide = (3 + avgTh() * 15) * S;
          for (let i = 3; i >= 1; i--) {
            ell(ctx, d.x, d.y + hSide * i / 3, d.rx, d.ry, mixc('#d9b57a', '#9c7038', i / 3 * 0.6));
          }
          ell(ctx, d.x, d.y, d.rx, d.ry, '#eccf95');
          ctx.save();
          ctx.beginPath(); ctx.ellipse(d.x, d.y, d.rx, d.ry, 0, 0, TAU); ctx.clip();
          for (let r2 = 0; r2 < ROWS; r2++) {
            for (let c = 0; c < COLS; c++) {
              const th = F.grid[r2][c];
              const cx = d.x + ((c + 0.5) / COLS * 2 - 1) * d.rx;
              const cy = d.y + ((r2 + 0.5) / ROWS * 2 - 1) * d.ry;
              /* thick spots look puffy & lighter on top */
              ctx.globalAlpha = (th - 0.22) * 0.55;
              ell(ctx, cx, cy - th * 6 * S, d.rx / COLS * 1.1, d.ry / ROWS * 1.05, '#f7e3b5');
              ctx.globalAlpha = (th - 0.22) * 0.3;
              ell(ctx, cx, cy + th * 8 * S, d.rx / COLS * 1.05, d.ry / ROWS * 0.5, '#c69a58');
            }
          }
          ctx.globalAlpha = 1;
          ctx.restore();
          /* side profile — honest picture of the thickness across the middle */
          const py = App.H * 0.87, pw = Math.min(App.W * 0.6, 380 * S);
          ctx.fillStyle = '#fff';
          rr(ctx, App.W / 2 - pw / 2 - 14 * S, py - 44 * S, pw + 28 * S, 66 * S, 14 * S); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(App.W / 2 - pw / 2, py);
          const midRow = Math.floor(ROWS / 2);
          for (let c = 0; c < COLS; c++) {
            const th = (F.grid[midRow][c] + F.grid[clamp(midRow - 1, 0, ROWS - 1)][c]) / 2;
            ctx.lineTo(App.W / 2 - pw / 2 + (c + 0.5) / COLS * pw, py - th * 36 * S);
          }
          ctx.lineTo(App.W / 2 + pw / 2, py);
          ctx.closePath();
          ctx.fillStyle = '#eccf95'; ctx.fill();
          /* rolling pin */
          const p = App.pointer;
          if (p.down && rolling) drawRollingPin(ctx, p.x, pinY, S);
          else drawRollingPin(ctx, d.x, d.y - d.ry - 50 * S, S * 0.9);
        },
        down(p) { rolling = true; pinY = p.y; },
        up() { rolling = false; },
        done: () => avgTh() < 0.8
      };

      /* ================= step 3 : cut shapes ================= */
      const cutterBtn = i => ({ x: App.W * (0.28 + i * 0.22), y: App.H * 0.16, r: 46 * App.S });
      const s3 = {
        hint: 'tap',
        hintAt() { const d = doughAt(); return { x: d.x, y: d.y }; },
        draw(ctx) {
          const S = App.S, d = doughAt();
          ell(ctx, d.x, d.y + 14 * S, d.rx * 1.12, d.ry * 1.12, '#fbf0da');
          const hSide = (3 + avgTh() * 15) * S;
          for (let i = 3; i >= 1; i--) {
            ell(ctx, d.x, d.y + hSide * i / 3, d.rx, d.ry, mixc('#d9b57a', '#9c7038', i / 3 * 0.6));
          }
          ell(ctx, d.x, d.y, d.rx, d.ry, '#eccf95');
          /* punched holes */
          ctx.fillStyle = '#fbf0da';
          for (const h of F.holes) shapePath(ctx, h.shape, h.x, h.y, h.r), ctx.fill();
          /* cut cookies stay in place, slightly raised */
          for (const c of F.cookies) {
            shapePath(ctx, c.shape, c.x, c.y + 4 * S, c.r);
            ctx.fillStyle = '#cfa768'; ctx.fill();
            shapePath(ctx, c.shape, c.x, c.y, c.r);
            ctx.fillStyle = '#f2d9a0'; ctx.fill();
          }
          /* cutter buttons */
          for (let i = 0; i < 3; i++) {
            const b = cutterBtn(i);
            circle(ctx, b.x, b.y, b.r, F.cutter === i ? '#ffd0e0' : '#ffffff');
            if (F.cutter === i) {
              ctx.strokeStyle = '#ff8fb2'; ctx.lineWidth = 5 * S;
              ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.stroke();
            }
            shapePath(ctx, i, b.x, b.y, b.r * 0.55);
            ctx.strokeStyle = '#c9a2e8'; ctx.lineWidth = 5 * S; ctx.stroke();
          }
        },
        down(p) {
          const S = App.S, d = doughAt();
          for (let i = 0; i < 3; i++) {
            if (hitCircle(p, cutterBtn(i))) { F.cutter = i; Snd.pop(); return; }
          }
          const cell = cellAt(p.x, p.y);
          if (cell && F.cookies.length < 8) {
            /* no overlapping cuts */
            const cr = 52 * S;
            for (const h of F.holes) { if (dist(p.x, p.y, h.x, h.y) < cr * 1.5) return; }
            const th = F.grid[cell.r][cell.c];
            F.holes.push({ x: p.x, y: p.y, r: cr, shape: F.cutter });
            F.cookies.push({ x: p.x, y: p.y, r: cr * 0.92, shape: F.cutter, th, brown: 0, bites: [] });
            Snd.crunch();
            sparkleBurst(sc.parts, p.x, p.y, '#fff', 5);
          }
        },
        done: () => F.cookies.length >= 2
      };

      /* ================= step 4 : bake — thin browns fast ================= */
      let trayPos = [];
      const s4 = {
        hint: 'hold',
        hintAt() { return { x: App.W / 2, y: App.H * 0.8 }; },
        enter() {
          Snd.setSizzle(0.2);
          trayPos = F.cookies.map((c, i) => ({
            x: (i % 3 - 1) * 0.26,
            y: (Math.floor(i / 3) - (F.cookies.length > 3 ? 0.5 : 0)) * 0.3
          }));
        },
        update(dt) {
          for (const c of F.cookies) {
            /* thinner cookie = faster browning: the same tray bakes unevenly */
            c.brown = Math.min(1.1, c.brown + dt * 0.09 / (0.25 + c.th));
            if (c.brown > 0.5 && !c.crisp) { c.crisp = true; Snd.tick(); }
          }
          if (Math.random() < 0.1) steamPuff(sc.parts, App.W / 2 + rnd(-100, 100) * App.S, App.H * 0.22);
        },
        up(p, tap) {
          if (!tap) return;
          const S = App.S;
          const w = Math.min(App.W * 0.84, 540 * S), h = Math.min(App.H * 0.64, 500 * S);
          if (Math.abs(p.x - App.W / 2) < w * 0.44 && Math.abs(p.y - App.H * 0.55) < h * 0.36) {
            Ouch.trigger(p.x, p.y);
          }
        },
        draw(ctx) {
          const S = App.S;
          const w = Math.min(App.W * 0.84, 540 * S), h = Math.min(App.H * 0.64, 500 * S);
          drawHeatMark(ctx, App.W / 2, App.H * 0.52 - h / 2 - 34 * S, S);
          drawMitt(ctx, App.W / 2 + w * 0.32, App.H * 0.52 - h / 2 - 44 * S, S, 0.25);
          drawOven(ctx, App.W / 2, App.H * 0.52, w, h, 0, (cx, cy, ww, wh) => {
            /* tray */
            ctx.fillStyle = '#8a8a94';
            rr(ctx, cx - ww * 0.42, cy - wh * 0.06, ww * 0.84, wh * 0.16, 8 * S); ctx.fill();
            F.cookies.forEach((c, i) => {
              const tp = trayPos[i] || { x: 0, y: 0 };
              const px = cx + tp.x * ww, py = cy - wh * 0.02 + tp.y * wh * 0.3;
              const rr2 = c.r * 0.75;
              shapePath(ctx, c.shape, px, py, rr2);
              const g = ctx.createRadialGradient(px, py, rr2 * 0.2, px, py, rr2);
              g.addColorStop(0, bakeColor(clamp(c.brown * 0.8, 0, 1)));
              g.addColorStop(1, bakeColor(clamp(c.brown * 1.15, 0, 1)));
              ctx.fillStyle = g; ctx.fill();
            });
          });
        },
        done: () => F.cookies.some(c => c.brown > 0.3)
      };

      /* ================= step 5 : eat! (final) ================= */
      let platePos = [];
      const s5 = {
        hint: 'tap',
        hintAt() { return { x: App.W / 2, y: App.H * 0.5 }; },
        enter() {
          confettiBurst(sc.parts);
          Snd.tada();
          platePos = F.cookies.map((c, i) => ({
            x: App.W / 2 + (i % 3 - 1) * App.W * 0.22,
            y: App.H * 0.48 + (Math.floor(i / 3) - (F.cookies.length > 3 ? 0.5 : 0)) * App.H * 0.2
          }));
        },
        draw(ctx) {
          const S = App.S;
          drawPlate(ctx, App.W / 2, App.H * 0.55, Math.min(App.W * 0.46, 290 * S));
          F.cookies.forEach((c, i) => {
            if (c.eaten) return;
            const pp = platePos[i];
            ctx.save();
            /* extruded side wall: the thickness each cookie kept is visible */
            const hC = (2 + c.th * 11) * S;
            softShadow(ctx, pp.x, pp.y + hC + 8 * S, c.r * 1.05, c.r * 0.4, 0.2);
            const bcSide = bakeColor(clamp(c.brown * 1.1, 0, 1));
            for (let k = 3; k >= 1; k--) {
              shapePath(ctx, c.shape, pp.x, pp.y + hC * k / 3, c.r);
              ctx.fillStyle = mixc(bcSide, '#3a1c08', 0.15 + 0.2 * k / 3);
              ctx.fill();
            }
            /* cookie top */
            shapePath(ctx, c.shape, pp.x, pp.y, c.r);
            const g = ctx.createRadialGradient(pp.x, pp.y, c.r * 0.2, pp.x, pp.y, c.r);
            g.addColorStop(0, bakeColor(clamp(c.brown * 0.8, 0, 1)));
            g.addColorStop(1, bakeColor(clamp(c.brown * 1.15, 0, 1)));
            ctx.fillStyle = g;
            ctx.fill();
            /* bite marks: erase inside the cookie only */
            if (c.bites.length) {
              shapePath(ctx, c.shape, pp.x, pp.y, c.r);
              ctx.clip();
              ctx.fillStyle = '#f2f0ec';
              for (const b of c.bites) circle(ctx, pp.x + b.dx, pp.y + b.dy, b.r);
            }
            ctx.restore();
          });
          drawEndBtns(ctx);
        },
        down(p) {
          if (handleEndBtns(sc, p)) return;
          const S = App.S;
          F.cookies.forEach((c, i) => {
            if (c.eaten) return;
            const pp = platePos[i];
            if (dist(p.x, p.y, pp.x, pp.y) < c.r * 1.2) {
              const a = Math.atan2(p.y - pp.y, p.x - pp.x);
              c.bites.push({ dx: Math.cos(a) * c.r * 0.8, dy: Math.sin(a) * c.r * 0.8, r: c.r * rnd(0.4, 0.55) });
              Snd.crunch();
              for (let k = 0; k < 6; k++) {
                sc.parts.add({
                  x: p.x, y: p.y, color: bakeColor(clamp(c.brown, 0, 1)), r: rnd(3, 6) * S,
                  vx: rnd(-120, 120) * S, vy: -rnd(60, 200) * S, g: 700 * S, life: 0.7
                });
              }
              if (c.bites.length >= 3) {
                c.eaten = true;
                sparkleBurst(sc.parts, pp.x, pp.y, '#ffd94f', 10);
                Snd.chime();
              }
            }
          });
        },
        done: () => false
      };

      return [s1, s2, s3, s4, s5];
    }
  };

  DISHES.push(def);
})();
