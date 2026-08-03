'use strict';
/* ==========================================================
   ごろごろいちごスムージー
   固有の変身:
   - たたいてつぶす: たたくたびに果肉が半分に割れて小さくなる
     少しだけ=ごろごろ、いっぱい=なめらか。粒の大きさは最後まで残る
   - 牛乳の量 → 色の薄さと量が変わる
   - 混ぜる: 白と赤のマーブルもようが、ぐるぐるするほど混ざっていく
     (混ぜている間は果肉もぐるぐる回る)
   - 氷を入れると コップに水滴と霜がつく
   - ストローをタップすると ごくごく飲める (減っていく)
   ========================================================== */
(function () {

  const def = {
    id: 'smoothie',
    color: '#ffd0e0',
    icon(ctx, r) {
      ctx.fillStyle = '#f28aa8';
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r * 0.5);
      ctx.lineTo(-r * 0.4, r * 0.7);
      ctx.lineTo(r * 0.4, r * 0.7);
      ctx.lineTo(r * 0.55, -r * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(200,215,230,0.9)'; ctx.lineWidth = r * 0.09;
      ctx.stroke();
      ctx.fillStyle = '#e8465c';
      circle(ctx, -r * 0.15, r * 0.2, r * 0.14);
      circle(ctx, r * 0.18, -r * 0.05, r * 0.11);
      ctx.strokeStyle = '#f2d98a'; ctx.lineWidth = r * 0.14; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(r * 0.1, -r * 0.45); ctx.lineTo(r * 0.45, -r * 0.95);
      ctx.stroke();
    },

    steps(sc) {
      const F = sc.food;
      F.chunks = []; F.juice = 0; F.milk = 0; F.swirl = 0;
      F.ice = []; F.drunk = 0;

      const glassAt = () => ({
        x: App.W / 2, y: App.H * 0.5,
        w: Math.min(App.W * 0.4, 230 * App.S), h: Math.min(App.H * 0.44, 350 * App.S)
      });
      const level = () => clamp(0.2 + F.juice * 0.2 + F.milk * 0.5 - F.drunk, 0.05, 0.95);
      const liqColor = () => {
        const ban = F.chunks.length ? F.chunks.filter(c => c.kind === 1).length / F.chunks.length : 0;
        return mixc(mixc('#e8465c', '#f2cd6b', ban * 0.7), '#fdfdf6', clamp(F.milk * 0.75, 0, 0.85));
      };

      function drawChunk(ctx, c) {
        const S = App.S;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.seed);
        if (c.kind === 0) {
          blobPath(ctx, 0, c.r * 0.18, c.r, 0.2, c.seed * 5);
          ctx.fillStyle = '#b82c42'; ctx.fill();
          blobPath(ctx, 0, 0, c.r, 0.2, c.seed * 5);
          ctx.fillStyle = '#e8465c'; ctx.fill();
          ctx.fillStyle = '#ffdfe6';
          for (let i = 0; i < 3; i++) circle(ctx, (n1(i + c.seed) - 0.5) * c.r, (n1(i * 3 + c.seed) - 0.5) * c.r, Math.min(1.6 * S, c.r * 0.2));
          ell(ctx, -c.r * 0.3, -c.r * 0.35, c.r * 0.22, c.r * 0.14, 'rgba(255,255,255,0.5)');
        } else {
          ell(ctx, 0, c.r * 0.15, c.r, c.r * 0.8, '#d9bc6a');
          ell(ctx, 0, 0, c.r, c.r * 0.8, '#f7e6a8');
          ell(ctx, 0, 0, c.r * 0.55, c.r * 0.42, '#f2d98a');
          ell(ctx, -c.r * 0.3, -c.r * 0.3, c.r * 0.2, c.r * 0.12, 'rgba(255,255,255,0.55)');
        }
        ctx.restore();
      }

      function drawGlass(ctx, opts = {}) {
        const S = App.S, g = glassAt();
        const lv = level();
        const topY = g.y + g.h / 2 - lv * g.h;
        softShadow(ctx, g.x, g.y + g.h / 2 + 6 * S, g.w * 0.62, 13 * S, 0.22);
        /* liquid */
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(g.x - g.w * 0.42, g.y - g.h / 2);
        ctx.lineTo(g.x - g.w * 0.5, g.y + g.h / 2);
        ctx.lineTo(g.x + g.w * 0.5, g.y + g.h / 2);
        ctx.lineTo(g.x + g.w * 0.42, g.y - g.h / 2);
        ctx.closePath();
        ctx.clip();
        if (lv > 0.06) {
          const lc = liqColor();
          const lg = ctx.createLinearGradient(0, topY, 0, g.y + g.h / 2);
          lg.addColorStop(0, lc);
          lg.addColorStop(1, mixc(lc, '#5a2030', 0.22));
          ctx.fillStyle = lg;
          ctx.fillRect(g.x - g.w * 0.5, topY, g.w, g.h);
          /* liquid surface: dark back edge + bright front */
          ell(ctx, g.x, topY, g.w * 0.46, 8 * S, mixc(lc, '#5a2030', 0.3));
          ell(ctx, g.x, topY + 2.5 * S, g.w * 0.44, 6 * S, mixc(lc, '#ffffff', 0.3));
          /* marble streaks until fully swirled */
          if (F.milk > 0.05 && F.swirl < 0.95) {
            ctx.globalAlpha = (1 - F.swirl) * 0.8;
            ctx.lineWidth = 12 * S; ctx.lineCap = 'round';
            for (let i = 0; i < 5; i++) {
              ctx.strokeStyle = i % 2 ? 'rgba(253,253,246,0.9)' : 'rgba(232,70,92,0.55)';
              ctx.beginPath();
              const yy = topY + (i + 1) / 6 * (g.y + g.h / 2 - topY);
              const ph = (opts.stirPhase || 0) + i * 1.3;
              ctx.moveTo(g.x - g.w * 0.4, yy);
              ctx.bezierCurveTo(
                g.x - g.w * 0.15, yy + Math.sin(ph) * 22 * S,
                g.x + g.w * 0.15, yy - Math.sin(ph) * 22 * S,
                g.x + g.w * 0.4, yy);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }
          /* fruit chunks — the size you left them */
          for (const c of F.chunks) { keepInGlass(c); drawChunk(ctx, c); }
          /* ice cubes bobbing */
          for (const ice of F.ice) {
            const iy = topY + 14 * S + Math.sin(App.time * 2 + ice.ph) * 4 * S;
            ctx.save();
            ctx.translate(ice.x, iy); ctx.rotate(ice.rot);
            ctx.fillStyle = 'rgba(220,240,255,0.85)';
            rr(ctx, -16 * S, -16 * S, 32 * S, 32 * S, 8 * S); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            rr(ctx, -10 * S, -12 * S, 10 * S, 8 * S, 4 * S); ctx.fill();
            ctx.restore();
          }
        }
        ctx.restore();
        /* glass outline + shine */
        ctx.strokeStyle = 'rgba(170,190,210,0.9)'; ctx.lineWidth = 5 * S;
        ctx.beginPath();
        ctx.moveTo(g.x - g.w * 0.42, g.y - g.h / 2);
        ctx.lineTo(g.x - g.w * 0.5, g.y + g.h / 2);
        ctx.lineTo(g.x + g.w * 0.5, g.y + g.h / 2);
        ctx.lineTo(g.x + g.w * 0.42, g.y - g.h / 2);
        ctx.closePath(); ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 9 * S;
        ctx.beginPath();
        ctx.moveTo(g.x - g.w * 0.32, g.y - g.h * 0.4);
        ctx.lineTo(g.x - g.w * 0.38, g.y + g.h * 0.4);
        ctx.stroke();
        ctx.globalAlpha = 1;
        /* open rim ellipse */
        ctx.strokeStyle = 'rgba(185,205,222,0.9)';
        ctx.lineWidth = 3 * S;
        ctx.beginPath();
        ctx.ellipse(g.x, g.y - g.h / 2, g.w * 0.42, 8 * S, 0, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = 'rgba(160,185,205,0.13)';
        ctx.beginPath();
        ctx.ellipse(g.x, g.y - g.h / 2, g.w * 0.42, 8 * S, 0, 0, TAU);
        ctx.fill();
        /* condensation after ice */
        if (F.ice.length > 0) {
          ctx.fillStyle = 'rgba(200,230,250,0.8)';
          for (let i = 0; i < 10 + F.ice.length * 4; i++) {
            const dx = (n1(i * 3) - 0.5) * g.w * 0.9;
            const dy = (n1(i * 7 + 2) - 0.2) * g.h * 0.6;
            ell(ctx, g.x + dx, g.y + dy, 2.2 * App.S, 3.2 * App.S);
          }
        }
      }
      function keepInGlass(c) {
        const g = glassAt(), S = App.S;
        const lv = level();
        const topY = g.y + g.h / 2 - lv * g.h;
        c.x = clamp(c.x, g.x - g.w * 0.42 + c.r, g.x + g.w * 0.42 - c.r);
        c.y = clamp(c.y, topY + c.r + 6 * S, g.y + g.h / 2 - c.r - 6 * S);
      }

      /* ================= step 1 : fruits in ================= */
      const fruitBtn = i => ({ x: App.W * (0.25 + i * 0.5), y: App.H * 0.18, r: 56 * App.S });
      const s1 = {
        hint: 'tap',
        hintAt() { return fruitBtn(F.chunks.filter(c => c.kind === 0).length < 3 ? 0 : 1); },
        draw(ctx) {
          const S = App.S;
          drawGlass(ctx);
          for (let i = 0; i < 2; i++) {
            const b = fruitBtn(i);
            circle(ctx, b.x, b.y, b.r, '#ffffff');
            if (i === 0) drawStrawberry(ctx, b.x, b.y, S * 1.2);
            else {
              ctx.strokeStyle = '#f2d98a'; ctx.lineWidth = 22 * S; ctx.lineCap = 'round';
              ctx.beginPath();
              ctx.arc(b.x, b.y - 8 * S, 26 * S, 0.4, Math.PI - 0.4);
              ctx.stroke();
              ctx.strokeStyle = '#e8c26b'; ctx.lineWidth = 6 * S;
              ctx.beginPath();
              ctx.arc(b.x, b.y - 8 * S, 34 * S, 0.6, Math.PI - 0.6);
              ctx.stroke();
            }
          }
        },
        down(p) {
          const S = App.S, g = glassAt();
          for (let i = 0; i < 2; i++) {
            if (hitCircle(p, fruitBtn(i)) && F.chunks.length < 8) {
              const c = {
                x: g.x + rnd(-0.3, 0.3) * g.w, y: g.y + rnd(-0.1, 0.35) * g.h,
                r: rnd(22, 28) * S, kind: i, seed: rnd(TAU)
              };
              keepInGlass(c);
              F.chunks.push(c);
              Snd.plop();
              sparkleBurst(sc.parts, c.x, c.y, i === 0 ? '#ff9db2' : '#f7e6a8', 4);
              return;
            }
          }
        },
        done: () => F.chunks.length >= 4
      };

      /* ================= step 2 : crush! ================= */
      let mashY = 0, mashV = 0;
      const s2 = {
        hint: 'tap',
        hintAt() { const g = glassAt(); return { x: g.x, y: g.y }; },
        update(dt) {
          mashV += (-140 * mashY - 10 * mashV) * dt;
          mashY += mashV * dt;
        },
        draw(ctx) {
          const S = App.S;
          drawGlass(ctx);
          const p = App.pointer;
          const g = glassAt();
          const mx = p.down ? p.x : g.x + g.w * 0.85;
          const my = (p.down ? p.y : g.y - g.h * 0.2) + mashY * S;
          drawMasher(ctx, mx, my, S);
        },
        down(p) {
          const S = App.S, g = glassAt();
          if (Math.abs(p.x - g.x) < g.w * 0.7 && Math.abs(p.y - g.y) < g.h * 0.7) {
            mashY = 26; mashV = 0;
            let hit = false;
            const next = [];
            for (const c of F.chunks) {
              if (dist(p.x, p.y, c.x, c.y) < 80 * S && c.r > 8 * S && F.chunks.length + next.length < 26) {
                /* split into two smaller pieces — granularity is up to the child */
                hit = true;
                for (let k = 0; k < 2; k++) {
                  const nc = {
                    x: c.x + rnd(-18, 18) * S, y: c.y + rnd(-14, 14) * S,
                    r: c.r * rnd(0.62, 0.72), kind: c.kind, seed: rnd(TAU)
                  };
                  keepInGlass(nc);
                  next.push(nc);
                }
                F.juice = Math.min(1, F.juice + 0.07);
                for (let k = 0; k < 5; k++) {
                  sc.parts.add({
                    x: c.x, y: c.y, color: c.kind === 0 ? '#e8465c' : '#f2d98a',
                    r: rnd(3, 6) * S, vx: rnd(-160, 160) * S, vy: -rnd(60, 220) * S,
                    g: 800 * S, life: 0.6
                  });
                }
              } else next.push(c);
            }
            F.chunks = next;
            if (hit) Snd.splash(); else Snd.knead();
          }
        },
        done: () => F.juice > 0.12
      };

      /* ================= step 3 : milk & swirl ================= */
      const stir = new Stir();
      let prevRevs = 0, pouringMilk = false, stirPhase = 0;
      const milkBtn = () => ({ x: App.W * 0.82, y: App.H * 0.28, r: 60 * App.S });
      const s3 = {
        hint: 'hold',
        hintAt() {
          if (F.milk < 0.3) return milkBtn();
          const g = glassAt(); return { x: g.x, y: g.y };
        },
        update(dt) {
          const g = glassAt();
          if (pouringMilk && App.pointer.down) {
            F.milk = Math.min(1, F.milk + dt * 0.38);
            if (Math.random() < 0.2) Snd.tick();
          } else pouringMilk = false;
          if (F.milk > 0.15 && !pouringMilk) {
            const sp = stir.feed(App.pointer, g.x, g.y, g.w, dt);
            const dR = stir.revs - prevRevs; prevRevs = stir.revs;
            if (dR > 0) {
              F.swirl = Math.min(1, F.swirl + dR * 0.15);
              stirPhase += dR * 8;
              /* chunks ride the whirlpool */
              for (const c of F.chunks) {
                const a = Math.atan2(c.y - g.y, c.x - g.x) + dR * 5;
                const rd = dist(c.x, c.y, g.x, g.y);
                c.x = g.x + Math.cos(a) * rd;
                c.y = g.y + Math.sin(a) * rd;
                keepInGlass(c);
              }
              if (Math.random() < dR * 3) Snd.tick();
            }
          }
        },
        draw(ctx) {
          const S = App.S;
          drawGlass(ctx, { stirPhase });
          const b = milkBtn(), g = glassAt();
          if (pouringMilk && App.pointer.down) {
            /* milk carton pouring */
            ctx.save();
            ctx.translate(g.x + g.w * 0.5, g.y - g.h * 0.62);
            ctx.rotate(0.8);
            ctx.fillStyle = '#fdfdfd';
            rr(ctx, -30 * S, -45 * S, 60 * S, 90 * S, 8 * S); ctx.fill();
            ctx.fillStyle = '#8ecbe8';
            rr(ctx, -30 * S, -45 * S, 60 * S, 26 * S, 8 * S); ctx.fill();
            ctx.restore();
            drawStream(ctx, g.x + g.w * 0.32, g.y - g.h * 0.52, g.x, g.y - g.h * 0.2, 11 * S, '#fdfdf6');
          } else {
            circle(ctx, b.x, b.y, b.r, '#ffffff');
            ctx.fillStyle = '#fdfdfd';
            rr(ctx, b.x - 22 * S, b.y - 34 * S, 44 * S, 68 * S, 6 * S); ctx.fill();
            ctx.fillStyle = '#8ecbe8';
            rr(ctx, b.x - 22 * S, b.y - 34 * S, 44 * S, 20 * S, 6 * S); ctx.fill();
            ctx.strokeStyle = '#c8d8e8'; ctx.lineWidth = 3 * S;
            rr(ctx, b.x - 22 * S, b.y - 34 * S, 44 * S, 68 * S, 6 * S); ctx.stroke();
          }
          if (F.milk > 0.15 && App.pointer.down && !pouringMilk) {
            drawSpoon(ctx, App.pointer.x, App.pointer.y, S, 0.2);
          }
        },
        down(p) {
          if (hitCircle(p, milkBtn())) { pouringMilk = true; Snd.tick(); }
        },
        up() { pouringMilk = false; },
        done: () => F.milk > 0.3 && F.swirl > 0.5
      };

      /* ================= step 4 : ice, straw, drink! (final) ================= */
      let strawT = 0;
      const iceBtn = () => ({ x: App.W * 0.18, y: App.H * 0.28, r: 58 * App.S });
      const strawTop = () => {
        const g = glassAt();
        return { x: g.x + g.w * 0.28, y: g.y - g.h * 0.72 };
      };
      const s4 = {
        hint: 'tap',
        hintAt() { return F.ice.length === 0 ? iceBtn() : strawTop(); },
        enter() { confettiBurst(sc.parts); Snd.tada(); },
        update(dt) { strawT = Math.min(1, strawT + dt * 1.5); },
        draw(ctx) {
          const S = App.S, g = glassAt();
          drawGlass(ctx);
          /* straw slides in */
          const st = strawTop();
          const drop = (1 - strawT) * -160 * S;
          ctx.save();
          ctx.translate(st.x, st.y + drop);
          ctx.rotate(0.12);
          ctx.fillStyle = '#ff8fb2';
          rr(ctx, -9 * S, 0, 18 * S, g.h * 0.9, 9 * S); ctx.fill();
          rr(ctx, -9 * S, -30 * S, 18 * S, 40 * S, 9 * S);
          ctx.save(); ctx.rotate(-0.5); ctx.fill(); ctx.restore();
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          rr(ctx, -9 * S, 0, 7 * S, g.h * 0.9, 4 * S); ctx.fill();
          ctx.restore();
          /* ice tray button */
          const b = iceBtn();
          circle(ctx, b.x, b.y, b.r, '#ffffff');
          ctx.fillStyle = '#d8ecfa';
          rr(ctx, b.x - 30 * S, b.y - 20 * S, 60 * S, 40 * S, 8 * S); ctx.fill();
          ctx.strokeStyle = '#a8cce8'; ctx.lineWidth = 3 * S;
          for (let i = -1; i <= 1; i += 2) {
            ctx.beginPath(); ctx.moveTo(b.x + i * 10 * S, b.y - 20 * S); ctx.lineTo(b.x + i * 10 * S, b.y + 20 * S); ctx.stroke();
          }
          drawEndBtns(ctx);
        },
        down(p) {
          if (handleEndBtns(sc, p)) return;
          const S = App.S, g = glassAt();
          const b = iceBtn();
          if (hitCircle(p, b) && F.ice.length < 4) {
            F.ice.push({ x: g.x + rnd(-0.25, 0.25) * g.w, ph: rnd(TAU), rot: rnd(-0.4, 0.4) });
            Snd.splash();
            const lv = level();
            const topY = g.y + g.h / 2 - lv * g.h;
            for (let k = 0; k < 8; k++) {
              sc.parts.add({
                x: g.x + rnd(-0.3, 0.3) * g.w, y: topY,
                color: liqColor(), r: rnd(3, 7) * S,
                vx: rnd(-140, 140) * S, vy: -rnd(100, 280) * S, g: 900 * S, life: 0.7
              });
            }
            return;
          }
          const st = strawTop();
          if ((dist(p.x, p.y, st.x, st.y + 30 * S) < 90 * S || dist(p.x, p.y, g.x, g.y) < g.w * 0.6) && level() > 0.12) {
            F.drunk = Math.min(0.8, F.drunk + 0.09);
            Snd.gulp();
            /* bubbles rise in the straw */
            for (let k = 0; k < 5; k++) {
              sc.parts.add({
                x: st.x + rnd(-4, 4) * S, y: st.y + rnd(60, 200) * S,
                color: 'rgba(255,255,255,0.8)', r: rnd(2.5, 5) * S,
                vy: -rnd(80, 160) * S, life: 0.6
              });
            }
            if (level() <= 0.12) { sparkleBurst(sc.parts, g.x, g.y, '#ffd94f', 14); Snd.chime(); }
          }
        },
        done: () => false
      };

      return [s1, s2, s3, s4];
    }
  };

  DISHES.push(def);
})();
