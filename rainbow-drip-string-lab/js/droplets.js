// しずくの物理。ゲームの一番大切な部分。
// 状態は2つ: 'fall'(空中を落下) / 'string'(紐の上を滑走)。
// 紐の上では接線方向の重力成分で加速し、低い所に集まり、
// 合体して育ち、重くなりすぎるとぽたっと滴下する。

import { CONFIG } from './config.js';
import { mixRyb, rybToRgb, rgbCss, shade, rainbowRyb } from './color.js';
import { sounds } from './audio.js';

let nextDropId = 1;

export class Droplet {
  constructor(x, y, ryb, opts = {}) {
    this.id = nextDropId++;
    this.x = x;
    this.y = y;
    this.vx = opts.vx ?? 0;
    this.vy = opts.vy ?? 0;
    this.vol = opts.vol ?? CONFIG.DROP_BASE_VOL;
    this.ryb = ryb ? ryb.slice() : [0, 0, 1];
    this.rainbow = opts.rainbow ?? false;
    this.rainbowPhase = Math.random();
    this.state = 'fall';
    this.rope = null;
    this.t = 0;    // 紐上のパラメータ 0..1
    this.s = 0;    // 紐上の速度(px/s, +t 方向が正)
    this.age = 0;
    // 滴下・端から落下した直後に同じ紐へ即再付着しないためのクールダウン
    this.avoidRope = null;
    this.avoidTimer = 0;
  }

  get r() {
    return CONFIG.DROP_RADIUS_K * Math.cbrt(this.vol);
  }

  /** 虹しずくは時間で色が移ろう */
  currentRyb(time) {
    return this.rainbow ? rainbowRyb(time * 0.4 + this.rainbowPhase) : this.ryb;
  }
}

export class DropletSystem {
  constructor(world) {
    this.world = world;
    this.items = [];
  }

  spawn(x, y, ryb, opts = {}) {
    const d = new Droplet(x, y, ryb, opts);
    this.items.push(d);
    this._enforceCap();
    return d;
  }

  /** 上限を超えたら、古く小さいしずくから静かに消す */
  _enforceCap() {
    while (this.items.length > CONFIG.MAX_DROPLETS) {
      let idx = 0;
      let score = Infinity;
      for (let i = 0; i < this.items.length; i++) {
        const d = this.items[i];
        const s = d.vol - d.age * 0.2; // 小さくて古いものほど低スコア
        if (s < score) { score = s; idx = i; }
      }
      this.items.splice(idx, 1);
    }
  }

  /** 紐が消されたとき、乗っていたしずくを落下状態に戻す */
  releaseRope(rope) {
    for (const d of this.items) {
      if (d.state === 'string' && d.rope === rope) {
        this._detach(d);
      }
    }
  }

  _detach(d) {
    if (d.rope) {
      d.avoidRope = d.rope;
      d.avoidTimer = 0.3;
      const p = d.rope.pointAt(Math.min(1, Math.max(0, d.t)));
      const dir = d.rope.derivAt(Math.min(1, Math.max(0, d.t)));
      const len = Math.hypot(dir.x, dir.y) || 1;
      d.x = p.x;
      d.y = p.y;
      // 横方向の勢いは弱める(端から飛びすぎず、すぐ下のカップに入るように)
      d.vx = (dir.x / len) * d.s * 0.35;
      d.vy = Math.max(0, (dir.y / len) * d.s);
    }
    d.state = 'fall';
    d.rope = null;
    d.s = 0;
  }

  update(dt, time) {
    const removed = new Set();

    for (const d of this.items) {
      d.age += dt;
      if (d.state === 'fall') {
        this._updateFall(d, dt, removed);
      } else {
        this._updateOnString(d, dt);
      }
    }
    if (removed.size) this.items = this.items.filter((d) => !removed.has(d));

    this._mergeOnStrings(time);
    this._dripFromOverload();
  }

  _updateFall(d, dt, removed) {
    const world = this.world;
    const prevY = d.y;
    d.vy += CONFIG.GRAVITY * dt;
    d.vx *= 1 / (1 + CONFIG.DROP_AIR_DRAG * dt);
    d.x += d.vx * dt;
    d.y += d.vy * dt;

    // 画面外(左右)は消す
    if (d.x < -40 || d.x > world.width + 40) {
      removed.add(d);
      return;
    }

    // 紐への付着(下向きに動いている間だけ)。
    // 高速落下でもすり抜けないよう、1フレームの移動量ぶん判定を広げる。
    if (d.vy > 0) {
      if (d.avoidTimer > 0) d.avoidTimer -= dt;
      const hitDist = CONFIG.STRING_HIT_DIST + d.r * 0.4 + d.vy * dt * 0.6;
      let best = null;
      for (const rope of world.ropes) {
        if (d.avoidTimer > 0 && rope === d.avoidRope) continue;
        const n = rope.nearest(d.x, d.y);
        if (n.dist < hitDist) {
          if (!best || n.dist < best.dist) best = { rope, ...n };
        }
      }
      if (best) {
        this._attach(d, best.rope, best.t);
        return;
      }
    }

    // 反応オブジェクト(カップ・スポンジ等)への着地
    if (world.tryCatch(d, prevY)) {
      removed.add(d);
      return;
    }

    // 床に着いた: 花・紙・水たまりなどの反応は world 側で処理
    if (d.y + d.r >= world.groundY) {
      world.onFloorHit(d);
      removed.add(d);
    }
  }

  _attach(d, rope, t) {
    d.state = 'string';
    d.rope = rope;
    d.t = Math.min(1, Math.max(0, t));
    const dir = rope.derivAt(d.t);
    const len = Math.hypot(dir.x, dir.y) || 1;
    // 落下速度の接線成分を引き継ぐ
    d.s = (d.vx * dir.x + d.vy * dir.y) / len * 0.55;
    rope.excite(Math.min(0.8, d.vol * 0.35));
    rope.wet = Math.min(1, rope.wet + 0.25);
    rope.wetRyb = mixRyb(rope.wetRyb, 2, d.currentRyb(0), d.vol);
    this.world.particles.splash(d.x, d.y, d.currentRyb(0), d.vol * 0.5);
    sounds.splash(d.vol * 0.5);
  }

  _updateOnString(d, dt) {
    const rope = d.rope;
    if (!rope || !this.world.ropes.includes(rope)) {
      this._detach(d);
      return;
    }
    rope.load += d.vol;
    rope.wet = Math.min(1, rope.wet + dt * 0.1);

    const dir = rope.derivAt(d.t);
    const len = Math.hypot(dir.x, dir.y) || 1;
    // 接線方向の重力成分(y+ が下向きなので dir.y>0 なら +t が下り)
    const accel = CONFIG.STRING_GRAVITY * (dir.y / len);
    d.s += accel * dt;
    d.s *= 1 / (1 + CONFIG.STRING_FRICTION * dt);
    d.t += (d.s * dt) / len;

    // 端に到達 → ピンの先からぽとり
    if (d.t <= 0 || d.t >= 1) {
      d.t = Math.min(1, Math.max(0, d.t));
      this._detach(d);
      sounds.plop(d.vol);
      return;
    }

    const p = rope.pointAt(d.t);
    d.x = p.x;
    d.y = p.y;
  }

  /** 同じ紐の上で近づいたしずくを合体させる */
  _mergeOnStrings(time) {
    const byRope = new Map();
    for (const d of this.items) {
      if (d.state !== 'string') continue;
      if (!byRope.has(d.rope)) byRope.set(d.rope, []);
      byRope.get(d.rope).push(d);
    }
    const dead = new Set();
    for (const [rope, list] of byRope) {
      list.sort((a, b) => a.t - b.t);
      for (let i = 0; i + 1 < list.length; i++) {
        const a = list[i];
        const b = list[i + 1];
        if (dead.has(a) || dead.has(b)) continue;
        const gap = Math.abs(b.t - a.t) * (rope.length || 1);
        if (gap < (a.r + b.r) * CONFIG.DROP_MERGE_DIST * 0.6) {
          // b を a に吸収(大きい方を残す)
          const [big, small] = a.vol >= b.vol ? [a, b] : [b, a];
          big.ryb = mixRyb(big.currentRyb(time), big.vol, small.currentRyb(time), small.vol);
          big.rainbow = big.rainbow && small.rainbow;
          big.t = (big.t * big.vol + small.t * small.vol) / (big.vol + small.vol);
          big.s = (big.s * big.vol + small.s * small.vol) / (big.vol + small.vol);
          big.vol += small.vol;
          dead.add(small);
          rope.excite(0.25);
        }
      }
    }
    if (dead.size) this.items = this.items.filter((d) => !dead.has(d));
  }

  /** 重くなりすぎたしずくは、低い所から一部が滴下する */
  _dripFromOverload() {
    const spawned = [];
    for (const d of this.items) {
      if (d.state !== 'string') continue;
      if (d.vol <= CONFIG.DROP_MAX_VOL_ON_STRING) continue;
      // 水は「たわみのいちばん低い所」から落ちる。塊が低い所の近くで
      // ゆっくりしているときに、最低点から滴下させる(降雨中の到着運動量で
      // 塊が最低点から少し押されていても、滴下位置は安定する)。
      const low = d.rope.lowestPoint();
      const nearLow = Math.hypot(d.x - low.x, d.y - low.y) < Math.max(60, d.r * 3);
      if (nearLow && Math.abs(d.s) < 80) {
        const part = d.vol * 0.45;
        d.vol -= part;
        const nd = new Droplet(low.x, low.y + d.r + 2, d.ryb, {
          vol: part,
          vy: 30,
          rainbow: d.rainbow,
        });
        nd.avoidRope = d.rope;
        nd.avoidTimer = 0.35;
        spawned.push(nd);
        d.rope.excite(0.3);
        sounds.plop(part);
      }
    }
    if (spawned.length) {
      this.items.push(...spawned);
      this._enforceCap();
    }
  }

  draw(ctx, time) {
    for (const d of this.items) {
      const rgb = rybToRgb(d.currentRyb(time));
      if (d.state === 'fall') {
        this._drawFalling(ctx, d, rgb);
      } else {
        this._drawOnString(ctx, d, rgb, time);
      }
    }
  }

  _drawFalling(ctx, d, rgb) {
    // 速度でしずく型に伸びる
    const stretch = 1 + Math.min(0.4, Math.abs(d.vy) / 1100);
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.scale(1 / stretch, stretch);
    this._blob(ctx, d.r, rgb, d.rainbow);
    ctx.restore();
  }

  _drawOnString(ctx, d, rgb, time) {
    // 低い所でぷるぷる待つときの揺れ
    const settled = Math.abs(d.s) < 40;
    const wob = settled ? Math.sin(time * 8 + d.id) * 0.06 : 0;
    ctx.save();
    ctx.translate(d.x, d.y + d.r * 0.45); // 紐からぶら下がって見えるように
    ctx.scale(1.1 + wob, 0.95 - wob);
    this._blob(ctx, d.r, rgb, d.rainbow);
    ctx.restore();
  }

  /** つやつやのしずく本体 */
  _blob(ctx, r, rgb, rainbow) {
    const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.05);
    grad.addColorStop(0, rgbCss(shade(rgb, 0.55), 0.95));
    grad.addColorStop(0.55, rgbCss(rgb, 0.92));
    grad.addColorStop(1, rgbCss(shade(rgb, -0.18), 0.9));
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    // ハイライト
    ctx.beginPath();
    ctx.ellipse(-r * 0.32, -r * 0.4, r * 0.26, r * 0.16, -0.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fill();
    if (rainbow) {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}
