/* audio.js — Web Audio 合成による効果音とBGM（外部ファイルなし） */
(function () {
  'use strict';

  const audio = {
    ctx: null,
    master: null,
    sfxGain: null,
    bgmGain: null,
    muted: false,
    bgmTimer: null,
    bgmStep: 0,
    bgmNextTime: 0,
  };

  function ensureCtx() {
    if (!audio.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      audio.ctx = new AC();
      audio.master = audio.ctx.createGain();
      audio.master.connect(audio.ctx.destination);
      audio.sfxGain = audio.ctx.createGain();
      audio.sfxGain.gain.value = 0.85;
      audio.sfxGain.connect(audio.master);
      audio.bgmGain = audio.ctx.createGain();
      audio.bgmGain.gain.value = 0.10;
      audio.bgmGain.connect(audio.master);
      applyMute();
    }
    return true;
  }

  function applyMute() {
    if (audio.master) audio.master.gain.value = audio.muted ? 0 : 1;
  }

  /* iOSでは最初のユーザー操作で resume が必要 */
  audio.unlock = function () {
    if (!ensureCtx()) return;
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
  };

  audio.setMuted = function (m) {
    audio.muted = m;
    try { localStorage.setItem('demol_muted', m ? '1' : '0'); } catch (e) {}
    applyMute();
  };
  try { audio.muted = localStorage.getItem('demol_muted') === '1'; } catch (e) {}

  function osc(type, freq, t0, dur, vol, dest, freqEnd) {
    const ctx = audio.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(dest || audio.sfxGain);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  let noiseBuf = null;
  function noise(t0, dur, vol, filterFreq) {
    const ctx = audio.ctx;
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(filterFreq, t0);
    f.frequency.exponentialRampToValueAtTime(120, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(audio.sfxGain);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  const sfx = {
    tap(t) { osc('sine', 660, t, 0.09, 0.3, null, 880); },
    pop(t) { osc('sine', 300, t, 0.12, 0.4, null, 620); osc('triangle', 900, t + 0.02, 0.08, 0.2); },
    fuse(t) {
      for (let i = 0; i < 6; i++) osc('square', 1800 + Math.random() * 600, t + i * 0.1, 0.05, 0.06);
    },
    boom(t) {
      noise(t, 0.9, 0.9, 900);
      osc('sine', 90, t, 0.6, 0.9, null, 35);
      osc('sine', 55, t + 0.05, 0.8, 0.7, null, 28);
    },
    thud(t) { noise(t, 0.18, 0.25, 350); osc('sine', 80, t, 0.15, 0.3, null, 45); },
    yay(t) {
      const notes = [523, 659, 784, 1047];
      notes.forEach((f, i) => {
        osc('triangle', f, t + i * 0.14, 0.3, 0.35);
        osc('square', f, t + i * 0.14, 0.22, 0.08);
      });
      osc('triangle', 1319, t + 0.6, 0.55, 0.3);
    },
    star(t) { osc('triangle', 1175, t, 0.25, 0.35, null, 1568); },
    uhoh(t) {
      osc('triangle', 392, t, 0.3, 0.35, null, 330);
      osc('triangle', 311, t + 0.3, 0.5, 0.35, null, 262);
    },
  };

  audio.play = function (name) {
    if (!ensureCtx() || audio.muted) return;
    const fn = sfx[name];
    if (fn) fn(audio.ctx.currentTime + 0.01);
  };

  /* ---------- BGM: かるいループアルペジオ ---------- */
  const BPM = 96;
  const STEP = 60 / BPM / 2; /* 8分音符 */
  /* Cメジャーペンタ中心のやさしいパターン（0=休符） */
  const MELODY = [
    523, 0, 659, 0, 784, 0, 659, 0,
    523, 0, 587, 0, 659, 0, 587, 0,
    523, 0, 659, 0, 784, 0, 880, 0,
    784, 0, 659, 0, 587, 0, 523, 0,
  ];
  const BASS = [131, 0, 0, 0, 98, 0, 0, 0, 110, 0, 0, 0, 98, 0, 0, 0,
                131, 0, 0, 0, 98, 0, 0, 0, 110, 0, 0, 0, 123, 0, 0, 0];

  function scheduleBgm() {
    const ctx = audio.ctx;
    while (audio.bgmNextTime < ctx.currentTime + 0.35) {
      const i = audio.bgmStep % MELODY.length;
      const t = audio.bgmNextTime;
      if (MELODY[i]) {
        osc('triangle', MELODY[i], t, STEP * 1.6, 0.5, audio.bgmGain);
      }
      if (BASS[i]) {
        osc('sine', BASS[i], t, STEP * 3.2, 0.6, audio.bgmGain);
      }
      audio.bgmStep++;
      audio.bgmNextTime += STEP;
    }
  }

  audio.startBgm = function () {
    if (!ensureCtx() || audio.bgmTimer) return;
    audio.bgmStep = 0;
    audio.bgmNextTime = audio.ctx.currentTime + 0.1;
    audio.bgmTimer = setInterval(scheduleBgm, 120);
  };

  audio.stopBgm = function () {
    if (audio.bgmTimer) { clearInterval(audio.bgmTimer); audio.bgmTimer = null; }
  };

  window.GameAudio = audio;
})();
