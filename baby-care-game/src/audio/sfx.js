// 音声ファイルは持たず、その場で合成する。iOS は最初のタッチまで音が出せないので、
// AudioContext は unlock() で作る。

export class Sfx {
  constructor(muted = false) {
    this.ctx = null;
    this.muted = muted;
    this.master = null;
    this._noise = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    this.master.connect(this.ctx.destination);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.02);
  }

  get t() { return this.ctx.currentTime; }

  _env(node, { attack = 0.01, decay = 0.25, peak = 0.5, start = 0 }) {
    const g = this.ctx.createGain();
    const t0 = this.t + start;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    node.connect(g);
    g.connect(this.master);
    return { gain: g, t0, end: t0 + attack + decay };
  }

  _tone({ freq = 440, type = 'sine', duration = 0.25, peak = 0.4, start = 0, slideTo = null, detune = 0 }) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.detune.value = detune;
    const env = this._env(osc, { attack: 0.012, decay: duration, peak, start });
    osc.frequency.setValueAtTime(freq, env.t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, env.end);
    osc.start(env.t0);
    osc.stop(env.end + 0.05);
  }

  _noiseBuffer() {
    if (!this._noise) {
      const len = this.ctx.sampleRate * 1.2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    return this._noise;
  }

  _noiseBurst({ duration = 0.3, peak = 0.25, freq = 900, q = 1.2, start = 0, sweepTo = null }) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    src.connect(filter);
    const env = this._env(filter, { attack: 0.02, decay: duration, peak, start });
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, env.end);
    src.start(env.t0);
    src.stop(env.end + 0.05);
  }

  // ------------------------------------------------------------- 効果音

  tap() { this._tone({ freq: 620, type: 'triangle', duration: 0.12, peak: 0.3, slideTo: 880 }); }

  pop() { this._tone({ freq: 300, type: 'sine', duration: 0.18, peak: 0.45, slideTo: 900 }); }

  whoosh() { this._noiseBurst({ duration: 0.45, peak: 0.16, freq: 500, q: 0.8, sweepTo: 1800 }); }

  /** きらきら（成功） */
  sparkle() {
    [880, 1174, 1568, 2093].forEach((f, i) => this._tone({ freq: f, type: 'sine', duration: 0.32, peak: 0.28, start: i * 0.07 }));
  }

  /** ほしをもらった音 */
  star() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this._tone({ freq: f, type: 'triangle', duration: 0.4, peak: 0.3, start: i * 0.08 }));
  }

  /** 赤ちゃんのわらい声（短い音を数回） */
  giggle() {
    const base = 420 + Math.random() * 60;
    for (let i = 0; i < 4; i++) {
      this._tone({ freq: base * (1 + i * 0.09), type: 'sine', duration: 0.13, peak: 0.32, start: i * 0.11, slideTo: base * (1.35 + i * 0.09) });
    }
  }

  /** ちょっとぐずる声 */
  fuss() {
    this._tone({ freq: 380, type: 'sawtooth', duration: 0.45, peak: 0.14, slideTo: 300 });
    this._tone({ freq: 760, type: 'sine', duration: 0.4, peak: 0.1, slideTo: 620, start: 0.05 });
  }

  /** ミルクをのむ音 */
  glug() {
    this._tone({ freq: 180, type: 'sine', duration: 0.16, peak: 0.35, slideTo: 110 });
  }

  /** みずの音 */
  splash() {
    this._noiseBurst({ duration: 0.5, peak: 0.22, freq: 1200, q: 0.7, sweepTo: 400 });
    this._tone({ freq: 240, type: 'sine', duration: 0.3, peak: 0.2, slideTo: 140 });
  }

  /** ごしごし */
  scrub() {
    this._noiseBurst({ duration: 0.14, peak: 0.13, freq: 2200, q: 1.6 });
  }

  /** すやすや */
  snore() {
    this._tone({ freq: 150, type: 'sine', duration: 0.9, peak: 0.16, slideTo: 110 });
    this._tone({ freq: 300, type: 'sine', duration: 0.8, peak: 0.05, start: 0.1 });
  }

  /** とんとん */
  pat() {
    this._tone({ freq: 200, type: 'sine', duration: 0.1, peak: 0.28, slideTo: 130 });
  }
}
