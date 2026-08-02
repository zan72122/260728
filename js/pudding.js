'use strict';
/* ==========================================================
   ぷるぷるプリン
   固有の変身:
   - おさとうを熱してカラメルに: 白→金→こげ茶へ連続変化、
     どの色でやめるかは自分しだい。その色が最後まで残る
   - 混ぜすぎると泡が入り、プリンの表面に「す」(小さな穴)が残る
   - 蒸した時間 → 固まり具合 → ぷるぷるの揺れかたが変わる
   - 冷やすと水滴と霜、つやが出る
   - ひっくり返して「ぷるんっ」 つつくと ぷるぷる物理で揺れる
   ========================================================== */
(function () {

  const def = {
    id: 'pudding',
    color: '#fbe0b8',
    icon(ctx, r) {
      ctx.fillStyle = '#f2c035';
      ctx.beginPath();
      ctx.moveTo(-r * 0.75, r * 0.55);
      ctx.lineTo(-r * 0.5, -r * 0.35);
      ctx.quadraticCurveTo(0, -r * 0.55, r * 0.5, -r * 0.35);
      ctx.lineTo(r * 0.75, r * 0.55);
      ctx.quadraticCurveTo(0, r * 0.75, -r * 0.75, r * 0.55);
      ctx.fill();
      ctx.fillStyle = '#8a4a14';
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.33);
      ctx.quadraticCurveTo(0, -r * 0.55, r * 0.5, -r * 0.33);
      ctx.quadraticCurveTo(r * 0.3, -r * 0.1, r * 0.1, -r * 0.15);
      ctx.quadraticCurveTo(-r * 0.2, -r * 0.05, -r * 0.5, -r * 0.33);
      ctx.fill();
      ell(ctx, -r * 0.3, r * 0.1, r * 0.14, r * 0.1, 'rgba(255,255,255,0.5)');
    },

    steps(sc) {
      const F = sc.food;
      F.melt = 0; F.caramel = 0;
      F.egg = 0; F.milkP = 0; F.mix = 0; F.bubbles = 0;
      F.fill = [0, 0]; F.steamT = 0; F.chill = 0;
      F.flip = [0, 0];

      /* ================= step 1 : caramel ================= */
      let heating = false;
      const panAt = () => ({ x: App.W / 2, y: App.H * 0.5, r: Math.min(App.W * 0.32, 170 * App.S) });
      const s1 = {
        hint: 'hold',
        bgMode: 'stove',
        hintAt() { const pn = panAt(); return { x: pn.x, y: pn.y }; },
        enter() { Snd.setSizzle(0.1); },
        update(dt) {
          heating = App.pointer.down;
          if (heating) {
            if (F.melt < 1) F.melt = Math.min(1, F.melt + dt * 0.35);
            else F.caramel = Math.min(1, F.caramel + dt * 0.12);
            Snd.setSizzle(0.15 + F.caramel * 0.3);
            if (F.melt >= 1 && Math.random() < dt * 6) {
              const pn = panAt();
              sc.parts.add({
                x: pn.x + rnd(-0.5, 0.5) * pn.r, y: pn.y + rnd(-0.3, 0.3) * pn.r * 0.6,
                color: 'rgba(255,240,200,0.8)', r: rnd(3, 6) * App.S, vy: -20 * App.S, life: 0.5, kind: 'steam', grow: 4 * App.S
              });
            }
            if (Math.random() < dt * 1.5) steamPuff(sc.parts, panAt().x, panAt().y - 40 * App.S);
          } else Snd.setSizzle(0.05);
        },
        draw(ctx) {
          const pn = panAt(), S = App.S;
          drawStoveTop(ctx, pn.x, pn.y, pn.r);
          drawPan(ctx, pn.x, pn.y, pn.r);
          ctx.save();
          ctx.translate(pn.x, pn.y); ctx.scale(1, 0.72);
          if (F.melt < 1) {
            /* sugar pile melts into a pool */
            const pile = 1 - F.melt;
            ell(ctx, 0, 0, pn.r * (0.3 + F.melt * 0.35), pn.r * (0.3 + F.melt * 0.3), caramelColor(F.caramel));
            if (pile > 0.02) {
              blobPath(ctx, 0, -pile * 14 * S, pn.r * 0.28 * pile + pn.r * 0.06, 0.15, 1.7);
              ctx.fillStyle = '#ffffff'; ctx.fill();
              ctx.fillStyle = '#f4f4f8';
              for (let i = 0; i < 8 * pile; i++) {
                circle(ctx, (n1(i * 3) - 0.5) * pn.r * 0.4, (n1(i * 7) - 0.5) * pn.r * 0.3, 2.5 * S);
              }
            }
          } else {
            ell(ctx, 0, 0, pn.r * 0.65, pn.r * 0.6, caramelColor(F.caramel));
            ell(ctx, -pn.r * 0.2, -pn.r * 0.15, pn.r * 0.16, pn.r * 0.1, 'rgba(255,255,255,0.35)');
          }
          ctx.restore();
        },
        done: () => F.melt >= 1 && F.caramel > 0.12
      };

      /* ================= step 2 : custard (gentle mixing) ================= */
      const stir = new Stir();
      let prevRevs = 0, pouring = false;
      const bowlAt = () => ({ x: App.W / 2, y: App.H * 0.58, r: Math.min(App.W * 0.32, 180 * App.S) });
      const itemsAt = () => ({
        egg: { x: App.W * 0.25, y: App.H * 0.22 },
        milk: { x: App.W * 0.75, y: App.H * 0.24 }
      });
      const s2 = {
        hint: 'tap',
        hintAt() {
          const it = itemsAt();
          if (F.egg < 2) return it.egg;
          if (F.milkP < 0.25) return it.milk;
          const b = bowlAt(); return { x: b.x, y: b.y };
        },
        update(dt) {
          const b = bowlAt();
          if (pouring && App.pointer.down) F.milkP = Math.min(1, F.milkP + dt * 0.4);
          else pouring = false;
          if (F.egg >= 2 && F.milkP > 0.2) {
            const sp = stir.feed(App.pointer, b.x, b.y, b.r * 1.3, dt);
            const dR = stir.revs - prevRevs; prevRevs = stir.revs;
            if (dR > 0) {
              F.mix = Math.min(1, F.mix + dR * 0.12);
              /* whisking hard puts bubbles in — they stay as "す" in the pudding */
              if (sp > 10) F.bubbles = Math.min(1, F.bubbles + dR * 0.15);
              if (Math.random() < dR * 2) Snd.tick();
            }
          }
        },
        draw(ctx) {
          const S = App.S, b = bowlAt(), it = itemsAt();
          drawBowl(ctx, b.x, b.y, b.r, '#c9a2e8');
          ctx.save(); bowlClip(ctx, b.x, b.y, b.r);
          const bi = bowlInner(b.x, b.y, b.r);
          if (F.milkP > 0 || F.egg >= 2) {
            const fill = 0.3 + F.milkP * 0.5 + (F.egg >= 2 ? 0.1 : 0);
            ell(ctx, bi.x, bi.y + bi.ry * 0.12, bi.rx * fill + bi.rx * 0.15, bi.ry * fill + bi.ry * 0.1,
              mixc('#fbf6e8', '#f7dd9a', F.mix));
            if (F.egg >= 2 && F.mix < 0.9) {
              ctx.globalAlpha = 1 - F.mix;
              ell(ctx, bi.x + bi.rx * 0.2, bi.y, 24 * S, 17 * S, '#f7b53a');
              ctx.globalAlpha = 1;
            }
            /* persistent foam bubbles */
            const nb = Math.round(F.bubbles * 18);
            ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2 * S;
            for (let i = 0; i < nb; i++) {
              const a = n1(i * 13 + 1) * TAU;
              const rd = (0.2 + n1(i * 7) * 0.6) * bi.rx;
              ctx.beginPath();
              ctx.arc(bi.x + Math.cos(a) * rd, bi.y + Math.sin(a) * rd * 0.5, (2.5 + n1(i) * 3.5) * S, 0, TAU);
              ctx.stroke();
            }
          }
          ctx.restore();
          if (F.egg < 2) drawEggItem(ctx, it.egg.x, it.egg.y, S * 1.3, F.egg);
          if (pouring && App.pointer.down) {
            drawPitcher(ctx, b.x - 60 * S, b.y - b.r - 60 * S, S * 1.1, -0.9);
            drawStream(ctx, b.x - 95 * S, b.y - b.r - 75 * S, b.x - 20 * S, b.y - 20 * S, 9 * S, '#fdfdf6');
          } else drawPitcher(ctx, it.milk.x, it.milk.y, S * 1.1, 0);
          if (F.egg >= 2 && F.milkP > 0.2 && App.pointer.down && !pouring) {
            drawWhisk(ctx, App.pointer.x, App.pointer.y, S, Math.sin(App.time * 6) * 0.15);
          }
        },
        down(p) {
          const S = App.S, it = itemsAt();
          if (F.egg < 2 && dist(p.x, p.y, it.egg.x, it.egg.y) < 75 * S) {
            F.egg++;
            if (F.egg >= 2) { Snd.plop(); sparkleBurst(sc.parts, bowlAt().x, bowlAt().y - 30 * S, '#f7b53a', 6); }
            else Snd.crunch();
            return;
          }
          if (dist(p.x, p.y, it.milk.x, it.milk.y) < 80 * S) { pouring = true; Snd.tick(); }
        },
        up() { pouring = false; },
        done: () => F.egg >= 2 && F.milkP > 0.25 && F.mix > 0.5
      };

      /* ================= step 3 : pour into cups ================= */
      const cupAt = i => ({ x: App.W * (0.35 + i * 0.3), y: App.H * 0.55 });
      function drawCup(ctx, x, y, fillT, caramelT, setT) {
        const S = App.S, w = 110 * S, h = 120 * S;
        ctx.fillStyle = 'rgba(200,215,230,0.55)';
        ctx.beginPath();
        ctx.moveTo(x - w * 0.42, y - h * 0.5);
        ctx.lineTo(x - w * 0.5, y + h * 0.5);
        ctx.lineTo(x + w * 0.5, y + h * 0.5);
        ctx.lineTo(x + w * 0.42, y - h * 0.5);
        ctx.closePath(); ctx.fill();
        /* caramel layer at bottom keeps the chosen color */
        ctx.fillStyle = caramelColor(caramelT);
        ctx.beginPath();
        ctx.moveTo(x - w * 0.47, y + h * 0.28);
        ctx.lineTo(x - w * 0.48, y + h * 0.46);
        ctx.lineTo(x + w * 0.48, y + h * 0.46);
        ctx.lineTo(x + w * 0.47, y + h * 0.28);
        ctx.closePath(); ctx.fill();
        if (fillT > 0) {
          ctx.fillStyle = mixc('#f9e2a0', '#f7d58a', setT);
          ctx.globalAlpha = 0.55 + setT * 0.45;
          const top = y + h * 0.28 - fillT * h * 0.6;
          ctx.beginPath();
          ctx.moveTo(x - w * 0.46, top);
          ctx.lineTo(x - w * 0.47, y + h * 0.28);
          ctx.lineTo(x + w * 0.47, y + h * 0.28);
          ctx.lineTo(x + w * 0.46, top);
          ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = 'rgba(160,180,200,0.8)'; ctx.lineWidth = 3 * S;
        ctx.beginPath();
        ctx.moveTo(x - w * 0.42, y - h * 0.5);
        ctx.lineTo(x - w * 0.5, y + h * 0.5);
        ctx.lineTo(x + w * 0.5, y + h * 0.5);
        ctx.lineTo(x + w * 0.42, y - h * 0.5);
        ctx.closePath(); ctx.stroke();
      }
      let pourI = -1;
      const s3 = {
        hint: 'hold',
        hintAt() {
          const i = F.fill.findIndex(f => f < 0.6);
          return cupAt(i >= 0 ? i : 0);
        },
        update(dt) {
          const p = App.pointer;
          if (p.down) {
            pourI = -1;
            for (let i = 0; i < 2; i++) {
              if (dist(p.x, p.y, cupAt(i).x, cupAt(i).y) < 110 * App.S) { pourI = i; break; }
            }
            if (pourI >= 0) {
              F.fill[pourI] = Math.min(1, F.fill[pourI] + dt * 0.5);
              if (Math.random() < 0.2) Snd.tick();
            }
          } else pourI = -1;
        },
        draw(ctx) {
          const S = App.S;
          ell(ctx, App.W / 2, App.H * 0.63, App.W * 0.42, 60 * S, '#fbf0da');
          for (let i = 0; i < 2; i++) {
            const c = cupAt(i);
            drawCup(ctx, c.x, c.y, F.fill[i], F.caramel, 0);
          }
          if (pourI >= 0) {
            const c = cupAt(pourI);
            drawBowl(ctx, c.x - 40 * S, c.y - 150 * S, 70 * S, '#c9a2e8');
            drawStream(ctx, c.x - 25 * S, c.y - 130 * S, c.x, c.y - 30 * S, 9 * S, '#f9e2a0');
          }
        },
        done: () => F.fill[0] > 0.6 && F.fill[1] > 0.6
      };

      /* ================= step 4 : steam ================= */
      let rattle = 0;
      const s4 = {
        hint: 'hold',
        hintAt() { return { x: App.W / 2, y: App.H * 0.45 }; },
        update(dt) {
          if (App.pointer.down) {
            F.steamT = Math.min(1, F.steamT + dt * 0.24);
            rattle = Math.sin(App.time * 24) * 3 * App.S;
            steamPuff(sc.parts, App.W / 2 + rnd(-100, 100) * App.S, App.H * 0.3, 1);
            if (Math.random() < dt * 3) Snd.tick();
          } else rattle = 0;
        },
        draw(ctx) {
          const S = App.S, cx = App.W / 2, cy = App.H * 0.52;
          const w = Math.min(App.W * 0.7, 430 * S);
          /* pot */
          ctx.fillStyle = '#8ea6b8';
          rr(ctx, cx - w / 2, cy - 60 * S, w, 210 * S, 20 * S); ctx.fill();
          ctx.fillStyle = '#a6bccc';
          rr(ctx, cx - w / 2, cy - 60 * S, w, 40 * S, 20 * S); ctx.fill();
          /* cups peeking */
          for (let i = 0; i < 2; i++) {
            const c = { x: cx + (i - 0.5) * w * 0.4, y: cy + 60 * S };
            drawCup(ctx, c.x, c.y, F.fill[i], F.caramel, F.steamT);
          }
          /* lid */
          ctx.save();
          ctx.translate(0, rattle);
          ell(ctx, cx, cy - 70 * S, w * 0.54, 34 * S, '#c2d2de');
          ell(ctx, cx, cy - 84 * S, 20 * S, 12 * S, '#8ea6b8');
          ctx.restore();
        },
        done: () => F.steamT > 0.5
      };

      /* ================= step 5 : chill ================= */
      let drops = [];
      const s5 = {
        hint: 'hold',
        bgMode: 'chill',
        hintAt() { return { x: App.W / 2, y: App.H * 0.5 }; },
        update(dt) {
          if (App.pointer.down) {
            F.chill = Math.min(1, F.chill + dt * 0.3);
            if (Math.random() < 0.3) {
              sc.parts.add({
                x: rnd(App.W * 0.2, App.W * 0.8), y: rnd(App.H * 0.25, App.H * 0.6),
                kind: 'spark', color: '#cfeaff', r: rnd(4, 8) * App.S, life: 0.8, vy: 20 * App.S
              });
            }
            if (Math.random() < dt * 4 && drops.length < 26) {
              const i = rndi(0, 1);
              drops.push({ i, dx: rnd(-45, 45) * App.S, y: rnd(-40, 10) * App.S, r: rnd(2.5, 5) * App.S, v: 0 });
            }
          }
          for (const d of drops) { d.v += dt * 8 * App.S; d.y += d.v * dt; }
          drops = drops.filter(d => d.y < 60 * App.S);
        },
        draw(ctx) {
          const S = App.S, cx = App.W / 2, cy = App.H * 0.5;
          /* fridge shelf */
          ctx.fillStyle = '#eef7fd';
          rr(ctx, App.W * 0.08, App.H * 0.18, App.W * 0.84, App.H * 0.6, 24 * S); ctx.fill();
          ctx.fillStyle = '#d8ecf7';
          rr(ctx, App.W * 0.08, cy + 66 * S, App.W * 0.84, 18 * S, 8 * S); ctx.fill();
          for (let i = 0; i < 2; i++) {
            const c = { x: cx + (i - 0.5) * App.W * 0.3, y: cy };
            drawCup(ctx, c.x, c.y, F.fill[i], F.caramel, 1);
            /* condensation drops */
            ctx.fillStyle = 'rgba(190,225,250,0.9)';
            for (const d of drops) if (d.i === i) ell(ctx, c.x + d.dx, c.y + d.y, d.r * 0.8, d.r);
            /* frost sheen */
            ctx.globalAlpha = F.chill * 0.4;
            ell(ctx, c.x - 25 * S, c.y - 30 * S, 18 * S, 34 * S, '#ffffff');
            ctx.globalAlpha = 1;
          }
        },
        done: () => F.chill > 0.4
      };

      /* ================= step 6 : flip & jiggle (final) ================= */
      let wob = [new Spring(), new Spring()];
      const plateP = i => ({ x: App.W * (0.32 + i * 0.36), y: App.H * 0.58 });
      const s6 = {
        hint: 'tap',
        hintAt() {
          const i = F.flip.findIndex(f => f < 1);
          return plateP(i >= 0 ? i : 0);
        },
        enter() { Snd.chime(); },
        update(dt) {
          /* firmness from steaming+chilling controls the spring */
          const firm = clamp(F.steamT * 0.6 + F.chill * 0.4, 0.2, 1);
          for (let i = 0; i < 2; i++) {
            if (F.flip[i] > 0 && F.flip[i] < 1) {
              F.flip[i] = Math.min(1, F.flip[i] + dt * 2);
              if (F.flip[i] >= 1) {
                Snd.plop();
                wob[i].kick(6 * (1.6 - firm));
                sparkleBurst(sc.parts, plateP(i).x, plateP(i).y - 40 * App.S, '#ffd94f', 8);
                if (F.flip[0] >= 1 && F.flip[1] >= 1) { confettiBurst(sc.parts); Snd.tada(); }
              }
            }
            wob[i].update(dt, 40 + firm * 120, 2.5 + firm * 3);
          }
        },
        draw(ctx) {
          const S = App.S;
          for (let i = 0; i < 2; i++) {
            const pp = plateP(i);
            drawPlate(ctx, pp.x, pp.y + 20 * S, Math.min(App.W * 0.2, 150 * S));
            const f = F.flip[i];
            if (f < 1) {
              /* upside-down cup, lifts off when tapped */
              const lift = f * 140 * S;
              ctx.save();
              ctx.translate(pp.x, pp.y - lift);
              ctx.rotate(f * 0.5);
              ctx.scale(1, -1);
              drawCup(ctx, 0, -20 * S, F.fill[i], F.caramel, 1);
              ctx.restore();
              if (f > 0) this.drawFlan(ctx, pp, i, clamp(f * 1.6, 0, 1));
            } else {
              this.drawFlan(ctx, pp, i, 1);
            }
          }
          drawEndBtns(ctx);
        },
        drawFlan(ctx, pp, i, reveal) {
          const S = App.S, w = wob[i].x;
          const bw = 96 * S, bh = 100 * S * reveal;
          ctx.save();
          ctx.translate(pp.x, pp.y + 8 * S);
          ctx.scale(1 + w * 0.14, 1 - w * 0.14);
          ctx.fillStyle = mixc('#f7cf5f', '#f2c035', 0.5);
          ctx.beginPath();
          ctx.moveTo(-bw * 0.72, 0);
          ctx.lineTo(-bw * 0.5, -bh);
          ctx.quadraticCurveTo(0, -bh * 1.15, bw * 0.5, -bh);
          ctx.lineTo(bw * 0.72, 0);
          ctx.quadraticCurveTo(0, 14 * S, -bw * 0.72, 0);
          ctx.fill();
          /* caramel keeps the color chosen at step 1, drips down */
          ctx.fillStyle = caramelColor(F.caramel);
          ctx.beginPath();
          ctx.moveTo(-bw * 0.5, -bh);
          ctx.quadraticCurveTo(0, -bh * 1.15, bw * 0.5, -bh);
          ctx.lineTo(bw * 0.48, -bh * 0.7);
          ctx.quadraticCurveTo(bw * 0.3, -bh * 0.55, bw * 0.2, -bh * 0.75);
          ctx.quadraticCurveTo(0, -bh * 0.5, -bw * 0.25, -bh * 0.72);
          ctx.quadraticCurveTo(-bw * 0.45, -bh * 0.6, -bw * 0.5, -bh);
          ctx.fill();
          /* pool of caramel on the plate */
          ell(ctx, 0, 4 * S, bw * 0.85, 16 * S, caramelColor(F.caramel));
          /* "す" — holes from over-whisked bubbles stay visible */
          const nh = Math.round(F.bubbles * 12);
          ctx.fillStyle = 'rgba(160,110,30,0.4)';
          for (let k = 0; k < nh; k++) {
            circle(ctx, (n1(k * 7 + i) - 0.5) * bw * 1.1, -n1(k * 3) * bh * 0.8, 2.6 * S);
          }
          /* chilled shine */
          ctx.globalAlpha = 0.3 + F.chill * 0.4;
          ell(ctx, -bw * 0.3, -bh * 0.75, bw * 0.16, bh * 0.2, '#ffffff');
          ctx.globalAlpha = 1;
          ctx.restore();
        },
        down(p) {
          if (handleEndBtns(sc, p)) return;
          for (let i = 0; i < 2; i++) {
            const pp = plateP(i);
            if (dist(p.x, p.y, pp.x, pp.y) < 130 * App.S) {
              if (F.flip[i] === 0) { F.flip[i] = 0.01; Snd.whoosh(); }
              else if (F.flip[i] >= 1) {
                const firm = clamp(F.steamT * 0.6 + F.chill * 0.4, 0.2, 1);
                wob[i].kick(5 * (1.7 - firm));
                Snd.pop();
              }
            }
          }
        },
        done: () => false
      };

      return [s1, s2, s3, s4, s5, s6];
    }
  };

  DISHES.push(def);
})();
