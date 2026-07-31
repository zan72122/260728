/**
 * AudioEngine.js (A7 AUDIO)
 * ------------------------------------------------------------------
 * すべて WebAudio 合成のみ。音声ファイルは一切読み込まない。
 *
 * レイヤー構成:
 *   flow   : 水流のベース（lowpass ノイズ、400-6000Hz を速度で可変）
 *   rumble : 低域ゴロゴロ（lowpass 120Hz + LFO 変調、速度連動）
 *   spray  : 飛沫トランジェント（bandpass 2k-8k のノイズバースト、レート制限）
 *   wind   : 風切り音（highpass ノイズ、速度^2 連動、airborne で強調）
 *   tunnel : ConvolverNode による合成インパルスレスポンス（RT60≈1.2s）
 *            dry/wet を tunnel フラグでクロスフェード
 *   gforce : 高 G で低域を持ち上げる lowshelf
 *
 * グラフ概形:
 *   flow/rumble/wind/spray -> ambienceBus -> gForceShelf -> dryGain -----+--> masterBus
 *                                                        \-> convolver -> wetGain -/
 *   oneShotBus (playSplash/playWhoosh/playFinish) --------------------------> masterBus
 *                                                  \-(send)-> convolver (共有)
 *   masterBus -> compressor -> masterGain -> destination
 *
 * update(dt, params) は start() 前は完全に安全な no-op。
 * すべての連続変化パラメータは setTargetAtTime / linearRampToValueAtTime で変更し、
 * 直接 .value 代入によるプチノイズを避ける（初期構築時の一度きりの設定を除く）。
 */

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
function clamp01(v) {
  return clamp(v, 0, 1);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

export class AudioEngine {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    this._started = false;
    this._startingPromise = null;
    this._muted = false;
    this._level = 0.85; // マスター基準音量（setMuted の非ミュート時ターゲット）

    // spray（飛沫トランジェント）のレート制御
    this._sprayCooldown = 0.15;

    // 状態のヒステリシス等に使うキャッシュ
    this._speedRef = 30; // m/s 目安上限（SPEC の速度域 8-30m/s）
  }

  // ================================================================
  // start / lifecycle
  // ================================================================

  /** ユーザー操作後に呼ぶ。AudioContext を生成し resume する。 */
  async start() {
    if (this._started) {
      if (this.ctx && this.ctx.state !== 'running') {
        try { await this.ctx.resume(); } catch (e) { /* ignore */ }
      }
      return;
    }
    if (this._startingPromise) {
      return this._startingPromise;
    }
    this._startingPromise = (async () => {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return; // WebAudio 非対応環境は静かに諦める
      this.ctx = new Ctx();
      this._buildGraph();
      try {
        await this.ctx.resume();
      } catch (e) {
        // ユーザー操作外から呼ばれた等 - エラーを投げずに黙って続行
      }
      this._started = true;

      // マスターを 0 からふわっとフェードイン
      const now = this.ctx.currentTime;
      const target = this._muted ? 0 : this._level;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(0, now);
      this.masterGain.gain.linearRampToValueAtTime(target, now + 0.5);
    })();
    return this._startingPromise;
  }

  /** start() 前や AudioContext 非対応時は完全に安全な no-op。 */
  update(dt, params = {}) {
    if (!this._started || !this.ctx) return;
    const now = this.ctx.currentTime;

    const speed = Math.max(0, Number(params.speed) || 0);
    const splashRate = clamp01(Number(params.splashRate) || 0);
    const airborne = !!params.airborne;
    const tunnel = !!params.tunnel;
    const gForce = params.gForce != null ? Number(params.gForce) : 1;

    this._updateFlow(speed, now);
    this._updateRumble(speed, now);
    this._updateWind(speed, airborne, now);
    this._updateTunnel(tunnel, now);
    this._updateGForce(gForce, now);
    this._updateSpray(Math.max(0, Number(dt) || 0), splashRate, now);
  }

  setMuted(m) {
    this._muted = !!m;
    if (!this.ctx || !this.masterGain) return; // start() 前でも状態だけは保持
    const now = this.ctx.currentTime;
    const current = this.masterGain.gain.value;
    const target = this._muted ? 0 : this._level;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(current, now);
    this.masterGain.gain.linearRampToValueAtTime(target, now + 0.06);
  }

  // ================================================================
  // グラフ構築
  // ================================================================

  _buildGraph() {
    const ctx = this.ctx;

    this._loopNoiseBuffer = this._makeNoiseBuffer(4.0);
    this._burstNoiseBuffer = this._makeNoiseBuffer(1.5);

    // ---------------- マスター ----------------
    this.masterBus = ctx.createGain();
    this.masterBus.gain.value = 1;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -20;
    this.compressor.knee.value = 22;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.18;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0; // start() でフェードイン

    this.masterBus.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    // ---------------- トンネル残響（Convolver） ----------------
    this.convolver = ctx.createConvolver();
    this.convolver.normalize = true;
    this.convolver.buffer = this._makeImpulseResponse(1.2);

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1;
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 0.05;

    this.dryGain.connect(this.masterBus);
    this.convolver.connect(this.wetGain);
    this.wetGain.connect(this.masterBus);

    // ---------------- G フォース lowshelf ----------------
    this.gForceShelf = ctx.createBiquadFilter();
    this.gForceShelf.type = 'lowshelf';
    this.gForceShelf.frequency.value = 160;
    this.gForceShelf.gain.value = 0;
    this.gForceShelf.connect(this.dryGain);
    this.gForceShelf.connect(this.convolver);

    // ---------------- アンビエンスバス ----------------
    this.ambienceBus = ctx.createGain();
    this.ambienceBus.gain.value = 1;
    this.ambienceBus.connect(this.gForceShelf);

    this._buildFlowLayer();
    this._buildRumbleLayer();
    this._buildWindLayer();
    this._buildSprayLayer();

    // ---------------- ワンショット（着水/ジャンプ/ゴール） ----------------
    this.oneShotBus = ctx.createGain();
    this.oneShotBus.gain.value = 1;
    this.oneShotBus.connect(this.masterBus);
  }

  /** 1. 水流のベース: lowpass ノイズ、カットオフ&ゲインを速度で駆動。 */
  _buildFlowLayer() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._loopNoiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 0.4;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    src.connect(filter).connect(gain).connect(this.ambienceBus);
    src.start();
    this.flowSource = src;
    this.flowFilter = filter;
    this.flowGain = gain;
  }

  /** 2. 低域のゴロゴロ: lowpass 120Hz + LFO 変調。 */
  _buildRumbleLayer() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._loopNoiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.85; // わずかに音程を下げて質感を分ける
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 120;
    filter.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.value = 0.03;
    src.connect(filter).connect(gain).connect(this.ambienceBus);
    src.start();

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 5;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 16;
    lfo.connect(lfoDepth).connect(filter.frequency);
    lfo.start();

    this.rumbleSource = src;
    this.rumbleFilter = filter;
    this.rumbleGain = gain;
    this.rumbleLFO = lfo;
    this.rumbleLFODepth = lfoDepth;
  }

  /** 4. 風切り音: highpass ノイズ、速度の高域成分。 */
  _buildWindLayer() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._loopNoiseBuffer;
    src.loop = true;
    src.playbackRate.value = 1.15;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1800;
    filter.Q.value = 0.3;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.ambienceBus);
    src.start();
    this.windSource = src;
    this.windFilter = filter;
    this.windGain = gain;
  }

  /** 3. 飛沫のトランジェント用バス（発生自体は _updateSpray が駆動）。 */
  _buildSprayLayer() {
    const ctx = this.ctx;
    this.sprayBus = ctx.createGain();
    this.sprayBus.gain.value = 1;
    this.sprayBus.connect(this.ambienceBus);
  }

  // ================================================================
  // 毎フレーム更新（すべて setTargetAtTime でスムージング）
  // ================================================================

  _updateFlow(speed, now) {
    const t = clamp01(speed / this._speedRef);
    const curved = Math.pow(t, 0.8);
    const freq = lerp(400, 6000, curved);
    const gain = lerp(0.05, 0.42, t);
    this.flowFilter.frequency.setTargetAtTime(freq, now, 0.12);
    this.flowGain.gain.setTargetAtTime(gain, now, 0.15);
  }

  _updateRumble(speed, now) {
    const t = clamp01(speed / this._speedRef);
    const gain = lerp(0.04, 0.32, Math.pow(t, 1.15));
    const lfoFreq = lerp(4, 11, t);
    const lfoDepth = lerp(10, 42, t);
    this.rumbleGain.gain.setTargetAtTime(gain, now, 0.18);
    this.rumbleLFO.frequency.setTargetAtTime(lfoFreq, now, 0.3);
    this.rumbleLFODepth.gain.setTargetAtTime(lfoDepth, now, 0.3);
  }

  _updateWind(speed, airborne, now) {
    const t = clamp01(speed / this._speedRef);
    const base = Math.pow(t, 2) * 0.3;
    const boost = airborne ? 1.8 : 1.0;
    const freq = lerp(1400, 2600, t);
    this.windFilter.frequency.setTargetAtTime(freq, now, 0.2);
    this.windGain.gain.setTargetAtTime(base * boost, now, airborne ? 0.1 : 0.25);
  }

  _updateTunnel(tunnel, now) {
    const dryTarget = tunnel ? 0.55 : 1.0;
    const wetTarget = tunnel ? 0.85 : 0.05;
    // 「0.15s くらいのランプ」: setTargetAtTime の時定数として使用
    this.dryGain.gain.setTargetAtTime(dryTarget, now, 0.09);
    this.wetGain.gain.setTargetAtTime(wetTarget, now, 0.09);
  }

  _updateGForce(gForce, now) {
    const over = clamp(gForce - 1, 0, 3);
    const db = lerp(0, 13, clamp01(over / 2.2));
    this.gForceShelf.gain.setTargetAtTime(db, now, 0.12);
  }

  /** 飛沫トランジェント: splashRate に応じてランダム間隔・レート制限付きで発生。 */
  _updateSpray(dt, splashRate, now) {
    this._sprayCooldown -= dt;
    if (splashRate <= 0.015) {
      if (this._sprayCooldown < 0.05) this._sprayCooldown = 0.05;
      return;
    }
    if (this._sprayCooldown <= 0) {
      this._fireSprayBurst(splashRate, now);
      const minInterval = 0.045; // 上限 ~22 バースト/秒
      const maxInterval = 0.4;
      const interval = lerp(maxInterval, minInterval, clamp01(splashRate));
      this._sprayCooldown = interval * (0.65 + Math.random() * 0.7);
    }
  }

  _fireSprayBurst(splashRate, now) {
    const ctx = this.ctx;
    const dur = 0.16;
    const src = ctx.createBufferSource();
    src.buffer = this._burstNoiseBuffer;
    src.playbackRate.value = 0.9 + Math.random() * 0.35;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2000 + Math.random() * 6000; // 2k〜8k
    filter.Q.value = 0.8 + Math.random() * 1.3;

    const env = ctx.createGain();
    const peak = (0.16 + Math.random() * 0.22) * (0.35 + splashRate * 0.8);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.02); // 20ms アタック
    env.gain.linearRampToValueAtTime(0, now + 0.02 + 0.12); // 120ms リリース

    src.connect(filter).connect(env).connect(this.sprayBus);

    const offset = this._randBufferOffset(this._burstNoiseBuffer, dur);
    src.start(now, offset, dur + 0.02);
    src.stop(now + dur + 0.05);
    src.onended = () => {
      try {
        src.disconnect();
        filter.disconnect();
        env.disconnect();
      } catch (e) { /* already disconnected */ }
    };
  }

  // ================================================================
  // ワンショット SFX
  // ================================================================

  /** 7. 着水スプラッシュ: 大きな低域ドスン + 高域のシャワー。 */
  playSplash(intensity = 1) {
    if (!this._started || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const amt = clamp(Number(intensity) || 0, 0, 2.5);
    if (amt <= 0.001) return;

    // --- 低域ドスン（サイン波の下降スイープ）---
    const thudOsc = ctx.createOscillator();
    thudOsc.type = 'sine';
    thudOsc.frequency.setValueAtTime(180, now);
    thudOsc.frequency.exponentialRampToValueAtTime(46, now + 0.22);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.0001, now);
    thudGain.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.8 * amt), now + 0.012);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    thudOsc.connect(thudGain);

    // --- 低域ノイズ（ドスンに質感を足す）---
    const thumpSrc = ctx.createBufferSource();
    thumpSrc.buffer = this._burstNoiseBuffer;
    const thumpFilter = ctx.createBiquadFilter();
    thumpFilter.type = 'lowpass';
    thumpFilter.frequency.value = 220;
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.0001, now);
    thumpGain.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.5 * amt), now + 0.008);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    thumpSrc.connect(thumpFilter).connect(thumpGain);

    // --- 高域のシャワー ---
    const showerSrc = ctx.createBufferSource();
    showerSrc.buffer = this._burstNoiseBuffer;
    const showerHP = ctx.createBiquadFilter();
    showerHP.type = 'highpass';
    showerHP.frequency.value = 3200;
    const showerPeak = ctx.createBiquadFilter();
    showerPeak.type = 'peaking';
    showerPeak.frequency.value = 6200;
    showerPeak.Q.value = 0.9;
    showerPeak.gain.value = 6;
    const showerGain = ctx.createGain();
    showerGain.gain.setValueAtTime(0.0001, now);
    showerGain.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.45 * amt), now + 0.03);
    showerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    showerSrc.connect(showerHP).connect(showerPeak).connect(showerGain);

    const bus = ctx.createGain();
    bus.gain.value = 1;
    thudGain.connect(bus);
    thumpGain.connect(bus);
    showerGain.connect(bus);
    bus.connect(this.oneShotBus);

    const send = ctx.createGain();
    send.gain.value = 0.3;
    bus.connect(send);
    send.connect(this.convolver);

    const thumpOffset = this._randBufferOffset(this._burstNoiseBuffer, 0.4);
    const showerOffset = this._randBufferOffset(this._burstNoiseBuffer, 0.85);

    thudOsc.start(now);
    thudOsc.stop(now + 0.55);
    thumpSrc.start(now, thumpOffset, 0.4);
    thumpSrc.stop(now + 0.4);
    showerSrc.start(now, showerOffset, 0.85);
    showerSrc.stop(now + 0.85);

    const cleanup = () => {
      [thudOsc, thumpSrc, showerSrc].forEach((n) => {
        try { n.disconnect(); } catch (e) { /* noop */ }
      });
      [thudGain, thumpGain, showerGain, thumpFilter, showerHP, showerPeak, bus, send].forEach((n) => {
        try { n.disconnect(); } catch (e) { /* noop */ }
      });
    };
    showerSrc.onended = cleanup;
  }

  /** 8. ジャンプ時のフィルタースイープ。 */
  playWhoosh() {
    if (!this._started || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this._burstNoiseBuffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(260, now);
    filter.frequency.exponentialRampToValueAtTime(3200, now + 0.26);
    filter.frequency.exponentialRampToValueAtTime(650, now + 0.75);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);

    src.connect(filter).connect(gain).connect(this.oneShotBus);

    const send = ctx.createGain();
    send.gain.value = 0.18;
    gain.connect(send);
    send.connect(this.convolver);

    src.start(now);
    src.stop(now + 0.85);
    src.onended = () => {
      [src, filter, gain, send].forEach((n) => {
        try { n.disconnect(); } catch (e) { /* noop */ }
      });
    };
  }

  /** 9. ゴールのチャイム: 明るい和音アルペジオ + ディレイ。 */
  playFinish() {
    if (!this._started || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 共有ディレイ（シマー用フィードバックディレイ）
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.24;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    const delayFilter = ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 3200;
    delay.connect(delayFilter);
    delayFilter.connect(feedback);
    feedback.connect(delay);
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.55;
    delay.connect(delayOut);
    delayOut.connect(this.oneShotBus);
    delayOut.connect(this.convolver);

    // C メジャー系の明るいアルペジオ（C5,E5,G5,B5,C6,E6）+ 最後に和音で伸ばす
    const arpeggio = [523.25, 659.25, 783.99, 987.77, 1046.5, 1318.51];
    arpeggio.forEach((freq, i) => {
      const t0 = now + i * 0.11;
      this._chimeTone(freq, t0, delay, { dur: 0.9, peak: 0.3 });
    });
    const chordAt = now + arpeggio.length * 0.11 + 0.04;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq) => {
      this._chimeTone(freq, chordAt, delay, { dur: 1.5, peak: 0.22 });
    });

    // ディレイチェーンの後片付け（十分減衰した後に切断）
    const disposeAt = (arpeggio.length * 110 + 1500 + 2000);
    setTimeout(() => {
      [delay, feedback, delayFilter, delayOut].forEach((n) => {
        try { n.disconnect(); } catch (e) { /* noop */ }
      });
    }, disposeAt);
  }

  _chimeTone(freq, t0, delayNode, opts = {}) {
    const ctx = this.ctx;
    const dur = opts.dur ?? 0.9;
    const peak = opts.peak ?? 0.3;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = freq;
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = freq * 2.003; // わずかにデチューンした倍音でキラつきを足す
    const g2 = ctx.createGain();
    g2.gain.value = 0.16;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc1.connect(env);
    osc2.connect(g2).connect(env);
    env.connect(this.oneShotBus);
    env.connect(delayNode);

    osc1.start(t0);
    osc1.stop(t0 + dur + 0.05);
    osc2.start(t0);
    osc2.stop(t0 + dur + 0.05);
    osc1.onended = () => {
      [osc1, osc2, g2, env].forEach((n) => {
        try { n.disconnect(); } catch (e) { /* noop */ }
      });
    };
  }

  // ================================================================
  // ノイズ / インパルスレスポンス生成
  // ================================================================

  _makeNoiseBuffer(seconds) {
    const ctx = this.ctx;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    return buffer;
  }

  /** 合成インパルスレスポンス: 指数減衰ノイズ、RT60 で -60dB になるよう調整。 */
  _makeImpulseResponse(rt60) {
    const ctx = this.ctx;
    const length = Math.max(1, Math.floor(ctx.sampleRate * rt60));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    const decayRate = 6.907755 / rt60; // ln(1000) / RT60
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / ctx.sampleRate;
        const envelope = Math.exp(-t * decayRate);
        data[i] = (Math.random() * 2 - 1) * envelope;
      }
    }
    return buffer;
  }

  _randBufferOffset(buffer, take) {
    const max = Math.max(0, buffer.duration - take - 0.02);
    return Math.random() * max;
  }
}
