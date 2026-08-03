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
      /* fluffy stack with syrup drip + butter */
      softShadow(ctx, 0, r * 0.75, r * 0.95, r * 0.3, 0.2);
      for (let i = 0; i < 3; i++) {
        const y = r * 0.42 - i * r * 0.36;
        const w = r * 0.95 - i * r * 0.07;
        ell(ctx, 0, y + r * 0.12, w, r * 0.42, '#b97a35');
        const g = ctx.createLinearGradient(0, y - r * 0.3, 0, y + r * 0.3);
        g.addColorStop(0, '#f2c26b'); g.addColorStop(1, '#d99a48');
        ell(ctx, 0, y, w, r * 0.42, g);
        ell(ctx, 0, y - r * 0.06, w * 0.82, r * 0.3, '#f7d791');
      }
      /* syrup */
      ctx.fillStyle = '#c9781e';
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.36, r * 0.62, r * 0.2, 0, 0, TAU);
      ctx.fill();
      for (const dx of [-0.45, 0.1, 0.4]) {
        rr(ctx, dx * r - r * 0.05, -r * 0.32, r * 0.1, r * (0.24 + Math.abs(dx) * 0.2), r * 0.05);
        ctx.fill();
      }
      drawButterCube(ctx, 0, -r * 0.52, r * 0.014);
    },

    steps(sc) {
      const F = sc.food;
      F.flour = false; F.eggStage = 0; F.milk = 0;
      F.lump = 1; F.air = 0; F.batter = 1;
      F.blobs = []; F.syrup = []; F.berries = []; F.butter = false;

      const bowlAt = () => ({ x: App.W / 2, y: App.H * 0.56, r: Math.min(App.W * 0.34, 190 * App.S) });
      const panAt = () => ({ x: App.W / 2, y: App.H * 0.5, r: Math.min(App.W * 0.4, 215 * App.S) });
      const visc = () => clamp(1.25 - F.milk * 0.85, 0.35, 1.15);

      /* ---- rich ingredient props ---- */
      function drawFlourBag(ctx, x, y, S) {
        softShadow(ctx, x, y + 52 * S, 42 * S, 12 * S, 0.22);
        clay(ctx, () => rr(ctx, x - 38 * S, y - 46 * S, 76 * S, 92 * S, 12 * S),
          { x, y, r: 52 * S, base: '#f6ead0', bot: '#d9c193', gloss: 0 });
        /* folded cloth top */
        ctx.fillStyle = '#e8d5ac';
        rr(ctx, x - 38 * S, y - 46 * S, 76 * S, 22 * S, 12 * S); ctx.fill();
        ctx.fillStyle = 'rgba(140,110,60,0.2)';
        rr(ctx, x - 38 * S, y - 28 * S, 76 * S, 4 * S, 2 * S); ctx.fill();
        /* label with wheat */
        ell(ctx, x, y + 12 * S, 25 * S, 19 * S, '#fffdf6');
        ctx.strokeStyle = '#d9b87a'; ctx.lineWidth = 2 * S;
        ctx.beginPath(); ctx.ellipse(x, y + 12 * S, 25 * S, 19 * S, 0, 0, TAU); ctx.stroke();
        ctx.strokeStyle = '#c9a250'; ctx.lineWidth = 2.4 * S; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, y + 22 * S); ctx.lineTo(x, y + 4 * S); ctx.stroke();
        for (let i = 0; i < 3; i++) {
          const yy = y + 8 * S + i * 4 * S;
          ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x - 6 * S, yy - 4 * S); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + 6 * S, yy - 4 * S); ctx.stroke();
        }
      }
      function drawEggCup(ctx, x, y, S, crack) {
        clayEll(ctx, x, y + 26 * S, 26 * S, 13 * S, '#a8d4ec', { gloss: 0.4 });
        drawEggItem(ctx, x, y, S * 1.25, crack);
      }
      function drawYolk(ctx, x, y, s) {
        const g = ctx.createRadialGradient(x - 6 * s, y - 5 * s, 2 * s, x, y, 26 * s);
        g.addColorStop(0, '#fbd061');
        g.addColorStop(0.7, '#f5ae2e');
        g.addColorStop(1, '#e0921c');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(x, y, 26 * s, 19 * s, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.75;
        ell(ctx, x - 8 * s, y - 6 * s, 7 * s, 4.5 * s, '#ffe9ad');
        ctx.globalAlpha = 1;
      }

      /* wavy liquid surface path inside the bowl */
      function liquidPath(ctx, bx, by, rx, ry, amp, phase) {
        ctx.beginPath();
        const N = 30;
        for (let i = 0; i <= N; i++) {
          const a = i / N * TAU;
          const k = 1 + amp * Math.sin(a * 3 + phase) + amp * 0.5 * Math.sin(a * 5 - phase * 1.7);
          const px = bx + Math.cos(a) * rx * k;
          const py = by + Math.sin(a) * ry * k;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
      }

      /* ---- batter appearance inside bowl (step 1) ---- */
      function drawBatterBowl(ctx, x, y, r) {
        drawBowl(ctx, x, y, r, '#8ecbe8');
        ctx.save();
        bowlClip(ctx, x, y, r);
        const b = bowlInner(x, y, r);
        if (F.milk > 0) {
          const mrx = b.rx * (0.4 + F.milk * 0.55), mry = b.ry * (0.4 + F.milk * 0.5);
          const g = ctx.createLinearGradient(0, b.y - mry, 0, b.y + mry);
          g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#eef0e8');
          ell(ctx, b.x, b.y + b.ry * 0.15, mrx, mry, g);
          ctx.globalAlpha = 0.6;
          ell(ctx, b.x - mrx * 0.3, b.y + b.ry * 0.05, mrx * 0.3, mry * 0.16, '#ffffff');
          ctx.globalAlpha = 1;
        }
        if (F.flour) {
          clayEll(ctx, b.x - b.rx * 0.25, b.y, b.rx * 0.42, b.ry * 0.5, '#f7f1e0', { grain: 0.6, gloss: 0.3 });
          clayEll(ctx, b.x + b.rx * 0.2, b.y - b.ry * 0.1, b.rx * 0.3, b.ry * 0.36, '#fbf6ea', { grain: 0.6, gloss: 0.2 });
        }
        if (F.eggStage >= 2) {
          drawYolk(ctx, b.x + b.rx * 0.32, b.y + b.ry * 0.22, App.S);
        }
        ctx.restore();
      }

      /* ---- mixing bowl (step 2) ---- */
      const stir = new Stir();
      function drawMixedBowl(ctx, x, y, r) {
        const tilt = Math.sin(App.time * 9) * 0.012 * clamp(stir.speed / 14, 0, 1);
        ctx.save();
        ctx.translate(x, y); ctx.rotate(tilt); ctx.translate(-x, -y);
        drawBowl(ctx, x, y, r, '#8ecbe8');
        ctx.save();
        bowlClip(ctx, x, y, r);
        const b = bowlInner(x, y, r);
        const amp = clamp(stir.speed / 26, 0, 0.1);
        const phase = stir.revs * TAU;
        /* batter body: smoother = creamier color */
        const base = mixc('#efe0bc', '#f6dfa4', 1 - F.lump);
        const g = ctx.createLinearGradient(0, b.y - b.ry, 0, b.y + b.ry);
        g.addColorStop(0, mixc(base, '#ffffff', 0.25));
        g.addColorStop(1, mixc(base, '#a06a28', 0.18));
        ctx.fillStyle = g;
        liquidPath(ctx, b.x, b.y + b.ry * 0.08, b.rx * 0.97, b.ry * 0.9, amp, phase);
        ctx.fill();
        ctx.save();
        liquidPath(ctx, b.x, b.y + b.ry * 0.08, b.rx * 0.97, b.ry * 0.9, amp, phase);
        ctx.clip();
        /* marble streaks while unmixed */
        if (F.lump > 0.03) {
          ctx.globalAlpha = F.lump * 0.85;
          ctx.lineWidth = 11 * App.S; ctx.lineCap = 'round';
          for (let i = 0; i < 4; i++) {
            ctx.strokeStyle = i % 2 ? '#fdfdf6' : '#f2c96b';
            const a0 = i * 1.7 + stir.revs * 1.8;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.rx * (0.25 + i * 0.16), a0, a0 + 2.2);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
        /* creamy swirl highlight, rotates while stirring */
        ctx.globalAlpha = 0.3 * (1 - F.lump * 0.5);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 8 * App.S;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.rx * 0.45, phase * 0.8, phase * 0.8 + 1.8);
        ctx.stroke();
        ctx.globalAlpha = 1;
        /* lumps — little clay nuggets */
        const nl = Math.round(F.lump * 12);
        for (let i = 0; i < nl; i++) {
          const a = n1(i * 13) * TAU + App.time * 0.1 + phase * 0.15;
          const rd = n1(i * 7 + 2) * b.rx * 0.7;
          const lx = b.x + Math.cos(a) * rd, ly = b.y + Math.sin(a) * rd * 0.6;
          const lr = (4 + n1(i) * 7) * App.S * (0.4 + F.lump * 0.6);
          ell(ctx, lx, ly + lr * 0.3, lr, lr * 0.5, 'rgba(150,110,50,0.25)');
          ell(ctx, lx, ly, lr, lr * 0.75, '#eadaa8');
          ell(ctx, lx - lr * 0.3, ly - lr * 0.25, lr * 0.3, lr * 0.2, 'rgba(255,255,255,0.55)');
        }
        /* air bubbles with glossy dots */
        const nb = Math.round(F.air * 14);
        for (let i = 0; i < nb; i++) {
          const a = n1(i * 31 + 5) * TAU;
          const rd = (0.3 + n1(i * 17) * 0.6) * b.rx;
          const bx2 = b.x + Math.cos(a) * rd, by2 = b.y + Math.sin(a) * rd * 0.55;
          const br = (2.5 + n1(i * 3) * 3) * App.S;
          ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.8 * App.S;
          ctx.beginPath(); ctx.arc(bx2, by2, br, 0, TAU); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          circle(ctx, bx2 - br * 0.35, by2 - br * 0.35, br * 0.25);
        }
        grainRect(ctx, b.x - b.rx, b.y - b.ry, b.rx * 2, b.ry * 2, 0.25);
        ctx.restore();
        ctx.restore();
        ctx.restore();
      }

      /* ---- pancake blob on the pan ---- */
      function drawBlob(ctx, b) {
        const S = App.S;
        let sy = 1, lift = 0;
        if (b.flipping) {
          sy = Math.abs(Math.cos(Math.PI * b.flipT));
          lift = Math.sin(Math.PI * b.flipT) * 95 * S;
        }
        /* shadow stays on the pan while the pancake is airborne */
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.scale(1, 0.74);
        ctx.globalAlpha = 0.25 * (1 - lift / (140 * S));
        ell(ctx, 0, 6 * S, b.r * 1.02, b.r * 0.9, '#1a1a20');
        ctx.globalAlpha = 1;
        ctx.restore();
        ctx.save();
        ctx.translate(b.x, b.y - lift);
        const land = b.land || 0;
        ctx.scale(1 + land * 0.1, (0.74 - land * 0.12) * Math.max(sy, 0.06));
        const rise = (1 + b.rise * 0.12);
        /* underside colour peeks around the edge */
        blobPath(ctx, 0, 2 * S, b.r * rise + 5 * S, 0.07, b.seed);
        ctx.fillStyle = bakeColor(clamp(b.bot * 1.05, 0, 1)); ctx.fill();
        /* top surface: browning gradient + blotches + sheen */
        bakeSurface(ctx, () => blobPath(ctx, 0, 0, b.r * rise, 0.07, b.seed),
          0, 0, b.r * rise, b.top, b.seed, { blotches: 6 });
        /* pores from popped bubbles */
        ctx.fillStyle = 'rgba(110,60,15,0.4)';
        for (const po of b.pores) {
          circle(ctx, po.dx * b.r, po.dy * b.r, 2.6 * S);
        }
        ctx.fillStyle = 'rgba(255,240,200,0.25)';
        for (const po of b.pores) {
          circle(ctx, po.dx * b.r - 1 * S, po.dy * b.r - 1 * S, 1.1 * S);
        }
        /* live bubbles — glossy domes */
        for (const bu of b.bub) {
          const k = clamp(bu.age / bu.life, 0, 1);
          const br = bu.r * (0.5 + k * 0.6);
          const bx2 = bu.dx * b.r, by2 = bu.dy * b.r;
          ctx.fillStyle = 'rgba(255,246,220,0.95)';
          circle(ctx, bx2, by2, br);
          ctx.fillStyle = 'rgba(200,150,80,0.3)';
          circle(ctx, bx2, by2 + br * 0.3, br * 0.55);
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          circle(ctx, bx2 - br * 0.3, by2 - br * 0.35, br * 0.3);
        }
        ctx.restore();
      }

      /* ================= step 1 : ingredients ================= */
      let pouring = false;
      const itemsAt = () => {
        const { W, H } = App;
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
          /* shelf board behind the ingredients */
          const shelfY = App.H * 0.24 + 56 * S;
          softShadow(ctx, App.W / 2, shelfY + 12 * S, App.W * 0.42, 10 * S, 0.16);
          clay(ctx, () => rr(ctx, App.W * 0.06, shelfY, App.W * 0.88, 14 * S, 7 * S),
            { x: App.W / 2, y: shelfY + 7 * S, r: 10 * S, base: '#dda86c', gloss: 0 });
          drawBatterBowl(ctx, b.x, b.y, b.r);
          if (!F.flour) drawFlourBag(ctx, it.flour.x, it.flour.y, S);
          if (F.eggStage < 2) drawEggCup(ctx, it.egg.x, it.egg.y, S, F.eggStage);
          if (pouring && App.pointer.down) {
            drawPitcher(ctx, b.x - 60 * S, b.y - b.r - 60 * S, S * 1.15, -0.9);
            drawStream(ctx, b.x - 95 * S, b.y - b.r - 75 * S, b.x - 20 * S, b.y - 20 * S, 10 * S, '#fdfdf6');
          } else {
            drawPitcher(ctx, it.milk.x, it.milk.y, S * 1.15, 0);
          }
        },
        down(p) {
          const S = App.S, it = itemsAt(), b = bowlAt();
          if (!F.flour && dist(p.x, p.y, it.flour.x, it.flour.y) < 70 * S) {
            F.flour = true; Snd.plop();
            flourPuff(sc.parts, b.x, b.y - 20 * S, 14);
            return;
          }
          if (F.eggStage < 2 && dist(p.x, p.y, it.egg.x, it.egg.y) < 70 * S) {
            F.eggStage++;
            if (F.eggStage >= 2) {
              Snd.plop();
              sparkleBurst(sc.parts, b.x, b.y - 30 * S, '#f7b53a', 6);
              for (const d of [-1, 1]) {
                sc.parts.add({
                  x: it.egg.x, y: it.egg.y, color: '#faeed6', r: 12 * S, kind: 'dot',
                  vx: d * rnd(100, 200) * S, vy: -rnd(140, 240) * S, g: 900 * S, life: 0.7
                });
              }
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
            F.air = Math.min(1, F.air + dR * (sp < 8 ? 0.09 : 0.035));
            if (Math.random() < dR * 2) Snd.tick();
          }
          if (sp > 15 && Math.random() < 0.3) {
            const a = rnd(TAU);
            sc.parts.add({
              x: b.x + Math.cos(a) * b.r * 0.7, y: b.y + Math.sin(a) * b.r * 0.45,
              color: '#f6dfa6', r: rnd(3, 6) * App.S,
              vx: Math.cos(a) * rnd(100, 240) * App.S, vy: -rnd(60, 180) * App.S,
              g: 500 * App.S, life: 0.6
            });
            Snd.tick();
          }
        },
        draw(ctx) {
          const b = bowlAt();
          drawMixedBowl(ctx, b.x, b.y, b.r);
          const p = App.pointer;
          if (p.down) {
            /* whisk with motion blur arcs when fast */
            if (stir.speed > 8) {
              ctx.save();
              ctx.globalAlpha = clamp((stir.speed - 8) / 20, 0, 0.35);
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 5 * App.S;
              ctx.beginPath();
              ctx.arc(b.x, b.y, dist(p.x, p.y, b.x, b.y), Math.atan2(p.y - b.y, p.x - b.x) - 0.8, Math.atan2(p.y - b.y, p.x - b.x) - 0.15);
              ctx.stroke();
              ctx.restore();
            }
            drawWhisk(ctx, p.x, p.y, App.S * 1.1, Math.sin(App.time * 6) * 0.15);
          } else drawWhisk(ctx, b.x + b.r * 1.15, b.y - 30 * App.S, App.S, 0.4);
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
            let target = null;
            for (const b of F.blobs) {
              if (dist(p.x, p.y, b.x, b.y) < b.r + 26 * App.S) { target = b; break; }
            }
            if (!target) {
              target = { x: p.x, y: p.y, r: 12 * App.S, seed: rnd(10), top: 0, bot: 0, rise: 0, flipping: false, flipT: 0, flippedOnce: false, land: 0, pores: [], bub: [] };
              F.blobs.push(target);
              Snd.plop();
            }
            const grow = dt * (52 / (0.35 + v)) * App.S;
            const maxR = Math.min(pn.r * 0.62, (150 / v) * App.S * 0.8);
            if (target.r < maxR) target.r += grow;
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
          for (const b of F.blobs) drawBlob(ctx, b);
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
            ell(ctx, bx - 14 * S, by + 2 * S, 12 * S, 5 * S, 'rgba(255,255,255,0.4)');
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
          const pn = panAt();
          for (const b of F.blobs) {
            b.land = Math.max(0, (b.land || 0) - dt * 5);
            if (b.flipping) {
              b.flipT += dt * 2.6;
              if (b.flipT >= 0.5 && !b.swapped) {
                const t = b.top; b.top = b.bot; b.bot = t;
                b.swapped = true; b.flippedOnce = true;
                Snd.plop();
              }
              if (b.flipT >= 1) {
                b.flipping = false; b.flipT = 0; b.swapped = false;
                b.land = 1;
                for (let k = 0; k < 4; k++) {
                  sc.parts.add({
                    x: b.x + rnd(-b.r, b.r) * 0.7, y: b.y + rnd(0, 10) * App.S,
                    kind: 'glow', color: '#ffb054', r: rnd(8, 14) * App.S,
                    vy: -rnd(30, 80) * App.S, life: 0.4, alpha: 0.7
                  });
                }
              }
              continue;
            }
            b.bot = Math.min(1.15, b.bot + dt * 0.085);
            b.rise = Math.min(1, b.rise + dt * F.air * 0.22);
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
                sc.parts.add({
                  x: b.x + bu.dx * b.r, y: b.y + bu.dy * b.r * 0.74,
                  kind: 'ring', color: '#fff6dc', r: 3 * App.S, grow: 60 * App.S, life: 0.3, alpha: 0.8
                });
                if (popCool <= 0) { Snd.pop(); popCool = 0.18; }
              }
            }
            if (Math.random() < dt * 2) steamPuff(sc.parts, b.x, b.y - 20 * App.S);
            /* oil sparks around the rim */
            if (Math.random() < dt * 1.6) {
              const a = rnd(TAU);
              sc.parts.add({
                x: b.x + Math.cos(a) * (b.r + 12 * App.S), y: b.y + Math.sin(a) * (b.r + 12 * App.S) * 0.74,
                kind: 'glow', color: '#ffd070', r: rnd(4, 8) * App.S,
                vx: Math.cos(a) * rnd(30, 90) * App.S, vy: -rnd(40, 110) * App.S,
                g: 300 * App.S, life: rnd(0.25, 0.45), alpha: 0.8
              });
            }
          }
        },
        draw(ctx) {
          const pn = panAt();
          drawStoveTop(ctx, pn.x, pn.y, pn.r);
          drawPan(ctx, pn.x, pn.y, pn.r);
          for (const b of F.blobs) drawBlob(ctx, b);
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
            /* side wall with vertical gradient */
            const g = ctx.createLinearGradient(0, y - b.h, 0, y + 4 * S);
            g.addColorStop(0, mixc(c, '#ffffff', 0.12));
            g.addColorStop(0.6, c);
            g.addColorStop(1, mixc(c, '#5a2c10', 0.32));
            ctx.fillStyle = g;
            rr(ctx, pl.x - b.r, y - b.h, b.r * 2, b.h + 5 * S, b.h * 0.5);
            ctx.fill();
            /* top face */
            const tg = ctx.createRadialGradient(pl.x - b.r * 0.2, y - b.h - 3 * S, b.r * 0.1, pl.x, y - b.h, b.r);
            tg.addColorStop(0, mixc(c, '#ffffff', 0.35));
            tg.addColorStop(1, mixc(c, '#ffffff', 0.12));
            ell(ctx, pl.x, y - b.h, b.r, b.r * 0.26, tg);
            /* browning blotches on the top face */
            ctx.fillStyle = rgba(mixc(c, '#5a2c10', 0.3), 0.35);
            for (let k = 0; k < 5; k++) {
              ell(ctx, pl.x + (n1(b.seed + k * 3) - 0.5) * b.r * 1.3,
                y - b.h + (n1(b.seed + k * 7) - 0.5) * b.r * 0.3,
                b.r * (0.08 + n1(b.seed + k) * 0.09), b.r * 0.035);
            }
            if (i === stack.length - 1) {
              ctx.fillStyle = 'rgba(110,60,15,0.35)';
              for (const po of b.pores) {
                if (Math.abs(po.dy) < 0.8) circle(ctx, pl.x + po.dx * b.r * 0.8, y - b.h + po.dy * b.r * 0.2, 2.4 * S);
              }
            }
            y -= b.h;
          });
          /* butter with a soft melt glow */
          if (F.butter) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.25 + 0.1 * Math.sin(App.time * 3);
            ell(ctx, pl.x, y - 4 * S, 40 * S, 14 * S, '#ffdf90');
            ctx.restore();
            drawButterCube(ctx, pl.x, y - 8 * S, S, 0.25);
          }
          /* syrup trail follows exactly where the finger went */
          if (F.syrup.length > 1) {
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            const trace = () => {
              ctx.beginPath();
              F.syrup.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y));
            };
            ctx.strokeStyle = 'rgba(120,62,10,0.75)'; ctx.lineWidth = 16 * S; trace(); ctx.stroke();
            ctx.strokeStyle = 'rgba(201,120,30,0.95)'; ctx.lineWidth = 11 * S; trace(); ctx.stroke();
            /* drips hanging off the trail */
            ctx.strokeStyle = 'rgba(160,88,18,0.9)'; ctx.lineWidth = 7 * S;
            for (let i = 3; i < F.syrup.length; i += 5) {
              const pt = F.syrup[i];
              const len = (6 + n1(i * 3.1) * 15) * S;
              ctx.beginPath(); ctx.moveTo(pt.x, pt.y); ctx.lineTo(pt.x, pt.y + len); ctx.stroke();
              circle(ctx, pt.x, pt.y + len, 4 * S, 'rgba(160,88,18,0.9)');
            }
            /* glossy light streak */
            ctx.save();
            ctx.translate(-2.5 * S, -2.5 * S);
            ctx.strokeStyle = 'rgba(255,226,170,0.8)'; ctx.lineWidth = 3.5 * S; trace(); ctx.stroke();
            ctx.restore();
          }
          for (const be of F.berries) drawStrawberry(ctx, be.x, be.y, S * be.s);
          /* topping buttons */
          const bb = this.btns();
          clayButton(ctx, bb.butter.x, bb.butter.y, 44 * S, '#ffffff');
          drawButterCube(ctx, bb.butter.x, bb.butter.y, S * 0.9);
          clayButton(ctx, bb.berry.x, bb.berry.y, 44 * S, '#ffffff');
          drawStrawberry(ctx, bb.berry.x, bb.berry.y, S * 0.9);
          /* syrup bottle at finger while dragging */
          const p = App.pointer;
          if (p.down && this.dripping) {
            ctx.save();
            ctx.translate(p.x, p.y - 70 * S);
            ctx.rotate(0.35);
            clay(ctx, () => rr(ctx, -17 * S, -30 * S, 34 * S, 62 * S, 12 * S),
              { x: 0, y: 0, r: 34 * S, base: '#c9803a', bot: '#8a5620', gloss: 0.7, glossX: -7 * S, glossY: -18 * S });
            clay(ctx, () => rr(ctx, -7 * S, -48 * S, 14 * S, 20 * S, 5 * S),
              { x: 0, y: -38 * S, r: 12 * S, base: '#8a5620', gloss: 0 });
            ctx.restore();
            drawStream(ctx, p.x + 12 * S, p.y - 36 * S, p.x, p.y, 6 * S, 'rgba(186,108,20,0.9)');
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
        /* syrup lands on the dish: project the finger point into the plate area */
        syrupPt(p) {
          const pl = plateAt(), S = App.S;
          const top = stackTop();
          const cx = pl.x, cy = (pl.y + top.y) / 2 - 4 * S;
          const rx = Math.min(App.W * 0.36, 215 * S), ry = (pl.y - top.y) / 2 + 26 * S;
          let dx = (p.x - cx) / rx, dy = (p.y - cy) / ry;
          const d = Math.hypot(dx, dy);
          if (d > 1) { dx /= d; dy /= d; }
          return { x: cx + dx * rx, y: cy + dy * ry };
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
          F.syrup.push(this.syrupPt(p));
        },
        move(p) {
          if (this.dripping && F.syrup.length < 220) {
            const pt = this.syrupPt(p);
            const last = F.syrup[F.syrup.length - 1];
            if (!last || dist(pt.x, pt.y, last.x, last.y) > 8 * App.S) F.syrup.push(pt);
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
