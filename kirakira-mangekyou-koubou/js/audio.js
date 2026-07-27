/* ═══════════════════════════════════════════════════════════
   audio.js — WebAudio による全合成サウンド（外部アセットなし）
   オルゴール風チャイム・ビーズのカチカチ・注ぐ音・きらめき
   ═══════════════════════════════════════════════════════════ */
"use strict";

KKM.Sound = (() => {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let muted = false;
  let musicTimer = null;
  let lastClack = 0;
  let clackBudget = 0;

  const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.7, 1318.5]; // C D E G A （2オクターブ）

  function ensure() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.16;
      musicGain.connect(master);
      return true;
    } catch (e) { return false; }
  }

  function noiseBuffer(seconds) {
    const len = Math.max(1, (seconds * ctx.sampleRate) | 0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* オルゴールの一音：主音＋倍音＋わずかなデチューンで温かく */
  function ping(freq, when = 0, vol = 0.5, dur = 1.3, dest = null) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(vol, t + 0.008);
    out.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    out.connect(dest || master);
    const partials = [[1, 1], [2.0, 0.28], [2.99, 0.12], [4.02, 0.05]];
    for (const [mul, amp] of partials) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freq * mul * (1 + (Math.random() - 0.5) * 0.0016);
      const g = ctx.createGain();
      g.gain.value = amp;
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }

  /* ビーズが壁にあたる音 */
  function clack(size = 0.5, vol = 0.5) {
    if (!ctx || muted) return;
    const now = performance.now();
    clackBudget = Math.min(6, clackBudget + (now - lastClack) / 90);
    lastClack = now;
    if (clackBudget < 1) return;
    clackBudget -= 1;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400 - size * 1500 + Math.random() * 300;
    bp.Q.value = 9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 0.06);
    // ちいさな「コン」
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(1050 - size * 520, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.04);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(vol * 0.3, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g2); g2.connect(master);
    o.start(t); o.stop(t + 0.06);
  }

  /* 注ぐ音（素材ごとに個性を） */
  function pour(kind) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    if (kind === "glitter") {
      for (let i = 0; i < 7; i++) {
        ping(1400 + Math.random() * 1600, i * 0.045 + Math.random() * 0.02, 0.10, 0.5);
      }
      return;
    }
    if (kind === "water") {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.75);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.Q.value = 2.2;
      bp.frequency.setValueAtTime(500, t);
      bp.frequency.exponentialRampToValueAtTime(1600, t + 0.65);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.34, t + 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.72);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.78);
      for (let i = 0; i < 4; i++) ping(900 + Math.random() * 900, 0.1 + i * 0.13, 0.06, 0.4);
      return;
    }
    if (kind === "petals") {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.4);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 0.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.42);
      return;
    }
    // beads / stars: コロコロコロ…
    for (let i = 0; i < 6; i++) {
      const d = i * 0.06 + Math.random() * 0.03;
      setTimeout(() => clack(0.3 + Math.random() * 0.5, 0.6), d * 1000);
    }
  }

  function uiTap() {
    if (!ensure() || muted) return;
    ping(PENTA[2], 0, 0.22, 0.5);
  }

  function uiSelect() {
    if (!ensure() || muted) return;
    ping(PENTA[2], 0, 0.2, 0.5);
    ping(PENTA[4], 0.07, 0.2, 0.6);
  }

  /* 部品が「カチッ」とはまる音 */
  function snap() {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.035);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 3200; bp.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 0.05);
    ping(PENTA[4], 0.03, 0.22, 0.55);
    ping(PENTA[6], 0.09, 0.16, 0.6);
  }

  function whoosh() {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 0.52);
  }

  /* のぞきに入るときの「じゃーん」 */
  function reveal() {
    if (!ensure() || muted) return;
    const seq = [0, 2, 4, 5, 7];
    seq.forEach((n, i) => ping(PENTA[n % PENTA.length], i * 0.09, 0.26, 1.4));
    whoosh();
  }

  function tada() {
    if (!ensure() || muted) return;
    [0, 2, 4, 6].forEach((n, i) => ping(PENTA[n], i * 0.1, 0.3, 1.5));
  }

  function shutter() {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(hp); hp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 0.06);
    ping(PENTA[6], 0.05, 0.2, 0.7);
  }

  function popSeq(count) {
    if (!ensure() || muted) return;
    const n = Math.min(10, count);
    for (let i = 0; i < n; i++) {
      ping(700 + Math.random() * 700 - i * 40, i * 0.05, 0.12, 0.3);
    }
  }

  /* きらめき（強い輝きがでたときに、ごくたまに） */
  let lastShimmer = 0;
  function shimmer() {
    if (!ctx || muted) return;
    const now = performance.now();
    if (now - lastShimmer < 1600) return;
    lastShimmer = now;
    ping(2093 + Math.random() * 500, 0, 0.05, 0.9);
  }

  /* ゆったり生成されるオルゴールBGM（同じ曲にならない） */
  function startMusic() {
    if (!ensure() || musicTimer) return;
    let step = 0;
    const scale = [0, 2, 4, 5, 7, 9];
    musicTimer = setInterval(() => {
      if (muted || !ctx) return;
      step++;
      if (Math.random() < 0.28) return;             // ときどき休符
      const n = scale[(Math.random() * scale.length) | 0];
      const oct = Math.random() < 0.25 ? 2 : 1;
      ping(261.63 * Math.pow(2, (n / 12)) * oct, 0, 0.16, 2.2, musicGain);
      if (step % 4 === 0 && Math.random() < 0.5) {
        ping(261.63 * Math.pow(2, ((n + 7) / 12)), 0.4, 0.1, 2.0, musicGain);
      }
    }, 1150);
  }

  function duckMusic(on) {
    if (!musicGain || !ctx) return;
    musicGain.gain.linearRampToValueAtTime(on ? 0.05 : 0.16, ctx.currentTime + 0.6);
  }

  function setMuted(m) {
    muted = m;
    if (master && ctx) master.gain.linearRampToValueAtTime(m ? 0 : 0.9, ctx.currentTime + 0.15);
    document.body.classList.toggle("sound-muted", m);
    try { localStorage.setItem(KKM.SOUND_KEY, m ? "0" : "1"); } catch (e) {}
  }

  function isMuted() { return muted; }

  try { muted = localStorage.getItem(KKM.SOUND_KEY) === "0"; } catch (e) {}
  document.addEventListener("DOMContentLoaded", () => {
    document.body.classList.toggle("sound-muted", muted);
  });

  return { ensure, ping, clack, pour, uiTap, uiSelect, snap, whoosh, reveal, tada,
           shutter, popSeq, shimmer, startMusic, duckMusic, setMuted, isMuted };
})();
