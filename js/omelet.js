'use strict';
/* ==========================================================
   ふわとろオムレツ
   固有の変身:
   - たまごを割る (トントン…パカッ)
   - 泡立ての速さ → 白身と黄身の混ざり方 + 泡(ふわふわ度)
   - バターを指でなでて溶かす → とけた軌跡が残る
   - 焼きながらかき混ぜる速さ → たまごの粒(カード)の大きさが変わる
     ゆっくり=大きなとろとろ、速い=細かいクリーミー
   - 最後はケチャップで自由にお絵かき (描いた線がそのまま残る)
   ========================================================== */
(function () {

  const def = {
    id: 'omelet',
    color: '#ffe9a8',
    icon(ctx, r) {
      ell(ctx, 0, r * 0.1, r * 0.95, r * 0.6, '#f2b93f');
      ell(ctx, 0, 0, r * 0.9, r * 0.55, '#f7cf5f');
      ell(ctx, -r * 0.25, -r * 0.15, r * 0.3, r * 0.15, 'rgba(255,255,255,0.5)');
      ctx.strokeStyle = '#e8402a'; ctx.lineWidth = r * 0.13; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, r * 0.05);
      ctx.quadraticCurveTo(0, -r * 0.25, r * 0.4, r * 0.05);
      ctx.stroke();
    },

    steps(sc) {
      const F = sc.food;
      F.eggs = [{ crack: 0 }, { crack: 0 }];
      F.mix = 0; F.foam = 0;
      F.butter = 1; F.trail = [];
      F.curds = []; F.cookT = 0; F.foldT = 0;
      F.ketchup = [];

      const bowlAt = () => ({ x: App.W / 2, y: App.H * 0.58, r: Math.min(App.W * 0.32, 180 * App.S) });
      const panAt = () => ({ x: App.W / 2, y: App.H * 0.5, r: Math.min(App.W * 0.4, 210 * App.S) });

      /* ================= step 1 : crack eggs ================= */
      const eggPos = i => ({ x: App.W * (0.3 + i * 0.4), y: App.H * 0.24 });
      const s1 = {
        hint: 'tap',
        hintAt() {
          const i = F.eggs.findIndex(e => e.crack < 3);
          return i >= 0 ? eggPos(i) : { x: App.W / 2, y: App.H / 2 };
        },
        update(dt) {
          for (const e of F.eggs) e.hop = Math.max(0, (e.hop || 0) - dt * 5);
        },
        draw(ctx) {
          const S = App.S, b = bowlAt();
          drawBowl(ctx, b.x, b.y, b.r, '#f2c96b');
          ctx.save(); bowlClip(ctx, b.x, b.y, b.r);
          const bi = bowlInner(b.x, b.y, b.r);
          const nIn = F.eggs.filter(e => e.crack >= 3).length;
          if (nIn > 0) {
            ell(ctx, bi.x, bi.y + bi.ry * 0.15, bi.rx * (0.35 + nIn * 0.25), bi.ry * (0.35 + nIn * 0.22), 'rgba(250,246,230,0.9)');
            for (let i = 0; i < nIn; i++) {
              ell(ctx, bi.x + (i - (nIn - 1) / 2) * 60 * S, bi.y + bi.ry * 0.1, 27 * S, 20 * S, '#f7b53a');
              ell(ctx, bi.x + (i - (nIn - 1) / 2) * 60 * S - 8 * S, bi.y + bi.ry * 0.04, 8 * S, 6 * S, '#fbd57a');
            }
          }
          ctx.restore();
          F.eggs.forEach((e, i) => {
            if (e.crack >= 3) return;
            const p = eggPos(i);
            ctx.save();
            ctx.translate(p.x, p.y - (e.hop || 0) * 16 * S);
            ctx.rotate((e.hop || 0) * 0.2 * (i ? -1 : 1));
            drawEggItem(ctx, 0, 0, S * 1.3, e.crack);
            ctx.restore();
          });
        },
        down(p) {
          const S = App.S, b = bowlAt();
          F.eggs.forEach((e, i) => {
            if (e.crack >= 3) return;
            const ep = eggPos(i);
            if (dist(p.x, p.y, ep.x, ep.y) < 75 * S) {
              e.crack++;
              e.hop = 1;
              if (e.crack >= 3) {
                Snd.plop();
                sparkleBurst(sc.parts, b.x, b.y - 40 * S, '#f7b53a', 6);
                /* shell halves fly off */
                for (const d of [-1, 1]) {
                  sc.parts.add({
                    x: ep.x, y: ep.y, color: '#faeed6', r: 13 * S, kind: 'dot',
                    vx: d * rnd(120, 220) * S, vy: -rnd(150, 260) * S, g: 900 * S, life: 0.8, vr: d * 6
                  });
                }
              } else Snd.crunch();
            }
          });
        },
        done: () => F.eggs.every(e => e.crack >= 3)
      };

      /* ================= step 2 : whisk ================= */
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
            F.mix = Math.min(1, F.mix + dR * 0.11);
            /* fast whisking builds foam = fluffy omelet later */
            if (sp > 9) F.foam = Math.min(1, F.foam + dR * 0.1);
            if (Math.random() < dR * 3) Snd.tick();
          }
        },
        draw(ctx) {
          const S = App.S, b = bowlAt();
          drawBowl(ctx, b.x, b.y, b.r, '#f2c96b');
          ctx.save(); bowlClip(ctx, b.x, b.y, b.r);
          const bi = bowlInner(b.x, b.y, b.r);
          /* base: from marbled white+yolk to uniform yellow */
          ell(ctx, bi.x, bi.y + bi.ry * 0.1, bi.rx * 0.96, bi.ry * 0.9, mixc('#faf3dd', '#f7cd52', F.mix));
          if (F.mix < 0.97) {
            ctx.globalAlpha = (1 - F.mix);
            ctx.lineWidth = 12 * S; ctx.lineCap = 'round';
            for (let i = 0; i < 5; i++) {
              ctx.strokeStyle = i % 2 ? '#f7b53a' : '#fbf6e8';
              const a0 = i * 1.4 + stir.revs * 2;
              ctx.beginPath();
              ctx.arc(bi.x, bi.y, bi.rx * (0.18 + i * 0.15), a0, a0 + 2.4);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }
          /* foam ring */
          const nf = Math.round(F.foam * 22);
          ctx.fillStyle = 'rgba(255,250,230,0.85)';
          for (let i = 0; i < nf; i++) {
            const a = n1(i * 11 + 3) * TAU + App.time * 0.2;
            const rd = (0.55 + n1(i * 7) * 0.35) * bi.rx;
            circle(ctx, bi.x + Math.cos(a) * rd, bi.y + Math.sin(a) * rd * 0.55, (3 + n1(i) * 4.5) * S);
          }
          ctx.restore();
          const p = App.pointer;
          if (p.down) drawWhisk(ctx, p.x, p.y, App.S * 1.1, Math.sin(App.time * 8) * 0.2);
          else drawWhisk(ctx, b.x + b.r * 1.15, b.y - 30 * App.S, App.S, 0.4);
        },
        done: () => F.mix > 0.6
      };

      /* ================= step 3 : melt butter ================= */
      let bx = 0, by = 0, grabbed = false, started = false;
      const s3 = {
        hint: 'drag',
        hintAt() { return { x: bx, y: by }; },
        bgMode: 'stove',
        enter() {
          const pn = panAt();
          bx = pn.x; by = pn.y - 30 * App.S;
          started = true;
          Snd.setSizzle(0.3);
        },
        update(dt) {
          const p = App.pointer, pn = panAt();
          if (grabbed && p.down) {
            const nx = clamp(p.x, pn.x - pn.r * 0.75, pn.x + pn.r * 0.75);
            const ny = clamp(p.y, pn.y - pn.r * 0.5, pn.y + pn.r * 0.5);
            const travel = dist(bx, by, nx, ny);
            bx = nx; by = ny;
            if (travel > 0.5) {
              F.butter = Math.max(0.15, F.butter - travel * 0.0018);
              const last = F.trail[F.trail.length - 1];
              if (!last || dist(bx, by, last.x, last.y) > 12 * App.S) F.trail.push({ x: bx, y: by });
              if (F.trail.length > 120) F.trail.shift();
              if (Math.random() < 0.12) steamPuff(sc.parts, bx, by - 10 * App.S);
            }
          } else grabbed = false;
        },
        draw(ctx) {
          const pn = panAt(), S = App.S;
          drawStoveTop(ctx, pn.x, pn.y, pn.r);
          drawPan(ctx, pn.x, pn.y, pn.r);
          drawHeatMark(ctx, pn.x - pn.r * 1.08, pn.y - pn.r * 0.8, S);
          /* melted shiny film where the butter has been */
          if (F.trail.length > 1) {
            ctx.strokeStyle = 'rgba(250,225,140,0.55)';
            ctx.lineWidth = 46 * S * (1.4 - F.butter);
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath();
            F.trail.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y));
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth = 14 * S;
            ctx.stroke();
          }
          /* the turner pushes the butter around — no bare fingers on a hot pan */
          if (grabbed && App.pointer.down) drawTurner(ctx, bx + 6 * S, by + 10 * S, S, -0.12);
          else drawTurner(ctx, pn.x + pn.r * 1.05, pn.y + pn.r * 0.75, S * 0.92, 0.5);
          drawButterCube(ctx, bx, by, S * 1.1, 1 - F.butter);
        },
        down(p) {
          if (dist(p.x, p.y, bx, by) < 80 * App.S) { grabbed = true; Snd.tick(); }
        },
        up() { grabbed = false; },
        done: () => F.butter < 0.45
      };

      /* ================= step 4 : cook — stirring speed sets curd size ================= */
      let stirDist = 0;
      const s4 = {
        hint: 'stir',
        bgMode: 'stove',
        hintAt() { const pn = panAt(); return { x: pn.x, y: pn.y }; },
        enter() { Snd.setSizzle(0.7); Snd.plop(); },
        update(dt) {
          const p = App.pointer, pn = panAt();
          F.cookT = Math.min(1, F.cookT + dt * 0.055);
          if (p.down && dist(p.x, p.y, pn.x, pn.y) < pn.r * 0.85) {
            const sp = Math.hypot(p.vx, p.vy);
            stirDist += dist(p.px, p.py, p.x, p.y);
            if (stirDist > 26 * App.S && F.curds.length < 90) {
              stirDist = 0;
              /* THE transformation: slow stir = big soft curds, fast = fine creamy */
              const size = lerp(26, 8, clamp(sp / (1400 * App.S), 0, 1)) * App.S;
              F.curds.push({
                x: p.x + rnd(-14, 14) * App.S, y: p.y + rnd(-10, 10) * App.S,
                r: size * rnd(0.8, 1.2), seed: rnd(10), born: F.cookT
              });
              if (Math.random() < 0.4) Snd.tick();
            }
          }
          if (Math.random() < dt * 3) {
            steamPuff(sc.parts, pn.x + rnd(-0.5, 0.5) * pn.r, pn.y - 30 * App.S);
          }
        },
        draw(ctx) {
          const pn = panAt(), S = App.S;
          drawStoveTop(ctx, pn.x, pn.y, pn.r);
          drawPan(ctx, pn.x, pn.y, pn.r);
          /* liquid egg pool; color evenness comes from whisking */
          ctx.save();
          ctx.translate(pn.x, pn.y); ctx.scale(1, 0.72);
          const R = pn.r * 0.72;
          blobPath(ctx, 0, 0, R, 0.05, 2.2);
          ctx.fillStyle = mixc('#f9df8d', '#f2c035', F.cookT * 0.6); ctx.fill();
          if (F.mix < 0.9) {
            /* streaks of unmixed white remain visible while cooking */
            ctx.globalAlpha = (1 - F.mix) * 0.8;
            ctx.strokeStyle = '#fbf3dc'; ctx.lineWidth = 10 * S; ctx.lineCap = 'round';
            for (let i = 0; i < 4; i++) {
              ctx.beginPath();
              ctx.arc(0, 0, R * (0.25 + i * 0.18), i * 1.8, i * 1.8 + 1.6);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }
          ctx.restore();
          /* curds */
          for (const c of F.curds) {
            ctx.save();
            ctx.translate(c.x, c.y); ctx.scale(1, 0.8);
            blobPath(ctx, 0, 0, c.r, 0.22, c.seed);
            ctx.fillStyle = mixc('#f7cf5f', '#eda93c', c.born); ctx.fill();
            ell(ctx, -c.r * 0.25, -c.r * 0.3, c.r * 0.3, c.r * 0.2, 'rgba(255,255,255,0.45)');
            ctx.restore();
          }
          drawHeatMark(ctx, pn.x - pn.r * 1.08, pn.y - pn.r * 0.8, S);
          const p = App.pointer;
          if (p.down) drawSpatula(ctx, p.x, p.y, S, 0.15);
          else drawSpatula(ctx, pn.x + pn.r * 1.05, pn.y + pn.r * 0.72, S * 0.92, 0.5);
        },
        up(p, tap) {
          if (tap) {
            const pn = panAt();
            if (dist(p.x, p.y, pn.x, pn.y) < pn.r * 0.8) Ouch.trigger(p.x, p.y);
          }
        },
        done: () => F.cookT > 0.45 && F.curds.length > 4
      };

      /* ================= step 5 : fold ================= */
      let folding = false;
      const s5 = {
        hint: 'flick',
        bgMode: 'stove',
        hintAt() { const pn = panAt(); return { x: pn.x, y: pn.y }; },
        enter() { Snd.setSizzle(0.35); },
        update(dt) {
          if (folding && F.foldT < 1) {
            F.foldT = Math.min(1, F.foldT + dt * 1.8);
            if (F.foldT >= 1) { Snd.plop(); sparkleBurst(sc.parts, panAt().x, panAt().y, '#ffd94f', 8); }
          }
        },
        draw(ctx) {
          const pn = panAt(), S = App.S, f = F.foldT;
          drawStoveTop(ctx, pn.x, pn.y, pn.r);
          drawPan(ctx, pn.x, pn.y, pn.r);
          ctx.save();
          ctx.translate(pn.x, pn.y);
          const lift = Math.sin(f * Math.PI) * 40 * S;
          ctx.translate(0, -lift);
          ctx.scale(1, 0.72);
          const R = pn.r * 0.72;
          /* fluffier (more foam) = plumper folded omelet */
          const plump = 1 + F.foam * 0.35;
          const rx = R * lerp(1, 0.68, f), ry = R * lerp(1, 0.42 * plump, f);
          const avg = (rx + ry) / 2;
          ctx.save();
          ctx.scale(rx / avg, ry / avg);
          blobPath(ctx, 0, 0, avg, 0.06, 2.2);
          ctx.restore();
          ctx.fillStyle = mixc('#f7cf5f', '#eda93c', 0.3 + F.cookT * 0.3);
          ctx.fill();
          /* seam line while folding */
          if (f > 0.1) {
            ctx.strokeStyle = 'rgba(200,140,40,0.5)'; ctx.lineWidth = 5 * S;
            ctx.beginPath();
            ctx.ellipse(0, ry * 0.25, rx * 0.7, ry * 0.2, 0, 0, Math.PI);
            ctx.stroke();
          }
          /* curds peeking out of the open edge */
          for (let i = 0; i < Math.min(F.curds.length, 10); i++) {
            const c = F.curds[i];
            const a = Math.PI * 0.75 + i * 0.06;
            ctx.save();
            ctx.translate(Math.cos(a) * rx * 0.85, Math.sin(a) * ry * 0.7);
            blobPath(ctx, 0, 0, c.r * 0.8, 0.22, c.seed);
            ctx.fillStyle = '#f7cf5f'; ctx.fill();
            ctx.restore();
          }
          ctx.restore();
          drawHeatMark(ctx, pn.x - pn.r * 1.08, pn.y - pn.r * 0.8, S);
          /* the turner folds the omelet */
          if (folding && F.foldT < 1) {
            drawTurner(ctx, pn.x + pn.r * 0.35 * (1 - F.foldT), pn.y - 30 * S - Math.sin(F.foldT * Math.PI) * 40 * S, S, -0.2, Math.sin(F.foldT * Math.PI) * 0.7);
          } else if (F.foldT < 1) {
            drawTurner(ctx, pn.x + pn.r * 1.05, pn.y + pn.r * 0.75, S * 0.92, 0.5);
          }
        },
        up(p, tap) {
          if (!folding && Math.hypot(p.vx, p.vy) > 550 * App.S) {
            const pn = panAt();
            if (dist(p.downX, p.downY, pn.x, pn.y) < pn.r) {
              folding = true;
              Snd.whoosh();
            }
          } else if (tap) {
            const pn = panAt();
            if (dist(p.x, p.y, pn.x, pn.y) < pn.r * 0.8) Ouch.trigger(p.x, p.y);
          }
        },
        done: () => F.foldT >= 1
      };

      /* ================= step 6 : ketchup drawing (final) ================= */
      let drawing = false;
      const s6 = {
        hint: 'drag',
        hintAt() { return { x: App.W / 2, y: App.H * 0.48 }; },
        hintOpt: { dx: 0.9, dy: 0.3 },
        enter() { confettiBurst(sc.parts); Snd.tada(); },
        draw(ctx) {
          const S = App.S, cx = App.W / 2, cy = App.H * 0.52;
          drawPlate(ctx, cx, cy + 30 * S, Math.min(App.W * 0.44, 260 * S));
          /* the folded omelet — plumpness from foam, color from cook */
          const plump = 1 + F.foam * 0.4;
          const rx = Math.min(App.W * 0.32, 190 * S);
          const ry = Math.min(72 * S * plump, rx * 0.6);
          ctx.save();
          ctx.translate(cx, cy);
          ell(ctx, 0, 14 * S, rx * 1.02, ry * 0.8, 'rgba(140,90,20,0.2)');
          const avg = (rx + ry) / 2;
          ctx.save();
          ctx.scale(rx / avg, ry / avg);
          blobPath(ctx, 0, 0, avg, 0.05, 2.2);
          ctx.restore();
          ctx.fillStyle = mixc('#f7cf5f', '#eda93c', 0.25 + F.cookT * 0.35);
          ctx.fill();
          ell(ctx, -rx * 0.3, -ry * 0.4, rx * 0.25, ry * 0.2, 'rgba(255,255,255,0.5)');
          /* curd texture along the seam */
          for (let i = 0; i < Math.min(F.curds.length, 12); i++) {
            const c = F.curds[i];
            const t = i / 12 - 0.5;
            ctx.save();
            ctx.translate(t * rx * 1.5, ry * 0.55 + Math.abs(t) * ry * 0.2);
            blobPath(ctx, 0, 0, c.r * 0.7, 0.22, c.seed);
            ctx.fillStyle = '#f2c035'; ctx.fill();
            ctx.restore();
          }
          ctx.restore();
          /* ketchup art */
          if (F.ketchup.length > 0) {
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            for (const strokePts of F.ketchup) {
              if (strokePts.length === 1) {
                circle(ctx, strokePts[0].x, strokePts[0].y, 8 * S, '#e8402a');
                continue;
              }
              ctx.strokeStyle = '#e8402a'; ctx.lineWidth = 13 * S;
              ctx.beginPath();
              strokePts.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y));
              ctx.stroke();
              ctx.strokeStyle = '#ff7a5c'; ctx.lineWidth = 5 * S;
              ctx.stroke();
            }
          }
          /* ketchup bottle at finger */
          const p = App.pointer;
          if (p.down && drawing) {
            ctx.save();
            ctx.translate(p.x + 30 * S, p.y - 60 * S); ctx.rotate(2.6);
            ctx.fillStyle = '#e8402a';
            rr(ctx, -18 * S, -40 * S, 36 * S, 72 * S, 14 * S); ctx.fill();
            ctx.fillStyle = '#c22c1a';
            ctx.beginPath();
            ctx.moveTo(-8 * S, 32 * S); ctx.lineTo(8 * S, 32 * S); ctx.lineTo(0, 52 * S);
            ctx.closePath(); ctx.fill();
            ctx.restore();
          }
          drawEndBtns(ctx);
        },
        down(p) {
          if (handleEndBtns(sc, p)) return;
          drawing = true;
          F.ketchup.push([{ x: p.x, y: p.y }]);
          Snd.tick();
        },
        move(p) {
          if (!drawing || F.ketchup.length === 0) return;
          const cur = F.ketchup[F.ketchup.length - 1];
          const last = cur[cur.length - 1];
          if (cur.length < 80 && (!last || dist(p.x, p.y, last.x, last.y) > 7 * App.S)) {
            cur.push({ x: p.x, y: p.y });
          }
        },
        up() { drawing = false; },
        done: () => false
      };

      return [s1, s2, s3, s4, s5, s6];
    }
  };

  DISHES.push(def);
})();
