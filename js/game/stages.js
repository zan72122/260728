// js/game/stages.js — Agent D
// 発酵(FermentStage)・焼成/揚げ/蒸し(CookStage)の工程シミュレーション。
// DoughModel (Agent A) の公開プロパティ p / bubbles / topping / crackAmount のみに依存する。
// dough.update(dt) 自体は main.js が毎フレーム別途呼ぶ想定。ここでは工程パラメータ(p.ferment 等)を
// 時間経過に応じて書き換え、演出用の bubbles を積み、効果音を鳴らすことに専念する。

import { Sound } from '../audio/sound.js';

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Sound 呼び出しは（Node 環境でのテストや、万一の初期化前呼び出しでも）
// 例外でループを止めないよう常に try/catch する。
function safeSfx(name, opts) {
  try { Sound.sfx(name, opts); } catch (e) { /* 無視: 演出のための音、失敗しても続行 */ }
}
function safeLoop(name) {
  try { Sound.loop(name); } catch (e) {}
}
function safeStopLoop(name) {
  try { Sound.stopLoop(name); } catch (e) {}
}

// 輪郭付近のランダムな一点を返す（dough.points があればそこから、無ければ center 周辺で近似）。
function randomContourPoint(dough) {
  const pts = dough.points;
  if (Array.isArray(pts) && pts.length > 0) {
    const p = pts[(Math.random() * pts.length) | 0];
    if (p && typeof p.x === 'number' && typeof p.y === 'number') {
      return { x: p.x, y: p.y };
    }
  }
  const c = dough.center || { x: 0, y: 0 };
  const r = 60;
  const a = Math.random() * Math.PI * 2;
  return { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
}

// dough.bubbles へ古いものを間引きつつ新しい泡/湯気を追加する（配列自体は使い回す）。
function spawnBubbles(dough, count, { rMin, rMax, lifeMin, lifeMax, jitter, cap }) {
  if (!Array.isArray(dough.bubbles)) return;
  for (let i = 0; i < count; i++) {
    if (dough.bubbles.length >= cap) {
      dough.bubbles.shift(); // 一番古いものから間引く
    }
    const base = randomContourPoint(dough);
    dough.bubbles.push({
      x: base.x + (Math.random() - 0.5) * jitter,
      y: base.y + (Math.random() - 0.5) * jitter,
      r: rMin + Math.random() * (rMax - rMin),
      life: lifeMin + Math.random() * (lifeMax - lifeMin),
    });
  }
}

// 泡/湯気の寿命を減らし、尽きたものを取り除く。renderer 側は life を透明度等に使う想定。
function ageBubbles(dough, dt) {
  const arr = dough.bubbles;
  if (!Array.isArray(arr) || arr.length === 0) return;
  let write = 0;
  for (let read = 0; read < arr.length; read++) {
    const b = arr[read];
    b.life -= dt;
    if (b.life > 0) {
      arr[write++] = b;
    }
  }
  arr.length = write;
}

// ---------------------------------------------------------------------
// FermentStage — 布をかけて発酵させる工程。約20秒で p.ferment を 0→1 へ。
// ---------------------------------------------------------------------
export class FermentStage {
  constructor(dough) {
    this.dough = dough;
    this.duration = 20; // 秒
    this.t = 0;
    this._finished = false;
    this._startAir = dough.p ? dough.p.air : 0;
    this._soundTimer = this._randGap();
  }

  update(dt) {
    if (this._finished) return;
    const p = this.dough.p;
    if (!p) return;

    this.t += dt;
    const frac = clamp01(this.t / this.duration);
    p.ferment = frac;

    // 発酵で少しずつ空気を含んでふくらむ（生地固有の fermentPower があれば反映）
    const fermentPower = this.dough.preset && this.dough.preset.behavior
      ? (typeof this.dough.preset.behavior.fermentPower === 'number' ? this.dough.preset.behavior.fermentPower : 1)
      : 1;
    const airTarget = clamp01(this._startAir + 0.35 * fermentPower);
    p.air = lerp(this._startAir, airTarget, frac);

    // 発酵の呼吸に合わせて、時々こぽっと可愛い音
    this._soundTimer -= dt;
    if (this._soundTimer <= 0) {
      const kind = Math.random() < 0.5 ? 'pop' : 'bubble';
      safeSfx(kind, { rate: 0.85 + Math.random() * 0.3, gain: 0.8 });
      this._soundTimer = this._randGap();
    }

    if (frac >= 1) {
      this._finished = true;
    }
  }

  get progress() {
    return clamp01(this.t / this.duration);
  }

  // 途中で終了しても ferment はそのまま活きる（強制的に 1 にはしない）。
  finish() {
    this._finished = true;
  }

  _randGap() {
    return 1.1 + Math.random() * 1.6; // 1.1〜2.7秒おき
  }
}

// ---------------------------------------------------------------------
// CookStage — オーブン/揚げ鍋/蒸し器。約12秒で完了。
// ---------------------------------------------------------------------
export class CookStage {
  constructor(dough, method) {
    this.dough = dough;
    this.method = method; // 'bake' | 'fry' | 'steam'
    this.duration = 12; // 秒
    this.t = 0;
    this._done = false;
    this._dingPlayed = false;

    const p = dough.p || {};
    this._startBakeColor = typeof p.bakeColor === 'number' ? p.bakeColor : 0;
    this._startCrustHardness = p.crustHardness || 0;
    this._startSoftness = typeof p.softness === 'number' ? p.softness : 0.6;
    this._startElasticity = typeof p.elasticity === 'number' ? p.elasticity : 0.3;
    this._startAir = p.air || 0;
    this._startFerment = p.ferment || 0;
    this._startCrack = dough.crackAmount || 0;
    this._bubbleTimer = 0;

    if (this.method === 'fry') safeLoop('sizzle');
    if (this.method === 'steam') safeLoop('steamloop');
  }

  update(dt) {
    if (this._done) return;
    const p = this.dough.p;
    if (!p) return;

    this.t += dt;
    const frac = clamp01(this.t / this.duration);

    if (this.method === 'bake') this._updateBake(dt, p, frac);
    else if (this.method === 'fry') this._updateFry(dt, p, frac);
    else if (this.method === 'steam') this._updateSteam(dt, p, frac);

    if (frac >= 1 && !this._done) {
      this._finish(p);
    }
  }

  _updateBake(dt, p, frac) {
    // 前半にオーブンスプリング: temperature を素早く立ち上げ、model.js 側の
    // restR 追加成長(ferment×temperature、控えめな係数で漸近)を誘発する。
    // バグ修正(監督QA): 従来 model.js は p.temperature を読んでおらず
    // オーブンスプリングが実質無効だった。model.js 側の係数調整と合わせて
    // ここで立ち上げる値自体は変更していない(0→1、焼成前半45%で到達)。
    const springFrac = clamp01(this.t / (this.duration * 0.45));
    p.temperature = springFrac;

    // 焼き色は工程全体でゆっくり 0→1
    p.bakeColor = frac;

    // 皮が硬く、中がふんわり保たれつつ表面は締まる
    p.crustHardness = clamp01(this._startCrustHardness + (1 - this._startCrustHardness) * frac);
    p.softness = clamp01(this._startSoftness * (1 - 0.6 * frac));

    // 形を固定するため弾力を上げていく
    p.elasticity = clamp01(this._startElasticity + (0.9 - this._startElasticity) * frac);

    // メロンパンの上掛けはひびが少しずつ開く
    const topping = this.dough.topping;
    if (topping && typeof topping.crack === 'number') {
      topping.crack = clamp01(topping.crack + dt / this.duration * 1.3);
    } else if (topping) {
      topping.crack = clamp01(dt / this.duration * 1.3);
    }
  }

  _updateFry(dt, p, frac) {
    p.bakeColor = frac;
    // 揚げ油でふわっと少し膨らむ
    p.air = clamp01(this._startAir + 0.2 * frac);
    p.temperature = clamp01(0.6 + 0.4 * frac);

    // 輪郭周囲に油の泡を少しずつ発生させる
    this._bubbleTimer -= dt;
    if (this._bubbleTimer <= 0) {
      spawnBubbles(this.dough, 1 + (Math.random() < 0.4 ? 1 : 0), {
        rMin: 2.5, rMax: 6, lifeMin: 0.5, lifeMax: 1.1, jitter: 6, cap: 40,
      });
      this._bubbleTimer = 0.09 + Math.random() * 0.08;
    }
    ageBubbles(this.dough, dt);
  }

  _updateSteam(dt, p, frac) {
    // 表面が盛り上がる: air と ferment をさらに底上げして model 側の膨張を誘発
    p.air = clamp01(this._startAir + 0.35 * frac);
    p.ferment = clamp01(this._startFerment + 0.25 * frac);
    p.temperature = clamp01(0.5 + 0.5 * frac);
    // バグ修正(機能QA): 蒸しパンも bakeColor を進めないと焼き上がりの色変化が起きない。
    // 蒸し物は焦がさず「ほんのり色づく」程度に留めるため、0→0.35 までに抑える。
    p.bakeColor = clamp01(this._startBakeColor + 0.35 * frac);

    // 花が開くように表面が少し割れる
    if (typeof this.dough.crackAmount === 'number') {
      this.dough.crackAmount = clamp01(this._startCrack + 0.18 * frac);
    }

    // 立ち上る湯気（renderer が上向きの白い曲線として描く想定の泡データ）
    this._bubbleTimer -= dt;
    if (this._bubbleTimer <= 0) {
      spawnBubbles(this.dough, 1, {
        rMin: 3, rMax: 7, lifeMin: 0.8, lifeMax: 1.6, jitter: 10, cap: 30,
      });
      this._bubbleTimer = 0.22 + Math.random() * 0.18;
    }
    ageBubbles(this.dough, dt);
  }

  _finish(p) {
    this._done = true;

    if (this.method === 'fry') safeStopLoop('sizzle');
    if (this.method === 'steam') safeStopLoop('steamloop');

    // 焼き上がり後は変形しても崩れにくいが、触るとぷにぷに揺れるのは維持
    // (elasticity を高くするが 1 にはせず、揺れ幅を残す)
    p.elasticity = Math.max(p.elasticity || 0, 0.88);

    if (!this._dingPlayed) {
      safeSfx('ding');
      this._dingPlayed = true;
    }
  }

  get progress() {
    return clamp01(this.t / this.duration);
  }

  get done() {
    return this._done;
  }
}
