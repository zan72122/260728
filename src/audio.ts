// All sounds are synthesized with WebAudio — no asset files.
// Kept gentle and toy-like for small children (soft attack, low volume).

type ACtx = AudioContext;

export class Sfx {
  private ctx: ACtx | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private weldNodes: { stop(): void } | null = null;
  private engineNodes: { setRough(r: number): void; setSpeed(s: number): void; stop(): void } | null = null;
  private hydraulicNodes: { stop(): void } | null = null;

  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running' && !!this.master && !!this.noiseBuf;
  }

  private env(peak: number, attack: number, decay: number, when = 0): GainNode {
    const c = this.ctx!;
    const g = c.createGain();
    const t = c.currentTime + when;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master!);
    return g;
  }

  private osc(type: OscillatorType, freq: number, dest: AudioNode, dur: number, when = 0, freqEnd?: number): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    const t = c.currentTime + when;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dest: AudioNode, dur: number, when = 0): void {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf!;
    s.loop = true;
    s.loopStart = Math.random() * 0.5;
    s.connect(dest);
    const t = c.currentTime + when;
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  private filt(type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // ---- one-shots ----

  tap(): void {
    if (!this.ready) return;
    this.osc('sine', 620, this.env(0.12, 0.004, 0.08), 0.1);
  }

  click(pitch = 1): void {
    if (!this.ready) return;
    const g = this.env(0.18, 0.002, 0.05);
    const f = this.filt('bandpass', 1800 * pitch, 2);
    f.connect(g);
    this.noise(f, 0.04);
    this.osc('square', 900 * pitch, this.env(0.06, 0.002, 0.03), 0.03);
  }

  latch(): void {
    // the satisfying safety-lock "カチッ"
    if (!this.ready) return;
    this.click(0.7);
    const g = this.env(0.22, 0.002, 0.1, 0.055);
    const f = this.filt('bandpass', 950, 3);
    f.connect(g);
    this.noise(f, 0.06, 0.055);
    this.osc('triangle', 340, this.env(0.14, 0.003, 0.14, 0.055), 0.12, 0.055, 190);
  }

  ratchet(step = 0): void {
    if (!this.ready) return;
    const p = 1 + step * 0.12;
    this.click(1.1 * p);
    this.click(0.85 * p);
  }

  boltDone(): void {
    if (!this.ready) return;
    this.osc('sine', 720, this.env(0.16, 0.004, 0.2), 0.22);
    this.osc('sine', 1080, this.env(0.12, 0.004, 0.25, 0.07), 0.25, 0.07);
  }

  snapIn(): void {
    if (!this.ready) return;
    this.click(0.8);
    this.osc('triangle', 220, this.env(0.2, 0.004, 0.12, 0.02), 0.14, 0.02, 130);
    this.osc('sine', 880, this.env(0.08, 0.003, 0.18, 0.06), 0.18, 0.06);
  }

  clunk(): void {
    if (!this.ready) return;
    const g = this.env(0.3, 0.004, 0.16);
    const f = this.filt('lowpass', 300, 0.8);
    f.connect(g);
    this.noise(f, 0.1);
    this.osc('sine', 130, this.env(0.25, 0.004, 0.18), 0.2, 0, 60);
  }

  whoosh(speed = 1, dur = 0.5): void {
    if (!this.ready) return;
    const c = this.ctx!;
    const g = this.env(0.22 * Math.min(1.4, speed), 0.05, dur);
    const f = this.filt('bandpass', 400, 0.7);
    const t = c.currentTime;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1400 * Math.min(1.6, speed), t + dur * 0.55);
    f.frequency.exponentialRampToValueAtTime(250, t + dur);
    f.connect(g);
    this.noise(f, dur);
  }

  slideStop(): void {
    if (!this.ready) return;
    const g = this.env(0.16, 0.003, 0.09);
    const f = this.filt('lowpass', 500, 1);
    f.connect(g);
    this.noise(f, 0.07);
    this.osc('sine', 170, this.env(0.14, 0.004, 0.12), 0.13, 0, 90);
  }

  drip(pitch = 1): void {
    if (!this.ready) return;
    this.osc('sine', 900 * pitch, this.env(0.09, 0.004, 0.14), 0.16, 0, 320 * pitch);
  }

  rattleTick(strength = 1): void {
    if (!this.ready) return;
    const g = this.env(0.1 * strength, 0.002, 0.05);
    const f = this.filt('highpass', 2400, 1);
    f.connect(g);
    this.noise(f, 0.035);
  }

  clatter(): void {
    if (!this.ready) return;
    const g = this.env(0.12, 0.002, 0.09);
    const f = this.filt('bandpass', 700, 2.5);
    f.connect(g);
    this.noise(f, 0.06);
  }

  squeakHint(): void {
    if (!this.ready) return;
    this.osc('sine', 520, this.env(0.07, 0.02, 0.14), 0.18, 0, 700);
  }

  happyBeep(): void {
    if (!this.ready) return;
    this.osc('sine', 660, this.env(0.13, 0.008, 0.1), 0.1);
    this.osc('sine', 990, this.env(0.13, 0.008, 0.16, 0.09), 0.16, 0.09);
  }

  robotTalk(): void {
    if (!this.ready) return;
    for (let i = 0; i < 3; i++) {
      this.osc('sine', 500 + Math.random() * 500, this.env(0.06, 0.006, 0.05, i * 0.07), 0.06, i * 0.07);
    }
  }

  horn(): void {
    if (!this.ready) return;
    const g1 = this.env(0.16, 0.01, 0.28);
    const f = this.filt('lowpass', 1600, 1);
    f.connect(g1);
    this.osc('square', 392, f, 0.25);
    this.osc('square', 494, f, 0.25);
  }

  chime(): void {
    if (!this.ready) return;
    const notes = [880, 1108, 1318];
    notes.forEach((n, i) => this.osc('sine', n, this.env(0.1, 0.005, 0.5, i * 0.06), 0.5, i * 0.06));
  }

  jingle(): void {
    if (!this.ready) return;
    const notes = [523, 659, 784, 1046, 784, 1046];
    notes.forEach((n, i) => {
      this.osc('triangle', n, this.env(0.12, 0.008, 0.28, i * 0.13), 0.3, i * 0.13);
      this.osc('sine', n * 2, this.env(0.05, 0.008, 0.3, i * 0.13), 0.3, i * 0.13);
    });
  }

  shineSweep(): void {
    if (!this.ready) return;
    this.osc('sine', 700, this.env(0.1, 0.02, 0.4), 0.45, 0, 2200);
    this.osc('sine', 1400, this.env(0.06, 0.02, 0.45, 0.05), 0.5, 0.05, 3300);
  }

  // ---- continuous ----

  hydraulic(up: boolean, dur: number): void {
    if (!this.ready) return;
    this.hydraulicStop();
    const c = this.ctx!;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.1);
    g.gain.setValueAtTime(0.12, t + dur - 0.12);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master!);
    const f = this.filt('lowpass', 500, 2);
    f.connect(g);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(up ? 60 : 95, t);
    o.frequency.linearRampToValueAtTime(up ? 95 : 55, t + dur);
    o.connect(f);
    o.start(t);
    o.stop(t + dur + 0.05);
    const nf = this.filt('bandpass', 800, 0.8);
    const ng = c.createGain();
    ng.gain.value = 0.28;
    nf.connect(ng);
    ng.connect(g);
    this.noise(nf, dur);
    this.hydraulicNodes = { stop: () => { try { o.stop(); } catch { /* already stopped */ } } };
  }

  hydraulicStop(): void {
    this.hydraulicNodes?.stop();
    this.hydraulicNodes = null;
  }

  weldStart(): void {
    if (!this.ready || this.weldNodes) return;
    const c = this.ctx!;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, c.currentTime);
    out.gain.linearRampToValueAtTime(0.24, c.currentTime + 0.05);
    out.connect(this.master!);

    // low hum
    const hum = c.createOscillator();
    hum.type = 'triangle';
    hum.frequency.value = 72;
    const humG = c.createGain();
    humG.gain.value = 0.35;
    hum.connect(humG);
    humG.connect(out);
    hum.start();

    // crackle: noise gated by a slow noise envelope (audio-rate AM)
    const crack = c.createBufferSource();
    crack.buffer = this.noiseBuf!;
    crack.loop = true;
    const hp = this.filt('highpass', 1800, 0.7);
    const crackG = c.createGain();
    crackG.gain.value = 0.0;
    crack.connect(hp);
    hp.connect(crackG);
    crackG.connect(out);
    crack.start();

    const lfoSrc = c.createBufferSource();
    lfoSrc.buffer = this.noiseBuf!;
    lfoSrc.loop = true;
    lfoSrc.playbackRate.value = 0.03;
    const lfoF = this.filt('lowpass', 28, 0.5);
    const lfoG = c.createGain();
    lfoG.gain.value = 0.9;
    lfoSrc.connect(lfoF);
    lfoF.connect(lfoG);
    lfoG.connect(crackG.gain);
    lfoSrc.start();

    this.weldNodes = {
      stop: () => {
        const t = c.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(0.0001, t + 0.08);
        window.setTimeout(() => {
          try { hum.stop(); crack.stop(); lfoSrc.stop(); } catch { /* noop */ }
          out.disconnect();
        }, 140);
      },
    };
  }

  weldStop(): void {
    this.weldNodes?.stop();
    this.weldNodes = null;
  }

  engineStart(rough: number): void {
    if (!this.ready || this.engineNodes) return;
    const c = this.ctx!;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, c.currentTime);
    out.gain.linearRampToValueAtTime(0.14, c.currentTime + 0.3);
    out.connect(this.master!);
    const f = this.filt('lowpass', 420, 0.8);
    f.connect(out);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 65;
    o.connect(f);
    o.start();
    const sub = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 33;
    const subG = c.createGain();
    subG.gain.value = 0.5;
    sub.connect(subG);
    subG.connect(f);
    sub.start();
    // roughness = AM wobble
    const am = c.createOscillator();
    am.type = 'square';
    am.frequency.value = 21;
    const amG = c.createGain();
    amG.gain.value = 0.0;
    am.connect(amG);
    amG.connect(out.gain);
    am.start();
    const setRough = (r: number): void => {
      amG.gain.setTargetAtTime(0.06 * r, c.currentTime, 0.1);
    };
    const setSpeed = (s: number): void => {
      o.frequency.setTargetAtTime(60 + s * 55, c.currentTime, 0.15);
      sub.frequency.setTargetAtTime(30 + s * 26, c.currentTime, 0.15);
    };
    setRough(rough);
    this.engineNodes = {
      setRough,
      setSpeed,
      stop: () => {
        const t = c.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(0.0001, t + 0.25);
        window.setTimeout(() => {
          try { o.stop(); sub.stop(); am.stop(); } catch { /* noop */ }
          out.disconnect();
        }, 320);
      },
    };
  }

  engineSet(rough: number, speed: number): void {
    this.engineNodes?.setRough(rough);
    this.engineNodes?.setSpeed(speed);
  }

  engineStop(): void {
    this.engineNodes?.stop();
    this.engineNodes = null;
  }

  stopAllLoops(): void {
    this.weldStop();
    this.engineStop();
    this.hydraulicStop();
  }
}
