/* ═══════════════════════════════════════════════════════════
   chamber.js — オブジェクトセル（筒の先の部屋）の物理と描画

   シミュレーションは「筒に固定した座標系」で行う。
   筒を回すと重力ベクトルの向きが変わり、中身がころころ転がる。
   さらに回転の勢い（遠心力）・回し始めの遅れ（オイラー力）も
   感じられるようにして、本物の万華鏡の手ざわりに近づける。
   ═══════════════════════════════════════════════════════════ */
"use strict";

KKM.Chamber = class Chamber {
  constructor() {
    this.R = KKM.CHAMBER_R;
    this.particles = [];
    this.bubbles = [];
    this.liquid = false;
    this.time = 0;
    this.prevOmega = 0;
    this.onClack = null;         // (size 0..1, strength 0..1)
    this.emptying = null;
    this._sparkles = [];         // 強いきらめきの発生位置
    this._focus = { x: 0, y: 60 };  // なかみの重心（なめらかに追いかける）
  }

  /* 鏡のくさびが覗く先：なかみの重心の方向（チャンバー座標） */
  focusAngle() {
    return Math.atan2(this._focus.y, this._focus.x);
  }

  /* ── なかみの管理 ─────────────────────────── */

  weight() {
    let w = 0;
    for (const p of this.particles) w += KKM.MATERIALS[p.type].weight;
    return w;
  }

  fillRatio() { return Math.min(1, this.weight() / KKM.FULL_WEIGHT); }

  isFull() { return this.weight() >= KKM.FULL_WEIGHT; }

  countOf(type) {
    let n = 0;
    for (const p of this.particles) if (p.type === type) n++;
    return n;
  }

  /* ひとすくい注ぐ。上からパラパラ落ちてくる。
     戻り値: 実際に入った個数（満杯なら 0） */
  addScoop(type, tubeAngle = 0) {
    const mat = KKM.MATERIALS[type];
    if (this.isFull()) return 0;
    let added = 0;
    for (let i = 0; i < mat.scoop; i++) {
      if (this.weight() + mat.weight > KKM.FULL_WEIGHT + 6) break;
      // 画面の「上」から降らせる → 筒座標系に変換
      const sx = (Math.random() - 0.5) * this.R * 0.9;
      const sy = -this.R * (1.05 + Math.random() * 0.4);
      const cos = Math.cos(-tubeAngle), sin = Math.sin(-tubeAngle);
      const r = mat.rMin + Math.random() * (mat.rMax - mat.rMin);
      this.particles.push({
        type,
        colorIdx: (Math.random() * mat.colors.length) | 0,
        r,
        x: sx * cos - sy * sin,
        y: sx * sin + sy * cos,
        vx: (Math.random() - 0.5) * 30,
        vy: 0,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 4,
        phase: Math.random() * Math.PI * 2,
        twk: 0.6 + Math.random() * 0.8,   // きらめきの速さ（ラメ用）
        squish: 0,
        drop: true,                        // 入り口では壁判定をゆるく
        dead: false,
        fade: 1,
      });
      added++;
    }
    return added;
  }

  setLiquid(on) {
    this.liquid = on;
    if (on) {
      // あわを湧かせる
      this.bubbles.length = 0;
      const n = 7;
      for (let i = 0; i < n; i++) this.bubbles.push(this._newBubble(true));
      // 中身をふわっと持ち上げる（液を注いだ感じ）
      for (const p of this.particles) {
        p.vx += (Math.random() - 0.5) * 90;
        p.vy -= Math.random() * 130;
        p.vrot += (Math.random() - 0.5) * 5;
      }
    } else {
      this.bubbles.length = 0;
    }
  }

  _newBubble(anywhere) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * this.R * 0.85;
    return {
      x: Math.cos(a) * d,
      y: anywhere ? Math.sin(a) * d : this.R * 0.7,
      r: 1.6 + Math.random() * 3.4,
      vx: 0, vy: 0,
      wob: Math.random() * Math.PI * 2,
    };
  }

  /* ぜんぶ出す（アニメーション付き） */
  empty() {
    if (!this.particles.length) return 0;
    const n = this.particles.length;
    this.emptying = { t: 0 };
    for (const p of this.particles) {
      p.dying = 0.15 + Math.random() * 0.55;   // ばらばらのタイミングでポン
    }
    return n;
  }

  clearNow() {
    this.particles.length = 0;
    this.bubbles.length = 0;
    this.emptying = null;
  }

  shake(strength = 1) {
    for (const p of this.particles) {
      const a = Math.random() * Math.PI * 2;
      const v = (140 + Math.random() * 260) * strength;
      p.vx += Math.cos(a) * v;
      p.vy += Math.sin(a) * v;
      p.vrot += (Math.random() - 0.5) * 14 * strength;
    }
  }

  /* ── 物理ステップ ─────────────────────────── */

  step(dt, gravityWorld, tubeAngle, tubeOmega) {
    dt = Math.min(dt, KKM.PHYSICS.MAX_DT);
    this.time += dt;
    const P = KKM.PHYSICS;
    const sub = P.SUBSTEPS;
    const h = dt / sub;

    // 世界の重力 → 筒座標系へ
    const cos = Math.cos(-tubeAngle), sin = Math.sin(-tubeAngle);
    const gx = gravityWorld.x * cos - gravityWorld.y * sin;
    const gy = gravityWorld.x * sin + gravityWorld.y * cos;

    // 角加速度（回し始め・止めたときに中身が遅れる力）
    const alpha = (tubeOmega - this.prevOmega) / Math.max(dt, 1e-4);
    this.prevOmega = tubeOmega;
    const eulerK = P.EULER_COUPLING * Math.max(-40, Math.min(40, alpha));
    const omClamped = Math.max(-6.5, Math.min(6.5, tubeOmega));
    const centK = P.CENTRIFUGAL * omClamped * omClamped;

    // からっぽアニメーション
    if (this.emptying) {
      this.emptying.t += dt;
      for (const p of this.particles) {
        if (p.dying !== undefined) {
          p.dying -= dt;
          if (p.dying <= 0) p.fade -= dt * 6;
          if (p.fade <= 0) p.dead = true;
        }
      }
      this.particles = this.particles.filter(p => !p.dead);
      if (!this.particles.length) this.emptying = null;
    }

    for (let s = 0; s < sub; s++) {
      this._integrate(h, gx, gy, eulerK, centK, tubeOmega);
      this._collidePairs(h);
      this._collideWall(h);
    }

    this._stepBubbles(dt, gx, gy);
    this._updateSparkles(dt, tubeAngle);

    // なかみの重心をなめらかに追う（視線が模様を見失わないように）
    let fx = 0, fy = 0, wsum = 0;
    for (const p of this.particles) {
      if (p.drop) continue;
      const w = p.r * p.r;
      fx += p.x * w; fy += p.y * w; wsum += w;
    }
    let tx, ty;
    if (wsum > 0) {
      fx /= wsum; fy /= wsum;
      const mag = Math.hypot(fx, fy);
      if (mag > this.R * 0.12) {
        tx = fx; ty = fy;
      } else {
        // なかみが中心に散らばっている：重力の方向を見る
        const gm = Math.hypot(gx, gy) || 1;
        tx = gx / gm * this.R * 0.45; ty = gy / gm * this.R * 0.45;
      }
    } else {
      const gm = Math.hypot(gx, gy) || 1;
      tx = gx / gm * this.R * 0.45; ty = gy / gm * this.R * 0.45;
    }
    const lp = 1 - Math.exp(-3.2 * dt);
    this._focus.x += (tx - this._focus.x) * lp;
    this._focus.y += (ty - this._focus.y) * lp;
  }

  _integrate(h, gx, gy, eulerK, centK, omega) {
    const liquid = this.liquid;
    for (const p of this.particles) {
      const mat = KKM.MATERIALS[p.type];
      const gs = liquid ? mat.liquidGravScale : mat.gravScale;
      let ax = gx * gs;
      let ay = gy * gs;
      // 遠心力：外向き
      ax += p.x * centK;
      ay += p.y * centK;
      // オイラー力：回転の変化に取り残される（接線方向）
      ax += p.y * eulerK;
      ay += -p.x * eulerK;
      // 液体中のラメはゆらゆら漂う
      if (liquid && p.type === "glitter") {
        ax += Math.sin(this.time * 1.4 + p.phase) * 16;
        ay += Math.cos(this.time * 1.1 + p.phase * 1.7) * 16;
      }
      const drag = liquid ? mat.liquidDrag : mat.drag;
      const dampen = Math.exp(-drag * h);
      p.vx = (p.vx + ax * h) * dampen;
      p.vy = (p.vy + ay * h) * dampen;
      p.x += p.vx * h;
      p.y += p.vy * h;
      // 回転：はなびらは落下方向にひらひら
      if (p.type === "petals") {
        p.vrot += Math.sin(this.time * 2.2 + p.phase) * 2.4 * h;
        p.vrot *= Math.exp(-1.1 * h);
      } else {
        p.vrot *= Math.exp(-(liquid ? 2.2 : 0.55) * h);
      }
      p.rot += p.vrot * h;
      // 液中では筒の回転に少し引きずられる（渦）
      if (liquid) {
        const swirl = omega * 0.55;
        const tx = -p.y * swirl, ty = p.x * swirl;
        p.vx += (tx - p.vx) * Math.min(1, 1.9 * h);
        p.vy += (ty - p.vy) * Math.min(1, 1.9 * h);
      }
      p.squish *= Math.exp(-8 * h);
    }
  }

  _collideWall(h) {
    const R = this.R;
    for (const p of this.particles) {
      const lim = R - p.r;
      const d2 = p.x * p.x + p.y * p.y;
      if (d2 > lim * lim) {
        const d = Math.sqrt(d2) || 1e-4;
        if (p.drop && d < R * 1.6) {
          // 落下中は入口（上）から入ってくる余地を残す
          if (d < lim) p.drop = false;
        }
        const nx = p.x / d, ny = p.y / d;
        if (!p.drop) {
          p.x = nx * lim;
          p.y = ny * lim;
        }
        const vn = p.vx * nx + p.vy * ny;
        if (vn > 0 && !p.drop) {
          const mat = KKM.MATERIALS[p.type];
          const rest = this.liquid ? mat.restitution * 0.3 : mat.restitution;
          const vt_x = p.vx - vn * nx, vt_y = p.vy - vn * ny;
          p.vx = vt_x * KKM.PHYSICS.WALL_FRICTION - vn * rest * nx;
          p.vy = vt_y * KKM.PHYSICS.WALL_FRICTION - vn * rest * ny;
          p.vrot += (vt_x * -ny + vt_y * nx) / Math.max(p.r, 2) * 0.4;
          if (vn > 55 && !this.liquid && this.onClack &&
              (p.type === "beads" || p.type === "stars")) {
            const size = (p.r - 6) / 6;
            this.onClack(Math.max(0, Math.min(1, size)), Math.min(1, vn / 320));
            p.squish = Math.min(0.35, vn / 900);
          }
        } else if (p.drop) {
          if (d <= lim) p.drop = false;
        }
      } else if (p.drop) {
        p.drop = false;
      }
    }
  }

  _collidePairs(h) {
    // びーず・おほしさまだけ相互衝突（数が少ないので総当たりで足りる）
    const solids = [];
    for (const p of this.particles) {
      if (KKM.MATERIALS[p.type].collides && !p.drop) solids.push(p);
    }
    const n = solids.length;
    for (let i = 0; i < n; i++) {
      const a = solids[i];
      for (let j = i + 1; j < n; j++) {
        const b = solids[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const rr = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 > rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        const overlap = (rr - d) * 0.5;
        a.x -= nx * overlap; a.y -= ny * overlap;
        b.x += nx * overlap; b.y += ny * overlap;
        const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const rest = this.liquid ? 0.1 : 0.42;
          const imp = -(1 + rest) * vn * 0.5;
          a.vx -= imp * nx; a.vy -= imp * ny;
          b.vx += imp * nx; b.vy += imp * ny;
          if (-vn > 90 && !this.liquid && this.onClack) {
            this.onClack(0.5, Math.min(1, -vn / 420));
          }
        }
      }
    }
  }

  _stepBubbles(dt, gx, gy) {
    if (!this.liquid) return;
    const R = this.R;
    const gmag = Math.hypot(gx, gy) || 1;
    const ux = gx / gmag, uy = gy / gmag;   // 重力の向き（筒座標）
    for (const b of this.bubbles) {
      b.wob += dt * (2 + b.r * 0.4);
      // 浮力：重力の逆向き ＋ ゆらぎ
      b.vx += (-ux * 46 + Math.sin(b.wob) * 14 - b.vx * 1.8) * dt;
      b.vy += (-uy * 46 + Math.cos(b.wob * 0.8) * 14 - b.vy * 1.8) * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // 壁の外・水面まで来たら反対側から湧き直す
      const d = Math.hypot(b.x, b.y);
      if (d > R - b.r - 1) {
        const against = (b.x * ux + b.y * uy) / (d || 1);
        if (against < -0.35) {
          // 上に着いた → 消えて下から湧く
          b.x = ux * R * 0.7 + (Math.random() - 0.5) * R * 0.7;
          b.y = uy * R * 0.7 + (Math.random() - 0.5) * R * 0.7;
          b.vx = b.vy = 0;
          b.r = 1.6 + Math.random() * 3.4;
        } else {
          b.x = b.x / d * (R - b.r - 1);
          b.y = b.y / d * (R - b.r - 1);
        }
      }
    }
  }

  /* きらめきの管理：ラメの向きが「光る角度」を通ったとき */
  _updateSparkles(dt, tubeAngle) {
    for (let i = this._sparkles.length - 1; i >= 0; i--) {
      const s = this._sparkles[i];
      s.life -= dt;
      if (s.life <= 0) this._sparkles.splice(i, 1);
    }
    if (this._sparkles.length >= 4) return;
    // 明るく光っているラメを探す
    for (const p of this.particles) {
      if (p.type !== "glitter") continue;
      const tw = Math.sin(p.rot * 3 + tubeAngle * 2 + p.phase);
      if (tw > 0.992 && Math.random() < 0.25) {
        this._sparkles.push({ x: p.x, y: p.y, life: 0.5, max: 0.5, r: p.r });
        if (this._sparkles.length >= 4) break;
      }
    }
  }

  /* ── 描画 ─────────────────────────────────
     ctx は中心が (0,0)、半径 pixR で描けるよう変換済みで渡す */
  draw(ctx, pixR, tubeAngle, opts = {}) {
    const S = KKM.Sprites;
    const k = pixR / this.R;
    const t = this.time;
    const margin = opts.margin || 1;
    const full = pixR * margin;

    // ── 奥の光（すりガラス越しのあかり） ──
    let bg;
    if (this.liquid) {
      bg = ctx.createRadialGradient(0, 0, pixR * 0.05, 0, 0, full);
      bg.addColorStop(0, "#eefaff");
      bg.addColorStop(0.42, "#cdeaf8");
      bg.addColorStop(0.62 / margin, "#a3cfe8");
      bg.addColorStop(Math.min(1, 1 / margin), "#6d9cc0");
      bg.addColorStop(1, "#48708f");
    } else {
      bg = ctx.createRadialGradient(0, 0, pixR * 0.05, 0, 0, full);
      bg.addColorStop(0, "#fffaea");
      bg.addColorStop(0.42, "#fbeed4");
      bg.addColorStop(0.62 / margin, "#e8d0ae");
      bg.addColorStop(Math.min(1, 1 / margin), "#bd9c78");
      bg.addColorStop(1, "#8f7154");
    }
    ctx.fillStyle = bg;
    ctx.fillRect(-full, -full, full * 2, full * 2);

    // ── ゆっくり動く光斑（コースティック） ──
    ctx.globalCompositeOperation = "screen";
    const blobs = [
      { c: this.liquid ? "#a8d4f0" : "#ffe9c9", s: 1.1, sp: 0.13, ph: 0, al: 0.30 },
      { c: this.liquid ? "#dff6ff" : "#ffd9ee", s: 0.85, sp: -0.09, ph: 2.1, al: 0.26 },
      { c: "#ffffff", s: 0.5, sp: 0.06, ph: 4.2, al: 0.14 },
    ];
    for (const b of blobs) {
      const a = t * b.sp + b.ph + tubeAngle * 0.35;
      const d = pixR * 0.45;
      const x = Math.cos(a) * d, y = Math.sin(a * 0.83) * d;
      const glowSprite = S.get("glow-" + b.c);
      const sz = pixR * b.s;
      ctx.globalAlpha = b.al;
      ctx.drawImage(glowSprite, x - sz / 2, y - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // ── セルの壁（ガラスのふち）と外側の暗がり ──
    if (margin > 1.02) {
      // 壁の外はやわらかく暗く
      const dark = ctx.createRadialGradient(0, 0, pixR * 0.985, 0, 0, full);
      dark.addColorStop(0, "rgba(52, 34, 20, 0)");
      dark.addColorStop(0.35, "rgba(52, 34, 20, .18)");
      dark.addColorStop(1, "rgba(30, 18, 10, .42)");
      ctx.fillStyle = dark;
      ctx.fillRect(-full, -full, full * 2, full * 2);
      // 壁のガラスエッジ：ほのかな線＋内側の反射ハイライト
      ctx.strokeStyle = "rgba(70, 45, 22, .26)";
      ctx.lineWidth = pixR * 0.014;
      ctx.beginPath(); ctx.arc(0, 0, pixR * 1.004, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "rgba(255, 250, 235, .3)";
      ctx.lineWidth = pixR * 0.008;
      ctx.beginPath(); ctx.arc(0, 0, pixR * 0.988, 0, Math.PI * 2); ctx.stroke();
    }

    // ── 粒の影（やわらかい接地感） ──
    ctx.fillStyle = "rgba(112, 76, 40, .16)";
    for (const p of this.particles) {
      if (p.type === "glitter") continue;
      ctx.beginPath();
      ctx.ellipse(p.x * k + p.r * k * 0.16, p.y * k + p.r * k * 0.22,
                  p.r * k * 1.02, p.r * k * 0.92, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── 粒本体：はなびら → おほし → びーず → ラメの順 ──
    const order = { petals: 0, stars: 1, beads: 2, glitter: 3 };
    const sorted = this.particles.slice().sort((a, b) => order[a.type] - order[b.type]);
    for (const p of sorted) {
      const spr = S.get(p.type, p.colorIdx);
      const size = p.r * 2 * k;
      ctx.save();
      ctx.translate(p.x * k, p.y * k);
      ctx.globalAlpha = Math.max(0, Math.min(1, p.fade));
      if (p.type === "glitter") {
        // 角度で明滅するホログラム
        const tw = Math.sin(p.rot * 3 + tubeAngle * 2 + p.phase);
        const bright = 0.55 + 0.45 * tw;
        ctx.rotate(p.rot);
        ctx.globalAlpha *= 0.65 + bright * 0.35;
        ctx.drawImage(spr, -size / 2, -size / 2, size, size);
        if (tw > 0.86) {
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = (tw - 0.86) / 0.14 * 0.9;
          const fs = size * 3.2;
          ctx.drawImage(S.get("flare"), -fs / 2, -fs / 2, fs, fs);
        }
      } else {
        ctx.rotate(p.type === "beads" ? p.rot * 0.15 : p.rot);
        const sq = 1 + p.squish;
        ctx.scale(sq, 1 / sq);
        ctx.drawImage(spr, -size / 2, -size / 2, size, size);
      }
      ctx.restore();
    }

    // ── あわ ──
    if (this.liquid) {
      const bspr = S.get("bubble");
      for (const b of this.bubbles) {
        const size = b.r * 2 * k;
        ctx.globalAlpha = 0.85;
        ctx.drawImage(bspr, b.x * k - size / 2, b.y * k - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    }

    // ── 強いきらめきフレア ──
    ctx.globalCompositeOperation = "lighter";
    for (const s of this._sparkles) {
      const a = Math.sin((s.life / s.max) * Math.PI);
      const fs = s.r * 14 * k * (0.6 + a * 0.4);
      ctx.globalAlpha = a * 0.85;
      ctx.drawImage(S.get("flare"), s.x * k - fs / 2, s.y * k - fs / 2, fs, fs);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    return this._sparkles.length > 0;
  }

  /* レシピの保存/復元 */
  serialize() {
    return {
      liquid: this.liquid,
      particles: this.particles.map(p => ({
        t: p.type, c: p.colorIdx, r: +p.r.toFixed(1),
        x: +p.x.toFixed(1), y: +p.y.toFixed(1),
      })),
    };
  }

  restore(data) {
    this.clearNow();
    if (!data) return false;
    try {
      for (const q of data.particles || []) {
        const mat = KKM.MATERIALS[q.t];
        if (!mat) continue;
        this.particles.push({
          type: q.t, colorIdx: Math.min(q.c | 0, mat.colors.length - 1),
          r: Math.max(mat.rMin, Math.min(mat.rMax, q.r)),
          x: q.x, y: q.y, vx: 0, vy: 0,
          rot: Math.random() * Math.PI * 2, vrot: 0,
          phase: Math.random() * Math.PI * 2,
          twk: 0.6 + Math.random() * 0.8,
          squish: 0, drop: false, dead: false, fade: 1,
        });
      }
      this.setLiquid(!!data.liquid);
      return this.particles.length > 0;
    } catch (e) { return false; }
  }
};
