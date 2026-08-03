// 効果音（WebAudio で合成。音源ファイル不要）。
// 音は「あってうれしい」だけの要素で、無音でも遊べるようゲーム進行には一切関与しない。
// AudioContext が使えない環境では全メソッドが黙って何もしない。

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.ok = true;
    this.noiseBuf = null;
  }

  /** 最初のタッチで呼ぶ（iOS のオーディオ解禁） */
  unlock() {
    if (this.ctx || !this.ok) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.ok = false; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // ノイズ（空気漏れ・シュコッ）用のバッファ
      const len = Math.floor(this.ctx.sampleRate * 1.2);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    } catch {
      this.ok = false;
    }
    this._resume();
  }

  _resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  get available() {
    return !!(this.ctx && this.ok);
  }

  _tone({ freq = 440, dur = 0.2, type = 'sine', gain = 0.3, slideTo = null, delay = 0, attack = 0.01 }) {
    if (!this.available || this.muted) return;
    this._resume();
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  _noise({ dur = 0.3, gain = 0.15, freq = 1400, q = 1.2, delay = 0, slideTo = null }) {
    if (!this.available || this.muted) return;
    this._resume();
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'bandpass';
    flt.frequency.setValueAtTime(freq, t0);
    if (slideTo) flt.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    flt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  tap() { this._tone({ freq: 620, slideTo: 880, dur: 0.12, type: 'triangle', gain: 0.18 }); }
  squish() { this._tone({ freq: 300, slideTo: 150, dur: 0.18, type: 'sine', gain: 0.22 }); }
  hiss() { this._noise({ dur: 0.55, gain: 0.12, freq: 2600, slideTo: 1200, q: 0.8 }); }
  pickUp() { this._tone({ freq: 520, slideTo: 780, dur: 0.14, type: 'square', gain: 0.1 }); }
  stick() {
    this._tone({ freq: 240, slideTo: 520, dur: 0.16, type: 'triangle', gain: 0.22 });
    this._tone({ freq: 880, dur: 0.22, type: 'sine', gain: 0.12, delay: 0.1 });
  }
  pump(step) {
    this._noise({ dur: 0.22, gain: 0.16, freq: 900, slideTo: 2200, q: 0.7 });
    this._tone({ freq: 180 + step * 40, slideTo: 320 + step * 70, dur: 0.28, type: 'sine', gain: 0.2 });
  }
  full() {
    [0, 0.12, 0.24].forEach((d, i) => this._tone({ freq: 660 * Math.pow(1.26, i), dur: 0.3, type: 'triangle', gain: 0.18, delay: d }));
  }
  spin() { this._noise({ dur: 0.5, gain: 0.08, freq: 700, slideTo: 2400, q: 2 }); }
  bell() {
    this._tone({ freq: 1180, dur: 0.5, type: 'sine', gain: 0.14 });
    this._tone({ freq: 1770, dur: 0.35, type: 'sine', gain: 0.06 });
  }
  /** キーキーというきしみ（油をさす前） */
  squeak() {
    this._tone({ freq: 1900, slideTo: 950, dur: 0.14, type: 'sawtooth', gain: 0.05 });
    this._tone({ freq: 1650, slideTo: 820, dur: 0.16, type: 'sawtooth', gain: 0.045, delay: 0.16 });
  }

  /** スパナ・ネジの「きゅっ」 */
  clunk() {
    this._tone({ freq: 150, slideTo: 70, dur: 0.12, type: 'square', gain: 0.2 });
    this._noise({ dur: 0.06, freq: 900, gain: 0.09, q: 1.5 });
  }

  /** 油のしずくがポタッ */
  drip() {
    this._tone({ freq: 1500, slideTo: 320, dur: 0.16, type: 'sine', gain: 0.22 });
  }

  /** スポンジでこする音 */
  scrub() {
    this._noise({ dur: 0.16, freq: 900, slideTo: 1600, q: 0.9, gain: 0.08 });
  }

  /** ピカッと光る音 */
  ding() {
    this._tone({ freq: 1568, dur: 0.5, type: 'sine', gain: 0.14 });
    this._tone({ freq: 2349, dur: 0.32, type: 'sine', gain: 0.05 });
  }

  /** こわれたベルの「…」 */
  thud() {
    this._tone({ freq: 220, slideTo: 140, dur: 0.09, type: 'triangle', gain: 0.12 });
  }

  fanfare() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      this._tone({ freq: f, dur: 0.45, type: 'triangle', gain: 0.2, delay: i * 0.13 });
      this._tone({ freq: f * 2, dur: 0.3, type: 'sine', gain: 0.07, delay: i * 0.13 });
    });
  }
}
