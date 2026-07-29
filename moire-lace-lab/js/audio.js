/*
 * audio.js
 * WebAudio だけで作る、ごく小さな効果音 (音声ファイル不要)。
 * 初回のタッチ操作で AudioContext を起こす (自動再生制限への対応)。
 * 音が出せない環境でも例外を握りつぶし、ゲームは静かに続行する。
 */
(function () {
  'use strict';
  const ML = (window.MoireLab = window.MoireLab || {});

  const MASTER_GAIN = 0.14; // 子ども向けに控えめな音量
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
    return ctx;
  }

  function resume() {
    try {
      const c = ensure();
      if (c && c.state === 'suspended') c.resume();
    } catch (e) { /* 音なしで続行 */ }
  }

  // ボタンを押したときの「ぽん」
  function pop() {
    try {
      const c = ensure();
      if (!c) return;
      const t = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(620, t);
      osc.frequency.exponentialRampToValueAtTime(330, t + 0.09);
      gain.gain.setValueAtTime(0.9, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.14);
    } catch (e) { /* 音なしで続行 */ }
  }

  // 霧吹きの「しゅわーっ」(ノイズ + ハイパス)
  function shimmer() {
    try {
      const c = ensure();
      if (!c) return;
      const t = c.currentTime;
      const dur = 0.45;
      const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buf;
      const filter = c.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(2200, t);
      filter.frequency.exponentialRampToValueAtTime(5200, t + dur);
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.7, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filter).connect(gain).connect(master);
      src.start(t);
    } catch (e) { /* 音なしで続行 */ }
  }

  // 花火の「きらん」(小さなアルペジオ)
  function twinkle() {
    try {
      const c = ensure();
      if (!c) return;
      const t = c.currentTime;
      const notes = [880, 1174.7, 1568]; // A5, D6, G6 ふんわりした響き
      notes.forEach((freq, i) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = t + i * 0.05;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.5, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
        osc.connect(gain).connect(master);
        osc.start(start);
        osc.stop(start + 0.4);
      });
    } catch (e) { /* 音なしで続行 */ }
  }

  ML.audio = { resume, pop, shimmer, twinkle };
})();
