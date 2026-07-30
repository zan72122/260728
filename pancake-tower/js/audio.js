/* ============================================================
 * audio.js — WebAudio によるサウンド生成（音声ファイル不要）
 *   効果音: ぽよん / ぷに / とろー / キラーン / ファンファーレ
 *   BGM   : オルゴール風の自動生成メロディ
 * ============================================================ */
(function () {
  const A = {
    ctx: null,
    master: null,
    musicGain: null,
    noiseBuf: null,
    muted: false,
    started: false,
    pourNode: null,
    _musicTimer: 0,
  };
  PT.Audio = A;

  const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0]; // Cペンタトニック

  A.init = function () {
    if (A.started) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    A.ctx = new Ctx();
    A.master = A.ctx.createGain();
    A.master.gain.value = 0.9;
    A.master.connect(A.ctx.destination);
    A.musicGain = A.ctx.createGain();
    A.musicGain.gain.value = 0.16;
    A.musicGain.connect(A.master);
    // ノイズバッファ（そそぐ音・ぷにゅ音の素）
    const len = A.ctx.sampleRate * 1.2;
    A.noiseBuf = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
    const d = A.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    A.started = true;
  };

  A.resume = function () {
    if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
  };

  A.setMuted = function (m) {
    A.muted = m;
    if (A.master) A.master.gain.value = m ? 0 : 0.9;
  };

  function env(gainNode, t0, peak, att, dur) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + att);
    g.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  // 単音（オルゴール／チャイム）
  A.note = function (freq, opt) {
    if (!A.started || A.muted) return;
    opt = opt || {};
    const t0 = A.ctx.currentTime + (opt.delay || 0);
    const o = A.ctx.createOscillator();
    const g = A.ctx.createGain();
    o.type = opt.type || 'triangle';
    o.frequency.value = freq;
    env(g, t0, opt.gain || 0.22, opt.att || 0.008, opt.dur || 0.9);
    o.connect(g).connect(opt.music ? A.musicGain : A.master);
    o.start(t0);
    o.stop(t0 + (opt.dur || 0.9) + 0.05);
    // オルゴールの倍音キラキラ
    if (opt.sparkle) {
      const o2 = A.ctx.createOscillator();
      const g2 = A.ctx.createGain();
      o2.type = 'sine';
      o2.frequency.value = freq * 4;
      env(g2, t0, (opt.gain || 0.22) * 0.25, 0.005, 0.35);
      o2.connect(g2).connect(opt.music ? A.musicGain : A.master);
      o2.start(t0); o2.stop(t0 + 0.4);
    }
  };

  // ぽよん（着地）pitch: 0.5〜2
  A.plop = function (pitch, vol) {
    if (!A.started || A.muted) return;
    pitch = pitch || 1;
    const t0 = A.ctx.currentTime;
    const o = A.ctx.createOscillator();
    const g = A.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(340 * pitch, t0);
    o.frequency.exponentialRampToValueAtTime(110 * pitch, t0 + 0.13);
    env(g, t0, vol || 0.3, 0.005, 0.18);
    o.connect(g).connect(A.master);
    o.start(t0); o.stop(t0 + 0.22);
  };

  // ぷにっ（つんつん）
  A.squish = function (pitch) {
    if (!A.started || A.muted) return;
    const t0 = A.ctx.currentTime;
    const src = A.ctx.createBufferSource();
    src.buffer = A.noiseBuf;
    const f = A.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(500 * (pitch || 1), t0);
    f.frequency.exponentialRampToValueAtTime(160, t0 + 0.1);
    f.Q.value = 2.5;
    const g = A.ctx.createGain();
    env(g, t0, 0.35, 0.004, 0.12);
    src.connect(f).connect(g).connect(A.master);
    src.start(t0, PT.rand(0, 0.5)); src.stop(t0 + 0.15);
    A.note(PT.rand(500, 700), { type: 'sine', gain: 0.08, dur: 0.1 });
  };

  // ずるっ（すべり出し）
  A.slip = function () {
    if (!A.started || A.muted) return;
    const t0 = A.ctx.currentTime;
    const src = A.ctx.createBufferSource();
    src.buffer = A.noiseBuf;
    const f = A.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, t0);
    f.frequency.exponentialRampToValueAtTime(300, t0 + 0.25);
    const g = A.ctx.createGain();
    env(g, t0, 0.16, 0.02, 0.3);
    src.connect(f).connect(g).connect(A.master);
    src.start(t0, PT.rand(0, 0.4)); src.stop(t0 + 0.35);
  };

  // ぎしぎし（ぐらぐら警告のかわいい音）
  A.creak = function () {
    if (!A.started || A.muted) return;
    A.note(PT.rand(180, 240), { type: 'sine', gain: 0.05, dur: 0.25 });
  };

  // とろー（そそぐ・ループ）
  A.pourStart = function (bright) {
    if (!A.started || A.muted || A.pourNode) return;
    const t0 = A.ctx.currentTime;
    const src = A.ctx.createBufferSource();
    src.buffer = A.noiseBuf;
    src.loop = true;
    const f = A.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = bright ? 1500 : 700;
    const g = A.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.15);
    src.connect(f).connect(g).connect(A.master);
    src.start(t0);
    A.pourNode = { src, g };
  };
  A.pourStop = function () {
    if (!A.pourNode) return;
    const t0 = A.ctx.currentTime;
    const n = A.pourNode;
    A.pourNode = null;
    n.g.gain.cancelScheduledValues(t0);
    n.g.gain.setValueAtTime(Math.max(n.g.gain.value, 0.001), t0);
    n.g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
    n.src.stop(t0 + 0.2);
  };

  // キラーン（星ゲット）
  A.chime = function (step) {
    const f = SCALE[PT.clamp(step || 5, 0, SCALE.length - 1)];
    A.note(f, { type: 'triangle', gain: 0.25, dur: 0.7, sparkle: true });
    A.note(f * 2, { type: 'sine', gain: 0.1, dur: 0.5, delay: 0.06 });
  };

  // ファンファーレ（ラウンドクリア）
  A.fanfare = function () {
    [0, 2, 4, 5, 7].forEach((s, i) => {
      A.note(SCALE[s], { gain: 0.22, dur: 0.6, delay: i * 0.12, sparkle: true });
    });
    A.note(SCALE[9], { gain: 0.25, dur: 1.2, delay: 0.62, sparkle: true });
  };

  // ぱちぱち（紙吹雪）
  A.pop = function () {
    A.note(PT.rand(900, 1400), { type: 'sine', gain: 0.07, dur: 0.08 });
  };

  // ---- BGM: オルゴール自動生成 ----
  let beat = 0;
  A.updateMusic = function (dt) {
    if (!A.started || A.muted) return;
    A._musicTimer -= dt;
    if (A._musicTimer > 0) return;
    A._musicTimer = 0.62;
    beat++;
    if (Math.random() < 0.68) {
      const melodic = [0, 1, 2, 3, 4, 5, 6, 7];
      const s = PT.pick(melodic) + (beat % 8 === 0 ? 2 : 0);
      A.note(SCALE[PT.clamp(s, 0, 9)], { music: true, gain: 0.5, dur: 1.4, type: 'triangle', sparkle: true });
    }
    if (beat % 4 === 0) {
      A.note(SCALE[0] / 2, { music: true, gain: 0.35, dur: 1.6, type: 'sine' });
    }
  };
})();
