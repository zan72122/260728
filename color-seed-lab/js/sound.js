// WebAudio によるやさしい効果音。外部ファイル不要の小さなシンセ。

const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]; // Cメジャーペンタ

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
  }

  // ブラウザの制限上、最初のユーザー操作の中で呼ぶこと
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(this.ctx.destination);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.22;
  }

  tone({ freq = 440, endFreq = null, type = 'sine', dur = 0.2, vol = 1, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noiseBurst({ dur = 0.3, vol = 0.4, freq = 2400, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, (dur * this.ctx.sampleRate) | 0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 0.8;
    const gain = this.ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
  }

  // ---- 場面ごとの音 ----

  place() {
    // 種を置く: ぽん♪
    this.tone({ freq: 420, endFreq: 860, type: 'sine', dur: 0.16, vol: 0.9 });
    this.tone({ freq: 1240, type: 'triangle', dur: 0.1, vol: 0.25, delay: 0.05 });
  }

  grab() {
    this.tone({ freq: 660, endFreq: 520, type: 'sine', dur: 0.09, vol: 0.5 });
  }

  recolor() {
    this.tone({ freq: 700, type: 'triangle', dur: 0.1, vol: 0.5 });
    this.tone({ freq: 940, type: 'triangle', dur: 0.12, vol: 0.5, delay: 0.07 });
  }

  water() {
    // じょうろ: しゃらしゃら
    this.noiseBurst({ dur: 0.35, vol: 0.3, freq: 3200 });
    this.tone({ freq: 900, endFreq: 500, type: 'sine', dur: 0.2, vol: 0.2, delay: 0.05 });
  }

  bubbles() {
    for (let i = 0; i < 4; i++) {
      this.tone({
        freq: 500 + Math.random() * 500,
        endFreq: 900 + Math.random() * 500,
        type: 'sine', dur: 0.08, vol: 0.35, delay: i * 0.07,
      });
    }
  }

  pop() {
    this.tone({ freq: 300, endFreq: 90, type: 'sine', dur: 0.18, vol: 0.6 });
    this.noiseBurst({ dur: 0.08, vol: 0.15, freq: 1500 });
  }

  // 領域同士が初めてぶつかった時のチャイム
  contact(colorA, colorB) {
    const a = PENTATONIC[colorA % PENTATONIC.length];
    const b = PENTATONIC[colorB % PENTATONIC.length];
    this.tone({ freq: a, type: 'triangle', dur: 0.5, vol: 0.35 });
    this.tone({ freq: b * 1.0, type: 'triangle', dur: 0.55, vol: 0.3, delay: 0.09 });
    this.tone({ freq: (a + b), type: 'sine', dur: 0.4, vol: 0.12, delay: 0.16 });
  }

  reset() {
    // しゅるしゅると縮む音
    this.tone({ freq: 800, endFreq: 180, type: 'sine', dur: 0.7, vol: 0.4 });
    this.noiseBurst({ dur: 0.4, vol: 0.12, freq: 900, delay: 0.1 });
  }
}
