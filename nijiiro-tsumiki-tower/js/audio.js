/* ============================================================
   audio.js — おとの もじゅーる
   すべて WebAudio で合成（音源ファイル不要）。
   iOS では最初のタッチで unlock() を呼ぶこと。
   ============================================================ */

let ctx = null;
let master = null;
let musicGain = null;
let muted = false;
let musicTimer = null;

const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]; // C5 ペンタトニック

function now() { return ctx ? ctx.currentTime : 0; }

export function unlock() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.055;
    musicGain.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 1, now(), 0.05);
}
export function isMuted() { return muted; }

/* ---- 基本の こえ：おんさ ---- */
function tone({ freq = 440, dur = 0.3, type = 'triangle', vol = 0.2,
                when = 0, glide = null, out = null }) {
  if (!ctx) return;
  const t0 = now() + when;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glide !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(glide, 1), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(out || master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/* ---- しゃらしゃら（きらきら） ---- */
function shimmer(when = 0, count = 6, baseVol = 0.08) {
  for (let i = 0; i < count; i++) {
    tone({
      freq: 1400 + Math.random() * 2200,
      dur: 0.25 + Math.random() * 0.2,
      type: 'sine',
      vol: baseVol * (0.5 + Math.random() * 0.5),
      when: when + i * 0.05,
    });
  }
}

/* ============ こうかおん ============ */

// UI えらぶ
export function sfxSelect() {
  tone({ freq: 660, dur: 0.12, type: 'triangle', vol: 0.18 });
  tone({ freq: 990, dur: 0.14, type: 'triangle', vol: 0.14, when: 0.06 });
}

// シールを はる：「ぺたっ♪」
export function sfxPlace() {
  tone({ freq: 520, dur: 0.1, type: 'sine', vol: 0.22, glide: 780 });
  tone({ freq: 1040, dur: 0.16, type: 'sine', vol: 0.1, when: 0.07 });
}

// シールを はがす
export function sfxUnplace() {
  tone({ freq: 700, dur: 0.12, type: 'sine', vol: 0.16, glide: 380 });
}

// シールぎれの ぷるぷる
export function sfxNope() {
  tone({ freq: 300, dur: 0.09, type: 'sine', vol: 0.14 });
  tone({ freq: 300, dur: 0.09, type: 'sine', vol: 0.14, when: 0.11 });
}

// ぽんスイッチ + どきどきロール
export function sfxSwitch() {
  tone({ freq: 240, dur: 0.25, type: 'square', vol: 0.1, glide: 120 });
  for (let i = 0; i < 8; i++) {
    tone({ freq: 190 + i * 6, dur: 0.06, type: 'triangle', vol: 0.07, when: 0.15 + i * 0.07 });
  }
}

// ⭐ ほし：ぽんっ + きらきら
export function sfxStar() {
  tone({ freq: 500, dur: 0.18, type: 'triangle', vol: 0.3, glide: 1500 });
  shimmer(0.05, 7, 0.09);
}

// 💗 はーと：ふわ〜（うえに ただよう）
export function sfxHeart() {
  tone({ freq: 320, dur: 0.7, type: 'sine', vol: 0.22, glide: 900 });
  tone({ freq: 480, dur: 0.7, type: 'sine', vol: 0.12, glide: 1350, when: 0.08 });
}

// 💗 はーとが そらで ぱちん
export function sfxHeartPop() {
  tone({ freq: 900, dur: 0.12, type: 'sine', vol: 0.2, glide: 1800 });
  shimmer(0.03, 4, 0.07);
}

// 🌈 にじ：つるん〜（すべりだい）
export function sfxRainbow() {
  tone({ freq: 1200, dur: 0.55, type: 'sine', vol: 0.22, glide: 350 });
  tone({ freq: 1800, dur: 0.4, type: 'sine', vol: 0.08, glide: 600, when: 0.06 });
}

// つみきの がっき音（衝突）— ペンタトニックの もっきん
let lastPlink = 0;
let plinkCount = 0;
export function sfxPlink(strength) {
  if (!ctx) return;
  const t = ctx.currentTime;
  if (t - lastPlink > 0.4) plinkCount = 0;
  if (plinkCount > 10) return;           // うるさくなりすぎ防止
  lastPlink = t; plinkCount++;
  const f = PENTA[Math.floor(Math.random() * PENTA.length)] / 2;
  const vol = Math.min(0.16, 0.03 + strength * 0.02);
  tone({ freq: f, dur: 0.22, type: 'triangle', vol });
  tone({ freq: f * 2, dur: 0.12, type: 'sine', vol: vol * 0.4 });
}

// おそうじぽん（コンボで おんかい が あがる）
export function sfxPop(combo) {
  const f = PENTA[Math.min(combo, PENTA.length - 1)];
  tone({ freq: f, dur: 0.18, type: 'triangle', vol: 0.26 });
  tone({ freq: f * 1.5, dur: 0.22, type: 'sine', vol: 0.1, when: 0.03 });
}

// つみきが ぽこぽこ たつ（ステージ生成）
export function sfxBuildTick(i) {
  const f = 300 + (i % 14) * 40;
  tone({ freq: f, dur: 0.09, type: 'triangle', vol: 0.08 });
}

// けっかの ファンファーレ
export function sfxFanfare(stars) {
  const seq = [[0, 2, 4], [0, 2, 4, 5], [0, 2, 4, 5, 5]][Math.max(0, stars - 1)] || [0, 2];
  seq.forEach((n, i) => {
    tone({ freq: PENTA[n], dur: 0.4, type: 'triangle', vol: 0.24, when: i * 0.16 });
    tone({ freq: PENTA[n] * 2, dur: 0.3, type: 'sine', vol: 0.1, when: i * 0.16 + 0.02 });
  });
  if (stars >= 3) shimmer(seq.length * 0.16, 10, 0.1);
}

// メーターの ふしめ
export function sfxMeterTick(level) {
  tone({ freq: PENTA[Math.min(level, PENTA.length - 1)] * 2, dur: 0.15, type: 'sine', vol: 0.12 });
}

/* ============ オルゴール BGM ============ */
const MELODY = [0, 2, 4, 2, 5, 4, 2, 0, 1, 3, 5, 3, 4, 2, 1, 0];
let melodyPos = 0;

export function startMusic() {
  if (!ctx || musicTimer) return;
  const stepDur = 0.55;
  let nextTime = ctx.currentTime + 0.1;
  musicTimer = setInterval(() => {
    if (!ctx || muted) { nextTime = ctx ? ctx.currentTime + 0.1 : 0; return; }
    while (nextTime < ctx.currentTime + 1.2) {
      const step = MELODY[melodyPos % MELODY.length];
      melodyPos++;
      // ときどき おやすみ で ゆったり
      if (melodyPos % 8 !== 7) {
        tone({ freq: PENTA[step], dur: 1.1, type: 'sine',
               vol: 0.5, when: nextTime - ctx.currentTime, out: musicGain });
        tone({ freq: PENTA[step] * 2, dur: 0.8, type: 'sine',
               vol: 0.18, when: nextTime - ctx.currentTime + 0.01, out: musicGain });
      }
      // ひくい ハーモニー
      if (melodyPos % 4 === 1) {
        tone({ freq: PENTA[step] / 2, dur: 1.6, type: 'sine',
               vol: 0.3, when: nextTime - ctx.currentTime, out: musicGain });
      }
      nextTime += stepDur;
    }
  }, 250);
}
