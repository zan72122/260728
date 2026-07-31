/**
 * Hud.js (A7 AUDIO/UI)
 * ------------------------------------------------------------------
 * ライド中の常設 HUD。DOM ベース（速度ゲージのみ SVG）。
 * update(state, extra) は毎フレーム呼ばれる前提なので、実際に値が変わった
 * ときだけ DOM に書き込む（textContent / style / class の無駄な代入を避ける）。
 */

import './hud.css';

const SVGNS = 'http://www.w3.org/2000/svg';

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
function clamp01(v) {
  return clamp(v, 0, 1);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function pad(n, len) {
  return String(Math.max(0, Math.floor(n))).padStart(len, '0');
}
function formatTime(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const msPart = total % 1000;
  return `${pad(m, 2)}:${pad(s, 2)}.${pad(msPart, 3)}`;
}

// おおよそのコース区間名（A2 のステージ設計 A〜F を進捗率で近似）。
// extra.sectionName が渡されればそちらを優先する。
function sectionForFraction(frac) {
  if (frac >= 0.995) return 'フィニッシュ';
  if (frac < 0.08) return 'ローンチ';
  if (frac < 0.35) return '高速ヘリックス';
  if (frac < 0.55) return 'ダークトンネル';
  if (frac < 0.78) return 'ボウル / ウェーブ';
  if (frac < 0.9) return 'エアタイム区間';
  return 'ラストドロップ';
}

const DEFAULT_TRACK_LENGTH = 650; // extra.trackLength 未指定時のフォールバック（SPEC §4.2: 550〜750m）
const GAUGE_MAX_KMH = 130;

export class Hud {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = document.createElement('div');
    this.root.className = 'av-hud';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.innerHTML = this._template();
    root.appendChild(this.root);

    this._cacheEls();
    this._buildGauge();

    this._visible = true;
    this._trackLength = DEFAULT_TRACK_LENGTH;
    this._hot = false;
    this._last = {
      kmh: null,
      jitter: null,
      gaugeFrac: null,
      timeStr: null,
      bestStr: null,
      gStr: null,
      gFrac: null,
      gClass: null,
      airborne: null,
      airStr: null,
      progFrac: null,
      sectionLabel: null,
    };
  }

  _template() {
    return `
      <div class="av-hud-flow">
        <div class="av-hud-shake">

          <div class="av-hud-top">
            <div class="av-progress av-glass">
              <div class="av-progress-track"><div class="av-progress-fill" data-el="progressFill"></div></div>
              <div class="av-progress-label" data-el="progressLabel">ローンチ</div>
            </div>
            <div class="av-time av-glass">
              <div class="av-time-main" data-el="timeMain">00:00.000</div>
              <div class="av-time-best" data-el="timeBest">ベスト --:--.---</div>
            </div>
          </div>

          <div class="av-airtime av-glass" data-el="airWrap">
            <span class="av-airtime-label">AIR TIME</span><span class="av-airtime-value" data-el="airValue">0.00s</span>
          </div>

          <div class="av-hud-bottom">
            <div class="av-speed av-glass" data-el="speedWrap">
              <svg class="av-speed-svg" viewBox="0 0 200 165" data-el="speedSvg">
                <defs>
                  <linearGradient id="av-speed-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#35e7e0"/>
                    <stop offset="55%" stop-color="#7ef7c4"/>
                    <stop offset="100%" stop-color="#ffd23f"/>
                  </linearGradient>
                </defs>
                <path class="av-speed-track" data-el="gaugeTrack"></path>
                <g class="av-speed-ticks" data-el="gaugeTicks"></g>
                <path class="av-speed-fill" data-el="gaugeFill"></path>
              </svg>
              <div class="av-speed-readout">
                <span class="av-speed-value" data-el="speedValue">0</span>
                <span class="av-speed-unit">km/h</span>
              </div>
            </div>

            <div class="av-gforce av-glass">
              <div class="av-gforce-label">G-FORCE</div>
              <div class="av-gforce-track" data-el="gforceTrack">
                <div class="av-gforce-fill" data-el="gforceFill"></div>
              </div>
              <div class="av-gforce-value" data-el="gforceValue">1.0G</div>
            </div>
          </div>

        </div>
      </div>
    `;
  }

  _cacheEls() {
    this.el = {};
    this.root.querySelectorAll('[data-el]').forEach((node) => {
      this.el[node.getAttribute('data-el')] = node;
    });
  }

  _buildGauge() {
    const cx = 100;
    const cy = 108;
    const r = 74;
    const startDeg = -125;
    const endDeg = 125;
    const toPoint = (deg, radius) => {
      const rad = (deg * Math.PI) / 180;
      return [cx + radius * Math.sin(rad), cy - radius * Math.cos(rad)];
    };
    const [sx, sy] = toPoint(startDeg, r);
    const [ex, ey] = toPoint(endDeg, r);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    const d = `M${sx.toFixed(2)},${sy.toFixed(2)} A${r},${r} 0 ${largeArc} 1 ${ex.toFixed(2)},${ey.toFixed(2)}`;

    this.el.gaugeTrack.setAttribute('d', d);
    this.el.gaugeFill.setAttribute('d', d);

    const tickCount = 6;
    for (let i = 0; i <= tickCount; i++) {
      const t = i / tickCount;
      const deg = lerp(startDeg, endDeg, t);
      const [x1, y1] = toPoint(deg, r + 6);
      const [x2, y2] = toPoint(deg, r + 18);
      const line = document.createElementNS(SVGNS, 'line');
      line.setAttribute('x1', x1.toFixed(2));
      line.setAttribute('y1', y1.toFixed(2));
      line.setAttribute('x2', x2.toFixed(2));
      line.setAttribute('y2', y2.toFixed(2));
      line.setAttribute('class', 'av-speed-tick');
      this.el.gaugeTicks.appendChild(line);
    }

    this._gaugeLength = this.el.gaugeFill.getTotalLength ? this.el.gaugeFill.getTotalLength() : 400;
    this.el.gaugeFill.style.strokeDasharray = String(this._gaugeLength);
    this.el.gaugeFill.style.strokeDashoffset = String(this._gaugeLength);
  }

  // ================================================================
  // 更新（毎フレーム呼ばれる）
  // ================================================================

  /**
   * @param {object} state RiderPhysics.state 相当
   * @param {{timeMs:number, bestMs?:number, trackLength?:number, sectionName?:string}} extra
   */
  update(state, extra = {}) {
    if (!this._visible) return;
    state = state || {};

    const speed = Math.max(0, Number(state.speed) || 0);
    const kmh = speed * 3.6;
    const kmhRounded = Math.round(kmh);

    if (kmhRounded !== this._last.kmh) {
      this.el.speedValue.textContent = String(kmhRounded);
      this._last.kmh = kmhRounded;
    }

    const gaugeFrac = clamp01(kmh / GAUGE_MAX_KMH);
    this._setGaugeFraction(gaugeFrac);

    const hotOn = kmh > GAUGE_MAX_KMH * 0.78;
    const hotOff = kmh < GAUGE_MAX_KMH * 0.66;
    if (!this._hot && hotOn) {
      this._hot = true;
      this.el.speedWrap.classList.add('is-hot');
    } else if (this._hot && hotOff) {
      this._hot = false;
      this.el.speedWrap.classList.remove('is-hot');
    }

    const jitterAmt = Math.round(lerp(0, 2.6, clamp01((kmh - 35) / 95)) * 10) / 10;
    if (jitterAmt !== this._last.jitter) {
      this.root.style.setProperty('--jitter-amt', `${jitterAmt.toFixed(1)}px`);
      this._last.jitter = jitterAmt;
    }

    // --- タイム ---
    const timeStr = formatTime(extra.timeMs);
    if (timeStr !== this._last.timeStr) {
      this.el.timeMain.textContent = timeStr;
      this._last.timeStr = timeStr;
    }
    const bestStr = extra.bestMs != null && isFinite(extra.bestMs)
      ? `ベスト ${formatTime(extra.bestMs)}`
      : 'ベスト --:--.---';
    if (bestStr !== this._last.bestStr) {
      this.el.timeBest.textContent = bestStr;
      this._last.bestStr = bestStr;
    }

    // --- G フォース ---
    const g = Math.max(0, state.gForce != null ? Number(state.gForce) : 1);
    const gStr = `${g.toFixed(1)}G`;
    if (gStr !== this._last.gStr) {
      this.el.gforceValue.textContent = gStr;
      this._last.gStr = gStr;
    }
    const gFrac = clamp01((g - 1) / 3);
    this._setGForceFraction(gFrac);
    let gClass = 'normal';
    if (g > 3) gClass = 'danger';
    else if (g > 2) gClass = 'warn';
    if (gClass !== this._last.gClass) {
      this.el.gforceTrack.classList.remove('is-warn', 'is-danger');
      if (gClass === 'warn') this.el.gforceTrack.classList.add('is-warn');
      if (gClass === 'danger') this.el.gforceTrack.classList.add('is-danger');
      this._last.gClass = gClass;
    }

    // --- エアタイム ---
    const airborne = !!state.airborne;
    if (airborne !== this._last.airborne) {
      this.el.airWrap.classList.toggle('is-visible', airborne);
      this._last.airborne = airborne;
    }
    if (airborne) {
      const airStr = `${Math.max(0, Number(state.airTime) || 0).toFixed(2)}s`;
      if (airStr !== this._last.airStr) {
        this.el.airValue.textContent = airStr;
        this._last.airStr = airStr;
      }
    }

    // --- 進行度 ---
    if (extra.trackLength && extra.trackLength > 50) {
      this._trackLength = extra.trackLength;
    }
    const progFrac = state.finished ? 1 : clamp01((Number(state.s) || 0) / this._trackLength);
    this._setProgressFraction(progFrac);
    const sectionLabel = extra.sectionName || sectionForFraction(progFrac);
    if (sectionLabel !== this._last.sectionLabel) {
      this.el.progressLabel.textContent = sectionLabel;
      this._last.sectionLabel = sectionLabel;
    }
  }

  _setGaugeFraction(frac) {
    const r = Math.round(frac * 1000) / 1000;
    if (r === this._last.gaugeFrac) return;
    this._last.gaugeFrac = r;
    const offset = this._gaugeLength * (1 - r);
    this.el.gaugeFill.style.strokeDashoffset = offset.toFixed(2);
  }

  _setGForceFraction(frac) {
    const r = Math.round(frac * 1000) / 1000;
    if (r === this._last.gFrac) return;
    this._last.gFrac = r;
    this.el.gforceFill.style.transform = `scaleX(${r})`;
  }

  _setProgressFraction(frac) {
    const r = Math.round(frac * 1000) / 1000;
    if (r === this._last.progFrac) return;
    this._last.progFrac = r;
    this.el.progressFill.style.transform = `scaleX(${r})`;
  }

  setVisible(v) {
    const next = !!v;
    if (next === this._visible) return;
    this._visible = next;
    this.root.classList.toggle('is-hidden', !next);
  }

  /** 任意の後片付け（SPEC 契約外のボーナスメソッド）。 */
  dispose() {
    if (this.root && this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
  }
}
