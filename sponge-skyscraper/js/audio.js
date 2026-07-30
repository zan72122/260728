/* =========================================================
   スポンジ摩天楼 — サウンド（全部 WebAudio 合成・音源ファイル不要）
   iOS では最初のタッチで unlock() を呼ぶこと
   ========================================================= */
(function () {
  'use strict';

  var ctx = null, master = null, noiseBuf = null;
  var pourNode = null, windNode = null, creakNode = null;

  var PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.7, 1318.5];

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function now() { return ctx.currentTime; }

  function env(g, t0, a, peak, dec, end) {
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
    if (end !== undefined) g.gain.setValueAtTime(0, t0 + a + dec + 0.01);
  }

  function tone(freq, type, peak, dur, bendTo, delay) {
    if (!ctx) return;
    var t0 = now() + (delay || 0);
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (bendTo) o.frequency.exponentialRampToValueAtTime(bendTo, t0 + dur);
    env(g, t0, 0.008, peak, dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.1);
  }

  function noiseBurst(peak, dur, f0, f1, q, type, delay) {
    if (!ctx) return;
    var t0 = now() + (delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = type || 'bandpass'; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(f1, 30), t0 + dur);
    var g = ctx.createGain();
    env(g, t0, 0.01, peak, dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.1);
  }

  /* --- 継続音（じょうろ・かぜ・きしみ）--- */
  function makeLoop(filterType, f0, q) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = f0; f.Q.value = q;
    var g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
    return { src: src, filter: f, gain: g };
  }

  var SFX = {
    unlock: function () { ensure(); },

    /* じょうろの「しゃー」 level 0..1 */
    pour: function (level) {
      if (!ctx && !level) return; // 操作前に AudioContext を作らない
      if (!ensure()) return;
      if (!pourNode) pourNode = makeLoop('bandpass', 2400, 0.6);
      var t = now();
      pourNode.gain.gain.cancelScheduledValues(t);
      pourNode.gain.gain.linearRampToValueAtTime(0.12 * level, t + 0.08);
      pourNode.filter.frequency.setValueAtTime(1800 + 1400 * level, t);
    },

    /* かぜの「ひゅー」 level 0..1 */
    wind: function (level) {
      if (!ctx && !level) return;
      if (!ensure()) return;
      if (!windNode) windNode = makeLoop('lowpass', 400, 1.2);
      var t = now();
      windNode.gain.gain.cancelScheduledValues(t);
      windNode.gain.gain.linearRampToValueAtTime(0.16 * level, t + 0.1);
      windNode.filter.frequency.setValueAtTime(250 + 900 * level, t);
    },

    /* 塔がかたむく「みしみし」 level 0..1 */
    creak: function (level) {
      if (!ctx && !level) return;
      if (!ensure()) return;
      if (!creakNode) creakNode = makeLoop('bandpass', 180, 6);
      var t = now();
      creakNode.gain.gain.cancelScheduledValues(t);
      creakNode.gain.gain.linearRampToValueAtTime(0.08 * level, t + 0.15);
      creakNode.filter.frequency.setValueAtTime(120 + 160 * level + Math.random() * 40, t);
    },

    /* 水のしずく「ぴちょん」 */
    plink: function () {
      if (!ensure()) return;
      var f = PENTA[4 + (Math.random() * 4 | 0)];
      tone(f * 2, 'sine', 0.06, 0.12, f * 1.6);
    },

    /* ぷにっ（へこむ音） intensity 0..1 */
    squish: function (k) {
      if (!ensure()) return;
      k = k === undefined ? 0.6 : k;
      noiseBurst(0.10 + 0.15 * k, 0.16 + 0.1 * k, 500, 90, 2, 'bandpass');
      tone(160 + 80 * Math.random(), 'sine', 0.05 * k, 0.15, 70);
    },

    /* べちゃ（濡れスポンジの着地） */
    splat: function () {
      if (!ensure()) return;
      noiseBurst(0.22, 0.22, 900, 120, 1.2, 'bandpass');
      tone(120, 'sine', 0.08, 0.18, 55);
    },

    /* ぼよ〜ん size 0..1 */
    boing: function (size) {
      if (!ensure()) return;
      size = size === undefined ? 0.6 : size;
      var f0 = 380 - 140 * size;
      var t0 = now();
      var o = ctx.createOscillator(), g = ctx.createGain();
      var lfo = ctx.createOscillator(), lg = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.45, t0 + 0.35);
      lfo.frequency.value = 14; lg.gain.value = 22;
      lfo.connect(lg); lg.connect(o.frequency);
      env(g, t0, 0.01, 0.14 + 0.1 * size, 0.4);
      o.connect(g); g.connect(master);
      o.start(t0); lfo.start(t0); o.stop(t0 + 0.55); lfo.stop(t0 + 0.55);
    },

    /* ぽんっ */
    pop: function () {
      if (!ensure()) return;
      tone(520 + Math.random() * 160, 'sine', 0.12, 0.09, 260);
    },

    /* しゅ〜（乾かす蒸気） */
    steam: function () {
      if (!ensure()) return;
      noiseBurst(0.05, 0.3, 3600, 2000, 0.7, 'highpass');
    },

    /* ひゅ〜ん（すべり笛：くずれはじめ） */
    wheee: function () {
      if (!ensure()) return;
      tone(420, 'sine', 0.1, 0.45, 950);
    },

    /* キラン */
    ting: function (i) {
      if (!ensure()) return;
      var f = PENTA[(i || 0) % PENTA.length];
      tone(f * 2, 'sine', 0.08, 0.5);
      tone(f * 4, 'sine', 0.03, 0.4);
    },

    /* おほしさまゲット */
    chime: function () {
      if (!ensure()) return;
      for (var i = 0; i < 5; i++) {
        (function (i) {
          var f = PENTA[i + 1];
          tone(f * 2, 'sine', 0.09, 0.5, undefined, i * 0.09);
          tone(f * 4, 'sine', 0.03, 0.45, undefined, i * 0.09);
        })(i);
      }
    },

    /* だいせいこう（にじ完成など） */
    tada: function () {
      if (!ensure()) return;
      var seq = [0, 2, 4, 5, 7];
      for (var i = 0; i < seq.length; i++) {
        tone(PENTA[seq[i] % PENTA.length] * 2, 'triangle', 0.1, 0.6, undefined, i * 0.12);
      }
      noiseBurst(0.06, 0.8, 5000, 3000, 0.6, 'highpass', 0.1);
    },

    /* おやすみ〜（ふわっと下がる2音） */
    sleepy: function () {
      if (!ensure()) return;
      tone(PENTA[3] * 2, 'sine', 0.07, 0.6, PENTA[3] * 1.9);
      tone(PENTA[1] * 2, 'sine', 0.07, 0.8, PENTA[1] * 1.85, 0.45);
    }
  };

  window.SFX = SFX;
})();
