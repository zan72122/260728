// ============================================================
// みずみちラボ - 音 (WebAudio 合成 + 音声よみあげ)
// ============================================================
"use strict";

const Sound = (function () {
  let ctx = null;
  let master = null;
  let pourNode = null;
  let waveNode = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return true;
  }

  function noiseBuffer() {
    const len = ctx.sampleRate * 1.2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function tone(freq, dur, type, gain, delay, slide) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain || 0.12, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  return {
    unlock() { ensure(); },

    tap() { tone(660, 0.09, "sine", 0.10, 0, -260); },
    pop() { tone(300, 0.14, "triangle", 0.16, 0, 260); },      // 置いた
    dig() { tone(220, 0.10, "triangle", 0.10, 0, -80); },      // ほった
    poof() { tone(500, 0.16, "sine", 0.10, 0, -320); },        // けした
    boing() {                                                   // ぷるん
      tone(340, 0.16, "sine", 0.12, 0, 140);
      tone(510, 0.14, "sine", 0.07, 0.05, 120);
    },
    undo() { tone(520, 0.10, "sine", 0.09, 0, -150); tone(390, 0.12, "sine", 0.09, 0.08, -110); },

    chimeSuccess() {
      const notes = [523, 659, 784, 880, 1047];
      notes.forEach((f, i) => {
        tone(f, 0.5, "sine", 0.12, i * 0.13);
        tone(f * 2, 0.3, "sine", 0.03, i * 0.13);
      });
    },
    chimeRetry() {
      tone(520, 0.3, "sine", 0.10, 0);
      tone(430, 0.42, "sine", 0.10, 0.22);
    },
    sparkle() { tone(1560, 0.18, "sine", 0.05, 0, 300); },

    pourStart() {
      if (!ensure() || pourNode) return;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(); src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 0.9;
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2;
      const lg = ctx.createGain(); lg.gain.value = 0.015;
      lfo.connect(lg); lg.connect(g.gain);
      src.connect(bp); bp.connect(g); g.connect(master);
      g.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.15);
      src.start(); lfo.start();
      pourNode = { src, g, lfo };
    },
    pourStop() {
      if (!pourNode) return;
      const p = pourNode; pourNode = null;
      p.g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.18);
      setTimeout(() => { try { p.src.stop(); p.lfo.stop(); } catch (e) {} }, 260);
    },

    waveSwell() {
      if (!ensure() || waveNode) return;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(); src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 420;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(lp); lp.connect(g); g.connect(master);
      const t = ctx.currentTime;
      g.gain.linearRampToValueAtTime(0.10, t + 1.4);
      g.gain.linearRampToValueAtTime(0.05, t + 4.5);
      g.gain.linearRampToValueAtTime(0, t + 7.5);
      src.start(); src.stop(t + 8);
      waveNode = src;
      src.onended = () => { waveNode = null; };
    },

    speak(text) {
      try {
        if (!window.speechSynthesis) return;
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "ja-JP";
        u.rate = 0.88;
        u.pitch = 1.25;
        const vs = speechSynthesis.getVoices().filter(v => v.lang && v.lang.indexOf("ja") === 0);
        if (vs.length) u.voice = vs[0];
        speechSynthesis.speak(u);
      } catch (e) {}
    },
  };
})();
