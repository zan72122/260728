// 100% procedural WebAudio sound design. See docs/CONTRACTS.md
// (section "src/cameraFX.js + src/audio.js — I"). No audio files.
// Every public method must never throw, even when the AudioContext is
// locked/absent (iOS Safari before first touch, etc.) — silent no-op.

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// White noise fill.
function fillWhite(data) {
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

// Paul Kellet's pink-noise approximation — warmer, deeper texture used for
// the "body" whoosh and squelch layers.
function fillPink(data) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    data[i] = pink * 0.11;
  }
}

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.compressor = null;
    this._noiseWhite = null;
    this._noisePink = null;
    this._noiseClick = null;
    // MEGA (docs/CONTRACTS-MEGA.md "M5"): preImpactHush()'s auto-restore
    // fallback timer id.
    this._hushRestoreTimer = null;
    this._masterLevel = 0.5; // kept in sync with unlock()'s safe master level
  }

  // Create/resume the AudioContext. Idempotent — safe to call repeatedly
  // (main calls it on first pointerdown, per contract H).
  unlock() {
    try {
      if (!this.ctx) {
        const Ctx = (typeof window !== 'undefined') &&
          (window.AudioContext || window.webkitAudioContext);
        if (!Ctx) return;
        this.ctx = new Ctx();

        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5; // safe master level, no clipping

        this.compressor = this.ctx.createDynamicsCompressor();
        this._safeParam(this.compressor.threshold, -24);
        this._safeParam(this.compressor.knee, 28);
        this._safeParam(this.compressor.ratio, 4);
        this._safeParam(this.compressor.attack, 0.003);
        this._safeParam(this.compressor.release, 0.25);

        this.master.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);

        this._buildNoiseBuffers();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) {
      // locked / unavailable — silently no-op
    }
  }

  _safeParam(param, value) {
    if (param && typeof param.value !== 'undefined') param.value = value;
  }

  _buildNoiseBuffers() {
    const sr = this.ctx.sampleRate;
    this._noiseWhite = this.ctx.createBuffer(1, Math.floor(sr * 1.0), sr);
    fillWhite(this._noiseWhite.getChannelData(0));
    this._noisePink = this.ctx.createBuffer(1, Math.floor(sr * 1.0), sr);
    fillPink(this._noisePink.getChannelData(0));
    this._noiseClick = this.ctx.createBuffer(1, Math.floor(sr * 0.08), sr);
    fillWhite(this._noiseClick.getChannelData(0));
  }

  // ---- generic synth building blocks -----------------------------------
  _noiseBurst(opts) {
    const ctx = this.ctx;
    const {
      buffer, start = 0, duration = 0.1, filterType = 'lowpass',
      freq = 1000, freqEnd = null, Q = 0.9, gain = 0.3, attack = 0.005,
    } = opts;
    const t0 = ctx.currentTime + start;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filt = ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) filt.frequency.linearRampToValueAtTime(freqEnd, t0 + duration);
    filt.Q.value = Q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(Math.max(gain, 0.0002), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t0, 0, duration);
    src.stop(t0 + duration + 0.03);
  }

  _tone(opts) {
    const ctx = this.ctx;
    const {
      start = 0, duration = 0.15, type = 'sine', freq = 440,
      freqEnd = null, gain = 0.25, attack = 0.005,
    } = opts;
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(Math.max(gain, 0.0002), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  _squelch(intensity) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const dur = lerp(0.25, 0.42, clamp01(intensity));
    const src = ctx.createBufferSource();
    src.buffer = this._noiseWhite;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 650;
    filt.Q.value = 4;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain);
    lfoGain.connect(filt.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(lerp(0.15, 0.3, clamp01(intensity)), t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    lfo.start(t0);
    src.start(t0, 0, dur);
    lfo.stop(t0 + dur + 0.03);
    src.stop(t0 + dur + 0.03);
  }

  _glug(cupTrap) {
    const baseFreqs = [560, 430, 330];
    for (let i = 0; i < baseFreqs.length; i++) {
      this._tone({
        type: 'triangle',
        freq: baseFreqs[i] + (Math.random() * 20 - 10),
        freqEnd: baseFreqs[i] * 0.8,
        duration: 0.07,
        gain: lerp(0.1, 0.28, clamp01(cupTrap)),
        attack: 0.003,
        start: i * 0.085,
      });
    }
  }

  // ---- public sound events ----------------------------------------------
  onGrab(def) {
    try {
      if (!this.ctx) return;
      const radius = (def && def.radius) || 0.3;
      const freq = lerp(680, 320, clamp01(radius / 0.5));
      this._tone({ type: 'triangle', freq, freqEnd: freq * 1.15, duration: 0.1, gain: 0.16, attack: 0.003 });
    } catch (e) {
      // no-op
    }
  }

  onRelease(def) {
    try {
      if (!this.ctx) return;
      this._noiseBurst({
        buffer: this._noiseWhite, duration: 0.15, filterType: 'bandpass',
        freq: 1400, freqEnd: 500, Q: 1.0, gain: 0.14, attack: 0.005,
      });
    } catch (e) {
      // no-op
    }
  }

  onImpact(spec) {
    try {
      if (!this.ctx || !spec) return;
      const energy = clamp01(spec.energy || 0);
      const flatness = clamp01(spec.flatness || 0);
      const cupTrap = clamp01(spec.cupTrap || 0);
      const id = spec.def && spec.def.id;

      // (a) initial slap — filtered noise burst; flatness brightens it.
      const bright = flatness > 0.6;
      this._noiseBurst({
        buffer: this._noiseWhite,
        duration: bright ? lerp(0.05, 0.09, energy) : lerp(0.07, 0.16, energy),
        filterType: bright ? 'bandpass' : 'lowpass',
        freq: bright ? lerp(2200, 4200, energy) : lerp(500, 2600, energy),
        Q: bright ? 1.4 : 0.9,
        gain: lerp(0.18, 0.55, energy),
        attack: 0.004,
      });

      // (b) body — deeper filtered noise whoosh, bigger for heavy/energetic.
      this._noiseBurst({
        buffer: this._noisePink,
        duration: lerp(0.22, 0.42, energy),
        filterType: 'lowpass',
        freq: lerp(220, 900, energy),
        freqEnd: lerp(140, 500, energy),
        Q: 0.7,
        gain: lerp(0.12, 0.48, energy),
        attack: 0.015,
      });

      // (c) character layer, keyed by toy id / cupTrap.
      if (id === 'pingpong') {
        this._tone({ type: 'sine', freq: 950, freqEnd: 680, duration: 0.09, gain: 0.22, attack: 0.002 });
      } else if (id === 'heavyball') {
        this._tone({
          type: 'sine', freq: 92, freqEnd: 54,
          duration: lerp(0.28, 0.42, energy), gain: lerp(0.3, 0.6, energy), attack: 0.006,
        });
      } else if (id === 'jelly' || id === 'sponge') {
        this._squelch(energy);
      }
      if (cupTrap > 0.5) {
        this._glug(cupTrap);
      }

      // (d) sparkle droplets — a few tiny delayed high plips.
      const dropletCount = 3 + Math.round(energy * 2);
      for (let i = 0; i < dropletCount; i++) {
        this._noiseBurst({
          buffer: this._noiseClick,
          start: 0.04 + Math.random() * 0.32,
          duration: 0.02 + Math.random() * 0.02,
          filterType: 'bandpass',
          freq: 3200 + Math.random() * 2800,
          Q: 3,
          gain: 0.05 + Math.random() * 0.06,
          attack: 0.002,
        });
      }

      // Haptics — guarded for iOS Safari absence.
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate(Math.round(30 + 90 * energy));
        }
      } catch (e) {
        // no-op
      }
    } catch (e) {
      // never throw — audio must not break the game
    }
  }

  onResurface(def) {
    try {
      if (!this.ctx) return;
      this._noiseBurst({
        buffer: this._noiseClick, duration: 0.045, filterType: 'bandpass',
        freq: 1800, Q: 2.5, gain: 0.22, attack: 0.002,
      });
      this._tone({ type: 'sine', freq: 500, freqEnd: 1200, duration: 0.09, gain: 0.18, attack: 0.003, start: 0.01 });
    } catch (e) {
      // no-op
    }
  }

  onJet() {
    try {
      if (!this.ctx) return;
      this._noiseBurst({
        buffer: this._noisePink, duration: 0.3, filterType: 'bandpass',
        freq: 300, freqEnd: 900, Q: 0.8, gain: 0.16, attack: 0.02,
      });
    } catch (e) {
      // no-op
    }
  }

  // ---- MEGA (docs/CONTRACTS-MEGA.md "M5") --------------------------------

  // Ramp the master gain back toward its normal level (used both by the
  // preImpactHush() auto-restore fallback and, deliberately, at the top of
  // onMegaImpact() so the boom is never still-ducked when it fires).
  _restoreMasterGain(rampS) {
    try {
      if (!this.ctx || !this.master) return;
      if (this._hushRestoreTimer) {
        clearTimeout(this._hushRestoreTimer);
        this._hushRestoreTimer = null;
      }
      const t0 = this.ctx.currentTime;
      const g = this.master.gain;
      g.cancelScheduledValues(t0);
      g.setValueAtTime(g.value, t0);
      g.linearRampToValueAtTime(this._masterLevel, t0 + Math.max(rampS, 0.01));
    } catch (e) {
      // no-op
    }
  }

  // 0.3s pre-impact SILENCE dip: duck the master gain to ~0.05 over 0.15s.
  // Called by gameflow during a mega flight, ~0.3s before the toy reaches
  // the water. Auto-restores on the NEXT impact (onMegaImpact calls
  // _restoreMasterGain itself) or after 1s if that never arrives, so a
  // dropped/aborted mega flight can never leave the game permanently quiet.
  preImpactHush() {
    try {
      if (!this.ctx || !this.master) return;
      const t0 = this.ctx.currentTime;
      const g = this.master.gain;
      g.cancelScheduledValues(t0);
      g.setValueAtTime(g.value, t0);
      g.linearRampToValueAtTime(0.05, t0 + 0.15);
      if (this._hushRestoreTimer) clearTimeout(this._hushRestoreTimer);
      this._hushRestoreTimer = setTimeout(() => this._restoreMasterGain(0.2), 1000);
    } catch (e) {
      // no-op
    }
  }

  // Low, LFO-wobbled lowpass-noise "slosh groan" — a few of these are
  // scheduled by onMegaImpact between +5s and +8s.
  _sloshGroan(startS) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + startS;
    const dur = 1.1 + Math.random() * 0.4;
    const src = ctx.createBufferSource();
    src.buffer = this._noisePink;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 220;
    filt.Q.value = 1.2;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.8 + Math.random() * 0.4;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain);
    lfoGain.connect(filt.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.12, t0 + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    lfo.start(t0);
    src.start(t0, 0, dur);
    lfo.stop(t0 + dur + 0.05);
    src.stop(t0 + dur + 0.05);
  }

  // Mega impact: routed INSTEAD of onImpact for spec.mega impacts (main.js
  // wiring) — onImpact itself stays completely unchanged. Restores any
  // pending preImpactHush duck immediately, then: 40-70Hz sub boom (long
  // decay ~1.5s, slight pitch drop) + layered noise crash; wall-wave
  // "zabaaa" bandpass sweep at +0.8s; rain loop (filtered noise, gentle,
  // ~3s) from +3s; 2-3 low slosh groans between +5s and +8s; long haptic
  // pattern.
  onMegaImpact(spec) {
    try {
      if (!this.ctx) return;
      this._restoreMasterGain(0.05);

      const energy = clamp01((spec && spec.energy) || 0.8);
      const scaleT = clamp01((((spec && spec.megaScale) || 1) - 1) / 6);

      // (a) sub-bass boom — 40-70Hz, long decay ~1.5s, slight downward
      // pitch drop; bigger toys (higher megaScale) sit lower in the range.
      this._tone({
        type: 'sine',
        freq: lerp(70, 40, scaleT),
        freqEnd: lerp(45, 26, scaleT),
        duration: 1.5,
        gain: lerp(0.4, 0.75, energy),
        attack: 0.01,
      });

      // (b) layered noise crash — initial slap + deeper body whoosh, same
      // shape as onImpact's (a)/(b) layers but bigger/longer for the mega
      // scale of the moment.
      this._noiseBurst({
        buffer: this._noiseWhite, duration: lerp(0.18, 0.32, energy), filterType: 'lowpass',
        freq: lerp(700, 2200, energy), freqEnd: lerp(300, 900, energy), Q: 0.8,
        gain: lerp(0.35, 0.7, energy), attack: 0.004,
      });
      this._noiseBurst({
        buffer: this._noisePink, duration: lerp(0.5, 0.9, energy), filterType: 'lowpass',
        freq: lerp(180, 500, energy), freqEnd: lerp(90, 260, energy), Q: 0.6,
        gain: lerp(0.25, 0.55, energy), attack: 0.02,
      });

      // (c) wall-wave "zabaaa" — bandpass sweep at +0.8s.
      this._noiseBurst({
        buffer: this._noisePink, start: 0.8, duration: 0.9, filterType: 'bandpass',
        freq: 900, freqEnd: 260, Q: 0.9, gain: 0.32, attack: 0.05,
      });

      // (d) rain loop — gentle filtered noise, ~3s, starting at +3s.
      this._noiseBurst({
        buffer: this._noiseWhite, start: 3.0, duration: 3.0, filterType: 'lowpass',
        freq: 2400, freqEnd: 1400, Q: 0.5, gain: 0.1, attack: 0.3,
      });

      // (e) 2-3 low slosh groans between +5s and +8s.
      const groanCount = 2 + (Math.random() < 0.5 ? 0 : 1);
      for (let i = 0; i < groanCount; i++) {
        this._sloshGroan(5.0 + i * 1.4 + Math.random() * 0.6);
      }

      // Long haptic pattern — guarded for iOS Safari / no-vibrate devices.
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([80, 60, 40, 200]);
        }
      } catch (e) {
        // no-op
      }
    } catch (e) {
      // never throw — audio must not break the game
    }
  }
}
