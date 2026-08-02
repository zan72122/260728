'use strict';
/* ==========================================================
   パンケーキ
   固有の変身:
   - 牛乳の量 → 生地のゆるさ → 流したときの広がり方・厚み
   - 混ぜ方(回した量・速さ) → ダマの残り / ふくらみ(気泡)
   - 注いだ場所と時間 → 自分だけの形のパンケーキ(複数枚も可)
   - 焼き時間 → 表裏それぞれの焼き色 / 気泡がはじけてポツポツ穴
   - ひっくり返すのは自分のフリック
   - 最後はシロップを指でかける(軌跡が残る)
   ========================================================== */
(function () {

  const def = {
    id: 'pancake',
    color: '#ffe3b3',
    icon(ctx, r) {
      /* pancake stack */
      for (let i = 0; i < 3; i++) {
        const y = r * 0.45 - i * r * 0.38;
        ell(ctx, 0, y + r * 0.1, r * 0.95 - i * r * 0.06, r * 0.42, '#c98a3e');
        ell(ctx, 0, y, r * 0.95 - i * r * 0.06, r * 0.42, '#e8b25f');
        ell(ctx, 0, y - r * 0.05, r * 0.78 - i * r * 0.06, r * 0.3, '#f2cd85');
      }
      ctx.fillStyle = '#f7d878';
      rr(ctx, -r * 0.22, -r * 0.78, r * 0.44, r * 0.28, r * 0.08); ctx.fill();
    },

    steps(sc) {
      const F = sc.food;
      F.flour = false; F.eggStage = 0; F.milk = 0;
      F.lump = 1; F.air = 0; F.batter = 1;
      F.blobs = []; F.syrup = []; F.berries = []; F.butter = false;

      const bowlAt = () => ({ x: App.W / 2, y: App.H * 0.56, r: Math.min(App.W * 0.34, 190 * App.S) });
      const panAt = () => ({ x: App.W / 2, y: App.H * 0.5, r: Math.min(App.W * 0.4, 215 * App.S) });
      const visc = () => clamp(1.25 - F.milk * 0.85, 0.35, 1.15);

      /* ---- batter appearance inside bowl ---- */
      function drawBatterBowl(ctx, x, y, r) {
        drawBowl(ctx, x, y, r, '#8ecbe8');
        ctx.save();
        bowlClip(ctx, x, y, r);
        const b = bowlInner(x, y, r);
        if (F.milk > 0) {
          ell(ctx, b.x, b.y + b.ry * 0.15, b.rx * (0.4 + F.milk * 0.55), b.ry * (0.4 + F.milk * 0.5), '#fdfdf6');
        }
        if (F.flour) {
          ell(ctx, b.x - b.rx * 0.25, b.y, b.rx * 0.42, b.ry * 0.5, '#f7f1e2');
          ell(ctx, b.x + b.rx * 0.2, b.y - b.ry * 0.1, b.rx * 0.3, b.ry * 0.36, '#fbf6ea');
        }
        if (F.eggStage >= 2) {
          ell(ctx, b.x + b.rx * 0.3, b.y + b.ry * 0.2, 26 * App.S, 19 * App.S, '#f7b53a');
          ell(ctx, b.x + b.rx * 0.26, b.y + b.ry * 0.14, 9 * App.S, 6 * App.S, '#fbd57a');
        }
        ctx.restore();
      }

      function drawMixedBowl(ctx, x, y, r) {
        drawBowl(ctx, x, y, r, '#8ecbe8');
        ctx.save();
        bowlClip(ctx, x, y, r);
        const b = bowlInner(x, y, r);
        /* base batter becomes smoother as lump decreases */
        ell(ctx, b.x, b.y + b.ry * 0.1, b.rx * 0.97, b.ry * 0.92, mixc('#f2e6c8', '#f7dfa8', 1 - F.lump));
        /* marble streaks while unmixed */
        if (F.lump > 0.03) {
          ctx.globalAlpha = F.lump * 0.9;
          ctx.lineWidth = 10 * App.S; ctx.lineCap = 'round';
          for (let i = 0; i < 4; i++) {
            ctx.strokeStyle = i % 2 ? '#fdfdf6' : '#f2c96b';
            ctx.beginPath();
            const a0 = i * 1.7 + App.time * 0.15;
            ctx.arc(b.x, b.y, b.rx * (0.25 + i * 0.16), a0, a0 + 2.2);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        /* lumps */
        const nl = Math.round(F.lump * 12);
        for (let i = 0; i < nl; i++) {
          const a = n1(i * 13) * TAU + App.time * 0.1;
          const rd = n1(i * 7 + 2) * b.rx * 0.7;
          ell(ctx, b.x + Math.cos(a) * rd, b.y + Math.sin(a) * rd * 0.6,
            (4 + n1(i) * 7) * App.S * (0.4 + F.lump * 0.6), (3 + n1(i) * 5) * App.S, '#efe0b5');
        }
        /* air bubbles */
        const nb = Math.round(F.air * 14);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.8 * App.S;
        for (let i = 0; i < nb; i++) {
          const a = n1(i * 31 + 5) * TAU;
          const rd = (0.3 + n1(i * 17) * 0.6) * b.rx;
          ctx.beginPath();
          ctx.arc(b.x + Math.cos(a) * rd, b.y + Math.sin(a) * rd * 0.55, (2.5 + n1(i * 3) * 3) * App.S, 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
      }

      /* ---- pancake blob on pan ---- */
      function drawBlob(ctx, b, panc) {
        const S = App.S;
        let sy = 1, lift = 0;
        if (b.flipping) {
          sy = Math.abs(Math.cos(Math.PI * b.flipT));
          lift = Math.sin(Math.PI * b.flipT) * 90 * S;
        }
        ctx.save();
        ctx.translate(b.x, b.y - lift);
        ctx.scale(1, 0.74 * Math.max(sy, 0.06));
        const rise = 1 + b.rise * 0.12;
        /* underside peeking at the edge shows how brown the bottom is */
        blobPath(ctx, 0, 0, b.r * rise + 5 * S, 0.07, b.seed);
        ctx.fillStyle = bakeColor(clamp(b.bot, 0, 1)); ctx.fill();
        blobPath(ctx, 0, 0, b.r * rise, 0.07, b.seed);
        ctx.fillStyle = bakeColor(clamp(b.top, 0, 1)); ctx.fill();
        /* pores from popped bubbles */
        ctx.fillStyle = 'rgba(120,70,20,0.35)';
        for (const po of b.pores) {
          circle(ctx, po.dx * b.r, po.dy * b.r, 2.6 * S);
        }
        /* live bubbles */
        for (const bu of b.bub) {
          const k = clamp(bu.age / bu.life, 0, 1);
          ctx.fillStyle = 'rgba(255,245,215,0.9)';
          circle(ctx, bu.dx * b.r, bu.dy * b.r, bu.r * (0.5 + k * 0.6));
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          circle(ctx, bu.dx * b.r - bu.r * 0.25, bu.dy * b.r - bu.r * 0.3, bu.r * 0.28);
        }
        ctx.restore();
      }

      /* ================= step 1 : ingredients ================= */
      let pouring = false;
      const itemsAt = () => {
        const { W, H, S } = App;
        return {
          flour: { x: W * 0.2, y: H * 0.24 },
          egg: { x: W * 0.5, y: H * 0.22 },
          milk: { x: W * 0.8, y: H * 0.24 }
        };
      };
      const s1 = {
        hint: 'tap',
        hintAt() { const it = itemsAt(); return !F.flour ? it.flour : (F.eggStage < 2 ? it.egg : it.milk); },
        update(dt) {
          if (pouring && App.pointer.down) {
            F.milk = Math.min(1, F.milk + dt * 0.4);
            if (Math.random() < 0.3) {
              const b = bowlAt();
              sc.parts.add({ x: b.x + rnd(-20, 20) * App.S, y: b.y - 10 * App.S, color: '#fdfdf6', r: 4 * App.S, vy: 60 * App.S, life: 0.3 });
            }
          } else pouring = false;
        },
        draw(ctx) {
          const S = App.S, it = itemsAt(), b = bowlAt();
          drawBatterBowl(ctx, b.x, b.y, b.r);
          /* flour bag */
          if (!F.flour) {
            ctx.fillStyle = '#f7ead2';
            rr(ctx, it.flour.x - 38 * S, it.flour.y - 46 * S, 76 * S, 92 * S, 12 * S); ctx.fill();
            ctx.fillStyle = '#e8d5ac';
            rr(ctx, it.flour.x - 38 * S, it.flour.y - 46 * S, 76 * S, 24 * S, 12 * S); ctx.fill();
            ell(ctx, it.flour.x, it.flour.y + 10 * S, 24 * S, 18 * S, '#fff');
          }
          /* egg */
          if (F.eggStage < 2) drawEggItem(ctx, it.egg.x, it.egg.y, S * 1.25, F.eggStage);
          /* milk pitcher */
          if (pouring && App.pointer.down) {
            drawPitcher(ctx, b.x - 60 * S, b.y - b.r - 60 * S, S * 1.15, -0.9);
            drawStream(ctx, b.x - 95 * S, b.y - b.r - 75 * S, b.x - 20 * S, b.y - 20 * S, 10 * S, '#fdfdf6');
          } else {
            drawPitcher(ctx, it.milk.x, it.milk.y, S * 1.15, 0);
          }
          /* milk gauge as growing pool is visible in bowl */
        },
        down(p) {
          const S = App.S, it = itemsAt(), b = bowlAt();
          if (!F.flour && dist(p.x, p.y, it.flour.x, it.flour.y) < 70 * S) {
            F.flour = true; Snd.plop();
            for (let i = 0; i < 16; i++) {
              sc.parts.add({
                x: b.x + rnd(-b.r, b.r) * 0.4, y: b.y - rnd(0, 60) * S,
                color: '#fff', r: rnd(5, 12) * S, vy: -rnd(20, 70) * S, vx: rnd(-40, 40) * S,
                life: rnd(0.4, 0.8), kind: 'steam', grow: 10 * S
              });
            }
            return;
          }
          if (F.eggStage < 2 && dist(p.x, p.y, it.egg.x, it.egg.y) < 70 * S) {
            F.eggStage++;
            if (F.eggStage >= 2) {
              Snd.plop();
              sparkleBurst(sc.parts, b.x, b.y - 30 * S, '#f7b53a', 6);
            } else Snd.crunch();
            return;
          }
          if (dist(p.x, p.y, it.milk.x, it.milk.y) < 80 * S || (pouring === false && F.milk > 0 && dist(p.x, p.y, b.x - 60 * S, b.y - b.r - 60 * S) < 90 * S)) {
            pouring = true; Snd.tick();
          }
        },
        up() { pouring = false; },
        done: () => F.flour && F.eggStage >= 2 && F.milk > 0.2
      };

      /* ================= step 2 : mix ================= */
      const stir = new Stir();
      let prevRevs = 0;
      const s2 = {
        hint: 'stir',
        hintAt() { const b = bowlAt(); return { x: b.x, y: b.y }; },
        update(dt) {
          const b = bowlAt();
          const sp = stir.feed(App.pointer, b.x, b.y, b.r * 1.3, dt);
          const dR = stir.revs - prevRevs; prevRevs = stir.revs;
          if (dR > 0) {
            F.lump = Math.max(0, F.lump - dR * 0.12);
            /* slow careful stirring folds in more air */
            F.air = Math.min(1, F.air + dR * (sp < 8 ? 0.09 : 0.035));
            if (Math.random() < dR * 2) Snd.tick();
          }
          /* very fast stirring splashes drops (fun, harmless) */
          if (sp > 15 && Math.random() < 0.25) {
            const a = rnd(TAU);
            sc.parts.add({
              x: b.x + Math.cos(a) * b.r * 0.7, y: b.y + Math.sin(a) * b.r * 0.45,
              color: '#f6dfa6', r: rnd(3, 6) * App.S,
              vx: Math.cos(a) * rnd(100, 220) * App.S, vy: -rnd(60, 160) * App.S,
              g: 500 * App.S, life: 0.6
            });
            Snd.tick();
          }
        },
        draw(ctx) {
          const b = bowlAt();
          drawMixedBowl(ctx, b.x, b.y, b.r);
          const p = App.pointer;
          if (p.down) drawWhisk(ctx, p.x, p.y, App.S * 1.1, Math.sin(App.time * 6) * 0.15);
          else drawWhisk(ctx, b.x + b.r * 1.15, b.y - 30 * App.S, App.S, 0.4);
        },
        done: () => F.lump < 0.45
      };

      /* ================= step 3 : pour on pan ================= */
      const s3 = {
        hint: 'hold',
        bgMode: 'stove',
        hintAt() { const pn = panAt(); return { x: pn.x, y: pn.y }; },
        enter() { Snd.setSizzle(0.15); },
        update(dt) {
          const p = App.pointer, pn = panAt();
          if (p.down && F.batter > 0 && dist(p.x, p.y, pn.x, pn.y) < pn.r * 0.85) {
            const v = visc();
            /* find blob under finger, else start a new one */
            let target = null;
            for (const b of F.blobs) {
              if (dist(p.x, p.y, b.x, b.y) < b.r + 26 * App.S) { target = b; break; }
            }
            if (!target) {
              target = { x: p.x, y: p.y, r: 12 * App.S, seed: rnd(10), top: 0, bot: 0, rise: 0, flipping: false, flipT: 0, flippedOnce: false, pores: [], bub: [] };
              F.blobs.push(target);
              Snd.plop();
            }
            /* runnier batter spreads faster and wider */
            const grow = dt * (52 / (0.35 + v)) * App.S;
            const maxR = Math.min(pn.r * 0.62, (150 / v) * App.S * 0.8);
            if (target.r < maxR) target.r += grow;
            /* keep blob inside pan */
            const dd = dist(target.x, target.y, pn.x, pn.y);
            const lim = pn.r * 0.8 - target.r * 0.6;
            if (dd > lim && dd > 0) {
              target.x = pn.x + (target.x - pn.x) / dd * lim;
              target.y = pn.y + (target.y - pn.y) / dd * lim;
            }
            F.batter = Math.max(0, F.batter - dt * 0.24);
            if (Math.random() < 0.2) Snd.tick();
          }
        },
        draw(ctx) {
          const pn = panAt(), S = App.S;
          drawStoveTop(ctx, pn.x, pn.y, pn.r);
          drawPan(ctx, pn.x, pn.y, pn.r);
          for (const b of F.blobs) drawBlob(ctx, b, pn);
          const p = App.pointer;
          if (p.down && F.batter > 0 && dist(p.x, p.y, pn.x, pn.y) < pn.r * 0.95) {
            drawLadle(ctx, p.x, p.y - 60 * S, S);
            drawStream(ctx, p.x, p.y - 48 * S, p.x, p.y, 9 * S * (0.6 + visc() * 0.5), '#f6dfa6');
          }
          /* small bowl showing batter left */
          const bx = App.W * 0.13, by = App.H * 0.85;
          drawBowl(ctx, bx, by, 62 * S, '#8ecbe8');
          if (F.batter > 0.02) {
            ctx.save(); bowlClip(ctx, bx, by, 62 * S);
            ell(ctx, bx, by + 8 * S, 52 * S * F.batter + 6 * S, 32 * S * F.batter + 4 * S, '#f6dfa6');
            ctx.restore();
          }
        },
        done: () => F.blobs.length > 0 && F.batter < 0.92
      };

      /* ================= step 4 : cook & flip ================= */
      let popCool = 0;
      const s4 = {
        hint: 'flick',
        bgMode: 'stove',
        hintAt() {
          const b = F.blobs.find(b => !b.flippedOnce) || F.blobs[0];
          return b ? { x: b.x, y: b.y } : { x: App.W / 2, y: App.H / 2 };
        },
        enter() { Snd.setSizzle(0.7); },
        update(dt) {
          popCool -= dt;
          for (const b of F.blobs) {
            if (b.flipping) {
              b.flipT += dt * 2.6;
              if (b.flipT >= 0.5 && !b.swapped) {
                const t = b.top; b.top = b.bot; b.bot = t;
                b.swapped = true; b.flippedOnce = true;
                Snd.plop();
              }
              if (b.flipT >= 1) { b.flipping = false; b.flipT = 0; b.swapped = false; }
              continue;
            }
            b.bot = Math.min(1.15, b.bot + dt * 0.085);
            b.rise = Math.min(1, b.rise + dt * F.air * 0.22);
            /* bubbles appear while wet side up; more air -> more bubbles */
            if (b.top < 0.15 && b.bub.length < 3 + F.air * 8 && Math.random() < dt * (1.5 + F.air * 4)) {
              const a = rnd(TAU), rd = rnd(0.15, 0.75);
              b.bub.push({ dx: Math.cos(a) * rd, dy: Math.sin(a) * rd, r: rnd(3, 6) * App.S, age: 0, life: rnd(0.9, 1.6) });
            }
            for (let i = b.bub.length - 1; i >= 0; i--) {
              const bu = b.bub[i];
              bu.age += dt;
              if (bu.age > bu.life) {
                b.bub.splice(i, 1);
                if (b.pores.length < 22) b.pores.push({ dx: bu.dx, dy: bu.dy });
                if (popCool <= 0) { Snd.pop(); popCool = 0.18; }
              }
            }
            if (Math.random() < dt * 2) steamPuff(sc.parts, b.x, b.y - 20 * App.S);
          }
        },
        draw(ctx) {
          const pn = panAt();
          drawStoveTop(ctx, pn.x, pn.y, pn.r);
          drawPan(ctx, pn.x, pn.y, pn.r);
          for (const b of F.blobs) drawBlob(ctx, b, pn);
        },
        up(p) {
          const sp = Math.hypot(p.vx, p.vy);
          if (sp > 650 * App.S) {
            for (const b of F.blobs) {
              if (!b.flipping && dist(p.downX, p.downY, b.x, b.y) < b.r + 50 * App.S) {
                b.flipping = true; b.flipT = 0; b.swapped = false;
                Snd.whoosh();
                break;
              }
            }
          }
        },
        done: () => F.blobs.length > 0 && F.blobs.every(b => b.flippedOnce)
      };

      /* ================= step 5 : plate & decorate (final) ================= */
      let stack = [];
      const plateAt = () => ({ x: App.W / 2, y: App.H * 0.62 });
      function stackTop() {
        const pl = plateAt();
        let y = pl.y;
        for (const b of stack) y -= b.h;
        return { x: pl.x, y };
      }
      const s5 = {
        hint: 'drag',
        hintAt() { const t = stackTop(); return { x: t.x, y: t.y - 30 * App.S }; },
        hintOpt: { dx: 1, dy: 0.2 },
        enter() {
          stack = F.blobs.slice().sort((a, b) => b.r - a.r).map(b => ({
            r: clamp(b.r * 1.15, 58 * App.S, App.W * 0.3),
            h: (14 + b.rise * 24) * App.S,
            c: (clamp(b.top, 0, 1) + clamp(b.bot, 0, 1)) / 2,
            pores: b.pores, seed: b.seed
          }));
          confettiBurst(sc.parts);
          Snd.tada();
        },
        draw(ctx) {
          const S = App.S, pl = plateAt();
          drawPlate(ctx, pl.x, pl.y + 14 * S, Math.min(App.W * 0.42, 250 * S));
          /* side-view stack: fluffiness(air) & browning survive here */
          let y = pl.y;
          stack.forEach((b, i) => {
            const c = bakeColor(b.c);
            ctx.fillStyle = mixc(c, '#000000', 0.12);
            rr(ctx, pl.x - b.r, y - b.h, b.r * 2, b.h + 6 * S, b.h * 0.5); ctx.fill();
            ell(ctx, pl.x, y - b.h, b.r, b.r * 0.26, mixc(c, '#ffffff', 0.25));
            if (i === stack.length - 1) {
              ctx.fillStyle = 'rgba(120,70,20,0.3)';
              for (const po of b.pores) {
                if (Math.abs(po.dy) < 0.8) circle(ctx, pl.x + po.dx * b.r * 0.8, y - b.h + po.dy * b.r * 0.2, 2.4 * S);
              }
            }
            y -= b.h;
          });
          /* butter */
          if (F.butter) drawButterCube(ctx, pl.x, y - 8 * S, S, 0.2);
          /* syrup trail follows exactly where the finger went */
          if (F.syrup.length > 1) {
            ctx.strokeStyle = 'rgba(186,108,20,0.85)';
            ctx.lineWidth = 13 * S; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath();
            F.syrup.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y));
            ctx.stroke();
            ctx.strokeStyle = 'rgba(232,150,50,0.7)';
            ctx.lineWidth = 6 * S;
            ctx.stroke();
          }
          for (const be of F.berries) drawStrawberry(ctx, be.x, be.y, S * be.s);
          /* topping buttons */
          const bb = this.btns();
          circle(ctx, bb.butter.x, bb.butter.y, 44 * S, '#fff');
          drawButterCube(ctx, bb.butter.x, bb.butter.y, S * 0.9);
          circle(ctx, bb.berry.x, bb.berry.y, 44 * S, '#fff');
          drawStrawberry(ctx, bb.berry.x, bb.berry.y, S * 0.9);
          /* syrup bottle at finger while dragging */
          const p = App.pointer;
          if (p.down && this.dripping) {
            ctx.fillStyle = '#c9803a';
            rr(ctx, p.x - 16 * S, p.y - 95 * S, 32 * S, 60 * S, 10 * S); ctx.fill();
            ctx.fillStyle = '#8a5620';
            rr(ctx, p.x - 7 * S, p.y - 112 * S, 14 * S, 20 * S, 5 * S); ctx.fill();
            drawStream(ctx, p.x, p.y - 40 * S, p.x, p.y, 6 * S, 'rgba(186,108,20,0.85)');
          }
          drawEndBtns(ctx);
        },
        btns() {
          const S = App.S;
          return {
            butter: { x: App.W * 0.14, y: App.H * 0.28, r: 44 * S },
            berry: { x: App.W * 0.86, y: App.H * 0.28, r: 44 * S }
          };
        },
        down(p) {
          if (handleEndBtns(sc, p)) return;
          const S = App.S, bb = this.btns(), pl = plateAt();
          if (hitCircle(p, bb.butter)) {
            F.butter = true; Snd.plop();
            sparkleBurst(sc.parts, stackTop().x, stackTop().y, '#f7d878', 6);
            return;
          }
          if (hitCircle(p, bb.berry)) {
            if (F.berries.length < 6) {
              F.berries.push({ x: pl.x + rnd(-1, 1) * App.W * 0.22, y: pl.y + rnd(-10, 26) * S, s: rnd(0.8, 1.1) });
              Snd.plop();
            }
            return;
          }
          this.dripping = true;
          F.syrup.push({ x: p.x, y: p.y });
        },
        move(p) {
          if (this.dripping && F.syrup.length < 220) {
            const last = F.syrup[F.syrup.length - 1];
            if (!last || dist(p.x, p.y, last.x, last.y) > 8 * App.S) F.syrup.push({ x: p.x, y: p.y });
          }
        },
        up() { this.dripping = false; },
        done: () => false
      };

      return [s1, s2, s3, s4, s5];
    }
  };

  DISHES.push(def);
})();
