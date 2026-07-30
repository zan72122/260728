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
let noiseBuf = null;

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

/* ---- ノイズの こえ（爆発・風・打撃のもと） ---- */
function getNoise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function noiseVoice({ dur = 0.5, vol = 0.2, type = 'lowpass', freq = 1000,
                      freqEnd = null, q = 0.7, when = 0, attack = 0.012 }) {
  if (!ctx) return null;
  const t0 = now() + when;
  const src = ctx.createBufferSource();
  src.buffer = getNoise();
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== null) f.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 20), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.1);
  return { src, f, g, t0 };
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

/* ============ UI・きほん こうかおん ============ */

// UI えらぶ
export function sfxSelect() {
  tone({ freq: 660, dur: 0.12, type: 'triangle', vol: 0.18 });
  tone({ freq: 990, dur: 0.14, type: 'triangle', vol: 0.14, when: 0.06 });
}

// そうちを つける：「かちっ♪」
export function sfxPlace() {
  tone({ freq: 520, dur: 0.1, type: 'sine', vol: 0.22, glide: 780 });
  tone({ freq: 1040, dur: 0.16, type: 'sine', vol: 0.1, when: 0.07 });
}

// そうちを はずす
export function sfxUnplace() {
  tone({ freq: 700, dur: 0.12, type: 'sine', vol: 0.16, glide: 380 });
}

// そうちぎれの ぷるぷる
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

/* ============ そうちの おと ============ */

// 💣 どうかせん：シューーッ（ちりちり）
export function sfxFuse(dur = 0.95) {
  noiseVoice({ dur, vol: 0.16, type: 'bandpass', freq: 2600, q: 1.2 });
  noiseVoice({ dur, vol: 0.08, type: 'highpass', freq: 5000, when: 0.03 });
}

// 💣 ばくはつ：ドカーン！（低音の腹 + 破裂 + 高音の飛沫）
export function sfxBomb() {
  noiseVoice({ dur: 0.9, vol: 0.62, type: 'lowpass', freq: 950, freqEnd: 90, q: 0.4 });
  noiseVoice({ dur: 0.16, vol: 0.38, type: 'highpass', freq: 2300, q: 0.4 });
  tone({ freq: 150, glide: 34, dur: 0.85, type: 'sine', vol: 0.55 });
  tone({ freq: 85, glide: 28, dur: 0.55, type: 'triangle', vol: 0.32, when: 0.02 });
  shimmer(0.12, 5, 0.07);
}

// 💨 せんぷうき：ビュオーーッ（うねる風）
export function sfxWind(dur = 3.0) {
  if (!ctx) return;
  const v = noiseVoice({ dur, vol: 0.001, type: 'bandpass', freq: 480, q: 0.8 });
  if (!v) return;
  const { f, g, t0 } = v;
  // ふくらんで おさまる エンベロープ
  g.gain.cancelScheduledValues(t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.34, t0 + 0.5);
  g.gain.setValueAtTime(0.34, t0 + dur - 0.9);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  // 風の うねり
  f.frequency.setValueAtTime(420, t0);
  f.frequency.linearRampToValueAtTime(1050, t0 + dur * 0.45);
  f.frequency.linearRampToValueAtTime(560, t0 + dur);
}

// 🔨 ふりかぶり：ヒュッ
export function sfxWhoosh(dur = 0.34) {
  noiseVoice({ dur, vol: 0.22, type: 'bandpass', freq: 380, freqEnd: 2100, q: 1.4 });
}

// 🔨 めいちゅう：ゴツン！
export function sfxHit() {
  tone({ freq: 115, glide: 48, dur: 0.28, type: 'sine', vol: 0.5 });
  noiseVoice({ dur: 0.12, vol: 0.32, type: 'lowpass', freq: 1500, freqEnd: 250 });
  tone({ freq: 560, dur: 0.08, type: 'triangle', vol: 0.16, when: 0.005 });
}

/* ============ ぶつかり・ごほうび ============ */

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
