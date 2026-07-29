// WebAudio でその場で合成する効果音。外部ファイルは使わない。
// 最初のタッチ操作のあとに ensure() で初期化する。

export class AudioBox {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);

    // 1秒ぶんのホワイトノイズを使い回す
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // 砂のサラサラ音(ループ+ゲインで開閉)
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3400;
    filter.Q.value = 0.8;
    this.hissGain = this.ctx.createGain();
    this.hissGain.gain.value = 0;
    src.connect(filter).connect(this.hissGain).connect(this.master);
    src.start();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  /** 砂の流れ音量 0..1 */
  setHiss(level) {
    if (!this.ctx) return;
    const target = Math.min(1, Math.max(0, level)) * 0.05;
    this.hissGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.12);
  }

  tone(freq, dur, { type = 'sine', gain = 0.2, slide = 1, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide !== 1) osc.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noiseBurst(dur, { type = 'lowpass', from = 2000, to = null, gain = 0.2, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(from, t0);
    if (to) filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /** 手をはなした「ぽん」 */
  pop() {
    this.tone(340, 0.14, { type: 'triangle', gain: 0.25, slide: 0.45 });
  }

  /** そっと押した「こつん」 */
  tick() {
    this.noiseBurst(0.05, { type: 'highpass', from: 2400, gain: 0.1 });
    this.tone(520, 0.07, { type: 'sine', gain: 0.08, slide: 0.8 });
  }

  /** すなの おかわり(さらさらっ) */
  pour() {
    this.noiseBurst(0.4, { type: 'lowpass', from: 3200, to: 1200, gain: 0.16 });
  }

  /** きりの スプレー音 */
  spray() {
    this.noiseBurst(0.9, { type: 'lowpass', from: 6400, to: 800, gain: 0.14 });
  }

  /** かみを かえる「しゅっ」 */
  swoosh() {
    this.noiseBurst(0.45, { type: 'bandpass', from: 400, to: 1600, gain: 0.16 });
  }

  /** 揺れおわりの ちいさなチャイム */
  settleChime() {
    const notes = [660, 880];
    notes.forEach((f, i) => this.tone(f, 0.5, { gain: 0.1, delay: i * 0.13 }));
  }

  /** ほしバッジ げっとの ファンファーレ */
  badgeChime() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, 0.4, { gain: 0.14, delay: i * 0.11 }));
  }
}
