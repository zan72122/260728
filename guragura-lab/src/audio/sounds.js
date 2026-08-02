/**
 * Web Audio による合成効果音。音声ファイルなし。
 * こわい音は使わない：低いゴトゴト、ポトン、ぽよん、キラキラ、ファンファーレ。
 * 本物の緊急地震速報音は使用しない。
 */
export class SoundBox {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.rumble = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  _env(node, t0, attack, decay, peak = 1) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + attack + decay);
    node.connect(g);
    g.connect(this.master);
    return g;
  }

  /** ボタンのぽこっ */
  click() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(760, t + 0.07);
    this._env(o, t, 0.008, 0.12, 0.35);
    o.start(t);
    o.stop(t + 0.16);
  }

  /** くまを持ち上げた「ひょい」 */
  pickup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(330, t);
    o.frequency.exponentialRampToValueAtTime(660, t + 0.12);
    this._env(o, t, 0.01, 0.16, 0.3);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** くまを置いた「ぽふっ」 */
  drop() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.12);
    this._env(o, t, 0.005, 0.18, 0.4);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** 地鳴り（こわくない低いゴトゴト）開始 */
  rumbleStart() {
    if (!this.ctx || this.rumble) return;
    const bufLen = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 90;
    filter.Q.value = 0.7;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    // ゴトゴト感（ゆっくりした振幅の揺らぎ）
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 7;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.35;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start();
    lfo.start();
    this.rumble = { src, gain, lfo };
  }

  /** 地鳴りの強さ 0..1 */
  rumbleLevel(v) {
    if (!this.ctx || !this.rumble) return;
    this.rumble.gain.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.08);
  }

  rumbleStop() {
    if (!this.ctx || !this.rumble) return;
    const { src, gain, lfo } = this.rumble;
    gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    setTimeout(() => {
      try {
        src.stop();
        lfo.stop();
      } catch {}
    }, 600);
    this.rumble = null;
  }

  /** 物が落ちた「ぽとん」 */
  thud(strength = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    const f = 150 + Math.random() * 60;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.1);
    this._env(o, t, 0.004, 0.14, Math.min(0.5, 0.16 + strength * 0.09));
    o.start(t);
    o.stop(t + 0.18);
  }

  /** 机にぽよんと当たった */
  boing() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.06);
    o.frequency.exponentialRampToValueAtTime(200, t + 0.18);
    this._env(o, t, 0.008, 0.24, 0.32);
    o.start(t);
    o.stop(t + 0.28);
  }

  /** 家具がゆっくり倒れた「ぽふん」（低くやわらかい・こわくない） */
  pofun() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.28);
    this._env(o, t, 0.01, 0.42, 0.5);
    o.start(t);
    o.stop(t + 0.5);
    // ふわっとした空気感
    const o2 = this.ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(220, t + 0.03);
    o2.frequency.exponentialRampToValueAtTime(90, t + 0.3);
    this._env(o2, t + 0.03, 0.02, 0.3, 0.15);
    o2.start(t + 0.03);
    o2.stop(t + 0.4);
  }

  /** あぶなかった…（やさしい下降音・こわくない） */
  uhoh() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      const f = i === 0 ? 392 : 311;
      o.frequency.setValueAtTime(f, t + i * 0.18);
      this._env(o, t + i * 0.18, 0.02, 0.22, 0.3);
      o.start(t + i * 0.18);
      o.stop(t + i * 0.18 + 0.26);
    }
  }

  /** キラキラ */
  sparkle() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = [880, 1108, 1318, 1760];
    notes.forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      this._env(o, t + i * 0.07, 0.01, 0.3, 0.18);
      o.start(t + i * 0.07);
      o.stop(t + i * 0.07 + 0.34);
    });
  }

  /** 安全だったときのやさしいファンファーレ */
  fanfare() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const seq = [
      [523, 0],
      [659, 0.12],
      [784, 0.24],
      [1046, 0.38],
    ];
    for (const [f, d] of seq) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      this._env(o, t + d, 0.015, 0.35, 0.28);
      o.start(t + d);
      o.stop(t + d + 0.4);
    }
  }

  /** 巻き戻しのシュルルル */
  whoosh() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1200, t);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.7);
    const v = this.ctx.createOscillator();
    v.type = 'sine';
    v.frequency.value = 18;
    const vg = this.ctx.createGain();
    vg.gain.value = 120;
    v.connect(vg);
    vg.connect(o.frequency);
    this._env(o, t, 0.05, 0.75, 0.16);
    o.start(t);
    o.stop(t + 0.85);
    v.start(t);
    v.stop(t + 0.85);
  }
}
