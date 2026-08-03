// js/audio/sound.js — Agent D
// 「こねこね！パンの森」効果音モジュール。
// 音声アセット禁止。全て Web Audio API のオシレータ/ノイズバッファ/フィルタ/エンベロープで合成する。
// 4歳児の耳にやさしい、柔らかく可愛い音を目指す（高域の刺さりを避け、常にローパスを通す）。
//
// 契約 (SPEC.md Agent D):
//   export const Sound = {
//     init(), sfx(name, opts={}), loop(name), stopLoop(name), setMuted(bool), muted
//   }

// ---- 内部状態 -------------------------------------------------------------

let ctx = null;              // AudioContext。init() まで生成しない (iOS 自動再生制限対策)
let masterGain = null;       // 全体音量
let compressor = null;       // クリップ防止用コンプレッサ
let noiseBuffer = null;      // 使い回す white noise バッファ (filtered noise の元)

let voices = [];             // 現在再生中の単発ボイス (最大6声制限の管理用)
const MAX_VOICES = 6;

const loops = Object.create(null); // { name: { stop() } } ループ中の音の管理

let mutedFlag = false;

// ---- 初期化 -----------------------------------------------------------

/**
 * 最初のユーザー操作で呼ばれる。AudioContext を生成 (or resume)。
 * 何度呼んでも安全（多重生成しない）。
 */
function init() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return; // Web Audio 非対応環境でも落ちない
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = mutedFlag ? 0 : 0.85;
      compressor = ctx.createDynamicsCompressor();
      // 柔らかめのコンプレッサ設定（6声重なってもクリップしにくい）
      setParam(compressor.threshold, -20);
      setParam(compressor.knee, 24);
      setParam(compressor.ratio, 4);
      setParam(compressor.attack, 0.003);
      setParam(compressor.release, 0.25);
      masterGain.connect(compressor);
      compressor.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') {
      // iOS Safari 等ではユーザー操作起点でしか resume できない
      ctx.resume().catch(() => {});
    }
  } catch (e) {
    // 失敗しても呼び出し側の処理は継続させる
  }
}

function setParam(audioParam, value) {
  if (!audioParam) return;
  if (typeof audioParam.value !== 'undefined') audioParam.value = value;
}

function now() {
  return ctx ? ctx.currentTime : 0;
}

// ---- 共有ノイズバッファ ------------------------------------------------

function getNoiseBuffer() {
  if (!noiseBuffer && ctx) {
    const len = Math.floor(ctx.sampleRate * 2); // 2秒ぶん、ループ再生にも使う
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

function makeNoiseSource(loop) {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer();
  src.loop = !!loop;
  return src;
}

// ---- 出力チェーン共通ヘルパ --------------------------------------------

// 音の最終段を master へ繋ぐ。opts.pan があれば StereoPanner を挟む。
function connectToMaster(node, opts) {
  if (opts && typeof opts.pan === 'number' && ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
    node.connect(panner);
    panner.connect(masterGain);
    return panner;
  }
  node.connect(masterGain);
  return node;
}

// 単発ボイスを最大6声制限つきで登録。durationSec 経過後に自動で管理台帳から外す。
function registerVoice(stopFn, durationSec) {
  if (voices.length >= MAX_VOICES) {
    const oldest = voices.shift();
    try { oldest.stop(); } catch (e) { /* 無視 */ }
  }
  const voice = { stop: stopFn };
  voices.push(voice);
  const ms = Math.max(60, durationSec * 1000 + 60);
  setTimeout(() => {
    const idx = voices.indexOf(voice);
    if (idx >= 0) voices.splice(idx, 1);
  }, ms);
  return voice;
}

// ---- 音色定義 -----------------------------------------------------------
// 各 play*(opts) は t0=now() を基準にノードを組み立て・開始し、
// registerVoice() へ停止関数と長さを渡す。

function baseGain(opts, fallback) {
  const g = opts && typeof opts.gain === 'number' ? opts.gain : 1;
  return fallback * Math.max(0, g);
}

function baseRate(opts) {
  return opts && typeof opts.rate === 'number' && opts.rate > 0 ? opts.rate : 1;
}

// squish: こねる/押す。ぷにっとした低いローパスノイズ + 低い正弦の"ぽふ"
function playSquish(opts) {
  const t0 = now();
  const dur = 0.14;
  const g = baseGain(opts, 0.5);
  const rate = baseRate(opts);

  const noise = makeNoiseSource(false);
  const nf = ctx.createBiquadFilter();
  nf.type = 'lowpass';
  nf.frequency.value = 500 * rate;
  nf.Q.value = 0.6;
  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0, t0);
  nGain.gain.linearRampToValueAtTime(g * 0.5, t0 + 0.006);
  nGain.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  noise.connect(nf); nf.connect(nGain);
  connectToMaster(nGain, opts);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(190 * rate, t0);
  osc.frequency.exponentialRampToValueAtTime(95 * rate, t0 + dur);
  const oGain = ctx.createGain();
  oGain.gain.setValueAtTime(0, t0);
  oGain.gain.linearRampToValueAtTime(g * 0.55, t0 + 0.01);
  oGain.gain.exponentialRampToValueAtTime(0.0008, t0 + dur * 0.95);
  osc.connect(oGain);
  connectToMaster(oGain, opts);

  noise.start(t0); noise.stop(t0 + dur);
  osc.start(t0); osc.stop(t0 + dur);
  registerVoice(() => { try { noise.stop(); osc.stop(); } catch (e) {} }, dur);
}

// stretchy: 伸びる。opts.rate でピッチが伸び量に追従する、ゴムのような滑り音
function playStretchy(opts) {
  const t0 = now();
  const rate = baseRate(opts);
  const dur = 0.28;
  const g = baseGain(opts, 0.35);
  const baseFreq = 260 * rate;

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(baseFreq * 0.75, t0);
  osc.frequency.linearRampToValueAtTime(baseFreq * 1.25, t0 + dur * 0.6);
  osc.frequency.linearRampToValueAtTime(baseFreq * 1.05, t0 + dur);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1400;
  lp.Q.value = 0.4;

  const eg = ctx.createGain();
  eg.gain.setValueAtTime(0, t0);
  eg.gain.linearRampToValueAtTime(g, t0 + 0.03);
  eg.gain.setValueAtTime(g, t0 + dur * 0.6);
  eg.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);

  osc.connect(lp); lp.connect(eg);
  connectToMaster(eg, opts);

  osc.start(t0); osc.stop(t0 + dur);
  registerVoice(() => { try { osc.stop(); } catch (e) {} }, dur);
}

// airout: 空気が抜けるプシュ。フィルタ周波数を高→低へスイープするノイズ
function playAirout(opts) {
  const t0 = now();
  const dur = 0.32;
  const g = baseGain(opts, 0.3);

  const noise = makeNoiseSource(false);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2200, t0);
  bp.frequency.exponentialRampToValueAtTime(280, t0 + dur);
  bp.Q.value = 0.9;

  const eg = ctx.createGain();
  eg.gain.setValueAtTime(0, t0);
  eg.gain.linearRampToValueAtTime(g, t0 + 0.02);
  eg.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);

  noise.connect(bp); bp.connect(eg);
  connectToMaster(eg, opts);

  noise.start(t0); noise.stop(t0 + dur);
  registerVoice(() => { try { noise.stop(); } catch (e) {} }, dur);
}

// pop: 小さな泡ポン。正弦のピッチが素早く落ちるブリップ
function playPop(opts) {
  const t0 = now();
  const dur = 0.1;
  const g = baseGain(opts, 0.4);
  const rate = baseRate(opts);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(620 * rate, t0);
  osc.frequency.exponentialRampToValueAtTime(160 * rate, t0 + dur * 0.85);
  const eg = ctx.createGain();
  eg.gain.setValueAtTime(0, t0);
  eg.gain.linearRampToValueAtTime(g, t0 + 0.006);
  eg.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);
  osc.connect(eg);
  connectToMaster(eg, opts);

  osc.start(t0); osc.stop(t0 + dur);
  registerVoice(() => { try { osc.stop(); } catch (e) {} }, dur);
}

// bubble: 発酵のこぽこぽ。可愛い短いブリップ2つの重ね（一発分）
function playBubble(opts) {
  const t0 = now();
  const dur = 0.16;
  const g = baseGain(opts, 0.3);
  const rate = baseRate(opts);

  [0, 0.05].forEach((delay, i) => {
    const t = t0 + delay;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = (420 + i * 140) * rate;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.09);
    const eg = ctx.createGain();
    eg.gain.setValueAtTime(0, t);
    eg.gain.linearRampToValueAtTime(g * (i === 0 ? 1 : 0.7), t + 0.008);
    eg.gain.exponentialRampToValueAtTime(0.0006, t + 0.1);
    osc.connect(eg);
    connectToMaster(eg, opts);
    osc.start(t); osc.stop(t + 0.11);
  });

  registerVoice(() => {}, dur);
}

// sizzle: 揚げ油のじゅわじゅわ（単発呼び出し用の短縮バージョン）
function playSizzleShot(opts) {
  const t0 = now();
  const dur = 0.35;
  const g = baseGain(opts, 0.22);

  const noise = makeNoiseSource(false);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 900;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4200;
  const eg = ctx.createGain();
  eg.gain.setValueAtTime(0, t0);
  eg.gain.linearRampToValueAtTime(g, t0 + 0.02);
  eg.gain.linearRampToValueAtTime(g * 0.7, t0 + dur * 0.6);
  eg.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);

  noise.connect(hp); hp.connect(lp); lp.connect(eg);
  connectToMaster(eg, opts);
  noise.start(t0); noise.stop(t0 + dur);
  registerVoice(() => { try { noise.stop(); } catch (e) {} }, dur);
}

// steamloop: 蒸気（単発呼び出し用の短縮バージョン）
function playSteamShot(opts) {
  const t0 = now();
  const dur = 0.4;
  const g = baseGain(opts, 0.2);

  const noise = makeNoiseSource(false);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const eg = ctx.createGain();
  eg.gain.setValueAtTime(0, t0);
  eg.gain.linearRampToValueAtTime(g, t0 + 0.05);
  eg.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);

  noise.connect(lp); lp.connect(eg);
  connectToMaster(eg, opts);
  noise.start(t0); noise.stop(t0 + dur);
  registerVoice(() => { try { noise.stop(); } catch (e) {} }, dur);
}

// ding: 焼き上がりチャイム。明るい長短2音 (E5 → G5) のベルのような音
function playDing(opts) {
  const t0 = now();
  const g = baseGain(opts, 0.32);
  const notes = [
    { freq: 659.25, at: 0, dur: 0.55 },   // E5
    { freq: 783.99, at: 0.16, dur: 0.75 } // G5
  ];
  let maxEnd = 0;
  notes.forEach((n) => {
    const t = t0 + n.at;
    maxEnd = Math.max(maxEnd, n.at + n.dur);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = n.freq;
    const osc2 = ctx.createOscillator(); // 倍音でベルっぽい輝きを足す
    osc2.type = 'triangle';
    osc2.frequency.value = n.freq * 2;

    const eg = ctx.createGain();
    eg.gain.setValueAtTime(0, t);
    eg.gain.linearRampToValueAtTime(g, t + 0.012);
    eg.gain.exponentialRampToValueAtTime(0.0005, t + n.dur);
    const eg2 = ctx.createGain();
    eg2.gain.setValueAtTime(0, t);
    eg2.gain.linearRampToValueAtTime(g * 0.18, t + 0.012);
    eg2.gain.exponentialRampToValueAtTime(0.0004, t + n.dur * 0.7);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;

    osc.connect(eg); eg.connect(lp);
    osc2.connect(eg2); eg2.connect(lp);
    connectToMaster(lp, opts);

    osc.start(t); osc.stop(t + n.dur + 0.05);
    osc2.start(t); osc2.stop(t + n.dur + 0.05);
  });
  registerVoice(() => {}, maxEnd);
}

// place: 森に置くぽふっ。squish よりやわらかく短い
function playPlace(opts) {
  const t0 = now();
  const dur = 0.18;
  const g = baseGain(opts, 0.32);

  const noise = makeNoiseSource(false);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 380;
  const nEg = ctx.createGain();
  nEg.gain.setValueAtTime(0, t0);
  nEg.gain.linearRampToValueAtTime(g * 0.5, t0 + 0.01);
  nEg.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);
  noise.connect(lp); lp.connect(nEg);
  connectToMaster(nEg, opts);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(260, t0);
  osc.frequency.exponentialRampToValueAtTime(140, t0 + dur);
  const oEg = ctx.createGain();
  oEg.gain.setValueAtTime(0, t0);
  oEg.gain.linearRampToValueAtTime(g * 0.5, t0 + 0.015);
  oEg.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);
  osc.connect(oEg);
  connectToMaster(oEg, opts);

  noise.start(t0); noise.stop(t0 + dur);
  osc.start(t0); osc.stop(t0 + dur);
  registerVoice(() => { try { noise.stop(); osc.stop(); } catch (e) {} }, dur);
}

// tap: UIタップ。ごく短い柔らかいクリック
function playTap(opts) {
  const t0 = now();
  const dur = 0.05;
  const g = baseGain(opts, 0.22);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 520;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  const eg = ctx.createGain();
  eg.gain.setValueAtTime(0, t0);
  eg.gain.linearRampToValueAtTime(g, t0 + 0.004);
  eg.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);

  osc.connect(lp); lp.connect(eg);
  connectToMaster(eg, opts);
  osc.start(t0); osc.stop(t0 + dur);
  registerVoice(() => { try { osc.stop(); } catch (e) {} }, dur);
}

// sparkle: 完成キラキラ。きらきらアルペジオ（明るい上昇音列）
function playSparkle(opts) {
  const t0 = now();
  const g = baseGain(opts, 0.22);
  const freqs = [1046.5, 1318.5, 1568.0, 2093.0]; // C6 E6 G6 C7
  const step = 0.075;
  let maxEnd = 0;

  freqs.forEach((f, i) => {
    const t = t0 + i * step;
    const noteDur = 0.28;
    maxEnd = Math.max(maxEnd, i * step + noteDur);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = f * 1.005; // わずかなデチューンでキラッと揺らぐ

    const eg = ctx.createGain();
    eg.gain.setValueAtTime(0, t);
    eg.gain.linearRampToValueAtTime(g, t + 0.01);
    eg.gain.exponentialRampToValueAtTime(0.0005, t + noteDur);

    osc.connect(eg); osc2.connect(eg);
    connectToMaster(eg, opts);
    osc.start(t); osc.stop(t + noteDur + 0.02);
    osc2.start(t); osc2.stop(t + noteDur + 0.02);
  });

  // きらめきの粒子感を足すごく薄いハイパスノイズ
  const noise = makeNoiseSource(false);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 4000;
  const nEg = ctx.createGain();
  nEg.gain.setValueAtTime(0, t0);
  nEg.gain.linearRampToValueAtTime(g * 0.12, t0 + 0.02);
  nEg.gain.exponentialRampToValueAtTime(0.0004, t0 + 0.5);
  noise.connect(hp); hp.connect(nEg);
  connectToMaster(nEg, opts);
  noise.start(t0); noise.stop(t0 + 0.5);

  registerVoice(() => { try { noise.stop(); } catch (e) {} }, Math.max(maxEnd, 0.5));
}

const SFX_PLAYERS = {
  squish: playSquish,
  stretchy: playStretchy,
  airout: playAirout,
  pop: playPop,
  bubble: playBubble,
  sizzle: playSizzleShot,
  steamloop: playSteamShot,
  ding: playDing,
  place: playPlace,
  tap: playTap,
  sparkle: playSparkle,
};

// ---- ループ音 -------------------------------------------------------------

function startBubbleLoop(opts) {
  let stopped = false;
  const schedule = () => {
    if (stopped) return;
    playBubble(opts);
    const wait = 260 + Math.random() * 420;
    timerId = setTimeout(schedule, wait);
  };
  let timerId = setTimeout(schedule, 40);
  return {
    stop() {
      stopped = true;
      clearTimeout(timerId);
    }
  };
}

function startNoiseLoop({ filterType, freq, q, gain, ampLfoRate, ampLfoDepth }) {
  const src = makeNoiseSource(true);
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = freq;
  filter.Q.value = q;

  const g = ctx.createGain();
  const t0 = now();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.25);

  src.connect(filter); filter.connect(g);
  connectToMaster(g, {});

  // ゆらぎ用の LFO（じわじわ揺れる音量で単調さを消す）
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = ampLfoRate;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = ampLfoDepth;
  lfo.connect(lfoGain);
  lfoGain.connect(g.gain);
  lfo.start(t0);

  src.start(t0);

  return {
    stop() {
      const tEnd = now();
      try {
        g.gain.cancelScheduledValues(tEnd);
        g.gain.setValueAtTime(g.gain.value, tEnd);
        g.gain.linearRampToValueAtTime(0.0001, tEnd + 0.15);
      } catch (e) {}
      setTimeout(() => {
        try { src.stop(); lfo.stop(); } catch (e) {}
      }, 200);
    }
  };
}

const LOOP_STARTERS = {
  bubble: (opts) => startBubbleLoop(opts),
  sizzle: () => startNoiseLoop({
    filterType: 'bandpass', freq: 2600, q: 0.7, gain: 0.16,
    ampLfoRate: 9, ampLfoDepth: 0.05
  }),
  steamloop: () => startNoiseLoop({
    filterType: 'lowpass', freq: 850, q: 0.5, gain: 0.14,
    ampLfoRate: 0.5, ampLfoDepth: 0.05
  }),
};

// ---- 公開 API ---------------------------------------------------------

export const Sound = {
  init,

  sfx(name, opts = {}) {
    if (mutedFlag) return;
    if (!ctx) return; // init() 前は何もしない（無音で無害）
    const player = SFX_PLAYERS[name];
    if (!player) return;
    try {
      player(opts || {});
    } catch (e) {
      // 音が失敗してもゲームは止めない
    }
  },

  loop(name) {
    if (mutedFlag) return;
    if (!ctx) return;
    if (loops[name]) return; // 既にループ中なら二重起動しない
    const starter = LOOP_STARTERS[name];
    if (!starter) return;
    try {
      loops[name] = starter({});
    } catch (e) {
      // 失敗しても無視
    }
  },

  stopLoop(name) {
    const l = loops[name];
    if (!l) return;
    try { l.stop(); } catch (e) {}
    delete loops[name];
  },

  setMuted(bool) {
    mutedFlag = !!bool;
    Sound.muted = mutedFlag;
    if (ctx && masterGain) {
      const t = now();
      try {
        masterGain.gain.cancelScheduledValues(t);
        masterGain.gain.linearRampToValueAtTime(mutedFlag ? 0 : 0.85, t + 0.05);
      } catch (e) {}
    }
    if (mutedFlag) {
      Object.keys(loops).forEach((name) => Sound.stopLoop(name));
    }
  },

  muted: false,
};
