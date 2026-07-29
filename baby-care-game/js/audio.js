// Web Audio だけで BGM と効果音を合成する（外部音源ファイル不要）
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bgmGain = null;
    this.muted = localStorage.getItem('babycare_muted') === '1';
    this.bgmTimer = null;
  }

  // iOS はユーザー操作の中でしか AudioContext を開始できない
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.35;
    this.bgmGain.connect(this.master);
    this.startBGM();
  }

  setMuted(muted) {
    this.muted = muted;
    localStorage.setItem('babycare_muted', muted ? '1' : '0');
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.05);
    }
  }

  // ---------- オルゴール風 BGM ----------
  startBGM() {
    if (!this.ctx || this.bgmTimer) return;
    const beat = 0.62; // ゆったりした子守唄テンポ
    // [MIDIノート, 拍位置] やさしいペンタトニックの子守唄（オリジナル）
    const melody = [
      [76, 0], [72, 1], [74, 2], [76, 3],
      [79, 4], [76, 5], [74, 6], [72, 7],
      [69, 8], [72, 9], [74, 10], [76, 11],
      [74, 12], [72, 13.5], [69, 15],
      [76, 16], [79, 17], [81, 18], [79, 19],
      [76, 20], [74, 21], [72, 22], [74, 23],
      [76, 24], [74, 25], [72, 26], [69, 27],
      [72, 28], [69, 29.5], [64, 31],
    ];
    const bass = [
      [45, 0], [52, 4], [41, 8], [45, 12],
      [45, 16], [52, 20], [41, 24], [45, 28],
    ];
    const loopBeats = 32;
    let loopStart = this.ctx.currentTime + 0.2;

    const scheduleLoop = () => {
      const now = this.ctx.currentTime;
      // ループ先頭が近づいたら次のループを予約する
      if (loopStart - now < 1.2) {
        for (const [note, t] of melody) this.musicBoxNote(note, loopStart + t * beat, 0.16);
        for (const [note, t] of bass) this.musicBoxNote(note, loopStart + t * beat, 0.09, 2.4);
        loopStart += loopBeats * beat;
      }
    };
    scheduleLoop();
    this.bgmTimer = setInterval(scheduleLoop, 500);
  }

  musicBoxNote(midi, when, gain, decay = 1.5) {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const t = Math.max(when, this.ctx.currentTime);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    g.connect(this.bgmGain);
    // 基音 + 弱い倍音でオルゴールらしい響きに
    for (const [mult, amp] of [[1, 1], [4, 0.18]]) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * mult;
      const og = this.ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + decay + 0.1);
    }
  }

  // ---------- 効果音 ----------
  tone(freqFrom, freqTo, dur, { type = 'sine', gain = 0.25, when = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freqFrom, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(freqTo, 1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  pop() { this.tone(420, 90, 0.14, { type: 'triangle', gain: 0.35 }); }

  sparkle() {
    [1568, 2093, 2637].forEach((f, i) =>
      this.tone(f, f * 1.01, 0.3, { gain: 0.12, when: i * 0.06 }));
  }

  squeak() {
    this.tone(850, 1400, 0.09, { type: 'triangle', gain: 0.18 });
    this.tone(1400, 900, 0.1, { type: 'triangle', gain: 0.15, when: 0.09 });
  }

  giggle() {
    [720, 900, 780, 1000, 880].forEach((f, i) =>
      this.tone(f, f * 1.3, 0.09, { type: 'triangle', gain: 0.16, when: i * 0.09 }));
  }

  fussy() {
    this.tone(340, 250, 0.28, { type: 'triangle', gain: 0.12 });
    this.tone(300, 220, 0.3, { type: 'triangle', gain: 0.1, when: 0.32 });
  }

  jingle() {
    // できたね！のファンファーレ
    const notes = [72, 76, 79, 84];
    notes.forEach((n, i) => {
      const f = 440 * Math.pow(2, (n - 69) / 12);
      this.tone(f, f, 0.35, { gain: 0.2, when: i * 0.11 });
    });
    notes.forEach((n) => {
      const f = 440 * Math.pow(2, (n - 69) / 12);
      this.tone(f, f, 0.7, { gain: 0.12, when: 0.48 });
    });
  }

  ding() { this.tone(1319, 1319, 0.4, { gain: 0.18 }); }
}
