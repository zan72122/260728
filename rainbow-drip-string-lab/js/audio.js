// WebAudio でその場で合成する、やわらかい効果音キット。
// 外部音源ファイル不要。すべて短くやわらかい、怖くない音に揃える。
// AudioContext はユーザー操作後にしか再生できないため、遅延初期化する。

const MASTER_VOLUME = 0.42;
const MIN_SOUND_GAP = 0.03; // 同種音の最短間隔(秒)— 連打時の耳障り防止

class SoundKit {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.lastPlayed = new Map();
  }

  /** ユーザー初回操作時に呼ぶ */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = MASTER_VOLUME;
      // 全体を軽くローパスして角を取る
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5200;
      this.master.connect(lp);
      lp.connect(this.ctx.destination);
    } catch (_e) {
      this.ctx = null; // 音が出なくても遊べるようにする
    }
  }

  _canPlay(name) {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    const now = this.ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? -1;
    if (now - last < MIN_SOUND_GAP) return false;
    this.lastPlayed.set(name, now);
    return true;
  }

  /** 単純なオシレータ+エンベロープ */
  _tone({ type = 'sine', freq = 440, freqEnd = null, dur = 0.15, gain = 0.3, delay = 0 }) {
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd != null) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** ピンを置いた: ぽん */
  pop() {
    if (!this._canPlay('pop')) return;
    this._tone({ type: 'sine', freq: 520, freqEnd: 780, dur: 0.12, gain: 0.35 });
  }

  /** 紐をつないだ: びよーん */
  stretch() {
    if (!this._canPlay('stretch')) return;
    this._tone({ type: 'triangle', freq: 240, freqEnd: 420, dur: 0.22, gain: 0.28 });
    this._tone({ type: 'sine', freq: 480, freqEnd: 620, dur: 0.18, gain: 0.12, delay: 0.05 });
  }

  /** しずくが出た: ぽとっ(大きさで音程が下がる) */
  plop(size = 1) {
    if (!this._canPlay('plop')) return;
    const f = 620 / Math.max(1, Math.sqrt(size));
    this._tone({ type: 'sine', freq: f, freqEnd: f * 0.55, dur: 0.1, gain: 0.22 });
  }

  /** 着水: ちゃぷ */
  splash(size = 1) {
    if (!this._canPlay('splash')) return;
    const f = 900 / Math.max(1, Math.sqrt(size));
    this._tone({ type: 'sine', freq: f, freqEnd: f * 0.4, dur: 0.14, gain: 0.18 });
    this._tone({ type: 'triangle', freq: f * 1.5, freqEnd: f * 0.6, dur: 0.1, gain: 0.08, delay: 0.02 });
  }

  /** 花が咲いた: やさしいチャイム */
  chime() {
    if (!this._canPlay('chime')) return;
    const notes = [660, 830, 990];
    notes.forEach((f, i) => {
      this._tone({ type: 'sine', freq: f, dur: 0.5, gain: 0.16, delay: i * 0.09 });
    });
  }

  /** あふれた: ぷくぷく */
  bubble() {
    if (!this._canPlay('bubble')) return;
    for (let i = 0; i < 3; i++) {
      const f = 320 + Math.random() * 260;
      this._tone({ type: 'sine', freq: f, freqEnd: f * 1.8, dur: 0.1, gain: 0.12, delay: i * 0.07 });
    }
  }

  /** キラキラ */
  sparkle() {
    if (!this._canPlay('sparkle')) return;
    this._tone({ type: 'sine', freq: 1250, freqEnd: 1850, dur: 0.16, gain: 0.08 });
  }

  /** 消しゴム: しゅぽ */
  poof() {
    if (!this._canPlay('poof')) return;
    this._tone({ type: 'triangle', freq: 500, freqEnd: 160, dur: 0.16, gain: 0.2 });
  }
}

export const sounds = new SoundKit();
