/* =========================================================
 * sfx.js — WebAudio でつくる やさしい効果音とオルゴール BGM
 * （音声ファイル不要・すべてその場で合成）
 * ========================================================= */
(function () {
  'use strict';

  const NOTE = {
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.26, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77,
    C6: 1046.5, E6: 1318.5, G6: 1568.0,
  };

  const SFX = {
    ctx: null,
    master: null,
    bgmGain: null,
    muted: false,
    _bgmTimer: null,
    _lullabyTimer: null,
    _cryTimer: null,

    /** 最初のユーザー操作の中で呼ぶ（iOS のオーディオ解錠） */
    init() {
      if (this.ctx) { this.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.16;
      this.bgmGain.connect(this.master);
      this.resume();
    },

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : 0.9;
    },

    /* ---- 低レベルヘルパー ---- */

    /** 単音（オルゴール風の減衰つきトーン） */
    tone(freq, opts = {}) {
      if (!this.ctx) return;
      const {
        when = 0, dur = 0.35, type = 'sine', vol = 0.25,
        slideTo = null, dest = null, vibrato = 0,
      } = opts;
      const t0 = this.ctx.currentTime + when;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      if (vibrato > 0) {
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.frequency.value = 6.5;
        lfoGain.gain.value = vibrato;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        lfo.start(t0);
        lfo.stop(t0 + dur);
      }
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(dest || this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    },

    /** ノイズバースト（ポフッ・シャワーなど） */
    noise(opts = {}) {
      if (!this.ctx) return;
      const { when = 0, dur = 0.3, vol = 0.2, filterFreq = 1200 } = opts;
      const t0 = this.ctx.currentTime + when;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq;
      const gain = this.ctx.createGain();
      gain.gain.value = vol;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start(t0);
    },

    /* ---- 効果音 ---- */

    /** ボタンタップ音 */
    tap() { this.tone(NOTE.C6, { dur: 0.12, vol: 0.15, type: 'triangle' }); },

    /** ごほうびチャイム（お世話成功） */
    chime() {
      [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => {
        this.tone(f, { when: i * 0.11, dur: 0.5, vol: 0.22, type: 'triangle' });
      });
      this.tone(NOTE.E6, { when: 0.44, dur: 0.7, vol: 0.16 });
    },

    /** 赤ちゃんの笑い声風（コロコロした上昇音） */
    giggle() {
      const base = [NOTE.G5, NOTE.A5, NOTE.C6, NOTE.A5, NOTE.C6];
      base.forEach((f, i) => {
        this.tone(f * (1 + Math.random() * 0.04), {
          when: i * 0.09, dur: 0.12, vol: 0.16, type: 'square',
        });
      });
    },

    /** ごくごく（ミルク） */
    gulp(when = 0) {
      this.tone(300, { when, dur: 0.16, vol: 0.2, slideTo: 130, type: 'sine' });
      this.noise({ when: when + 0.03, dur: 0.08, vol: 0.05, filterFreq: 900 });
    },

    /** ポフッ（おむつ交換の煙） */
    poof() {
      this.noise({ dur: 0.4, vol: 0.25, filterFreq: 700 });
      this.tone(220, { dur: 0.3, vol: 0.1, slideTo: 90 });
    },

    /** キラキラ */
    sparkle() {
      [NOTE.C6, NOTE.E6, NOTE.G6].forEach((f, i) => {
        this.tone(f, { when: i * 0.07, dur: 0.3, vol: 0.12 });
      });
    },

    /** あわのポコポコ（おふろ） */
    bubble(when = 0) {
      const f = 500 + Math.random() * 500;
      this.tone(f, { when, dur: 0.1, vol: 0.1, slideTo: f * 1.8, type: 'sine' });
    },

    /** ぷはー（げっぷ／満足） */
    burp() {
      this.tone(180, { dur: 0.28, vol: 0.18, slideTo: 120, type: 'sawtooth' });
    },

    /** シャワー音 */
    shower() {
      this.noise({ dur: 0.9, vol: 0.1, filterFreq: 3000 });
    },

    /* ---- 泣き声（やさしい「ふぇ〜ん」を繰り返す） ---- */

    startCry() {
      if (!this.ctx || this._cryTimer) return;
      const wah = () => {
        this.tone(620, { dur: 0.5, vol: 0.09, slideTo: 380, vibrato: 22 });
        this.tone(620, { when: 0.65, dur: 0.6, vol: 0.08, slideTo: 340, vibrato: 22 });
      };
      wah();
      this._cryTimer = setInterval(wah, 2600);
    },

    stopCry() {
      if (this._cryTimer) { clearInterval(this._cryTimer); this._cryTimer = null; }
    },

    /* ---- 子守唄（きらきら星・ねんね中ループ） ---- */

    startLullaby() {
      if (!this.ctx || this._lullabyTimer) return;
      const melody = [
        [NOTE.C5, 0.5], [NOTE.C5, 0.5], [NOTE.G5, 0.5], [NOTE.G5, 0.5],
        [NOTE.A5, 0.5], [NOTE.A5, 0.5], [NOTE.G5, 1.0],
        [NOTE.F5, 0.5], [NOTE.F5, 0.5], [NOTE.E5, 0.5], [NOTE.E5, 0.5],
        [NOTE.D5, 0.5], [NOTE.D5, 0.5], [NOTE.C5, 1.0],
      ];
      const playOnce = () => {
        let t = 0;
        melody.forEach(([f, d]) => {
          this.tone(f, { when: t, dur: d * 0.95, vol: 0.14, type: 'triangle' });
          this.tone(f / 2, { when: t, dur: d * 0.95, vol: 0.05 });
          t += d * 0.72;
        });
        return t;
      };
      const total = playOnce();
      this._lullabyTimer = setInterval(playOnce, (total + 0.8) * 1000);
    },

    stopLullaby() {
      if (this._lullabyTimer) { clearInterval(this._lullabyTimer); this._lullabyTimer = null; }
    },

    /* ---- オルゴール BGM（短いループを静かに） ---- */

    startBgm() {
      if (!this.ctx || this._bgmTimer) return;
      const melody = [
        [NOTE.E5, 0.5], [NOTE.G5, 0.5], [NOTE.C6, 1.0],
        [NOTE.B5, 0.5], [NOTE.G5, 0.5], [NOTE.A5, 1.0],
        [NOTE.G5, 0.5], [NOTE.E5, 0.5], [NOTE.F5, 0.75], [NOTE.D5, 0.75],
        [NOTE.C5, 1.5],
      ];
      const playOnce = () => {
        let t = 0;
        melody.forEach(([f, d]) => {
          this.tone(f, { when: t, dur: d * 1.1, vol: 0.5, type: 'sine', dest: this.bgmGain });
          t += d * 0.85;
        });
        return t;
      };
      const total = playOnce();
      this._bgmTimer = setInterval(playOnce, (total + 2.2) * 1000);
    },

    stopBgm() {
      if (this._bgmTimer) { clearInterval(this._bgmTimer); this._bgmTimer = null; }
    },
  };

  window.SFX = SFX;
})();
