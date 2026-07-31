/**
 * Screens.js (A7 AUDIO/UI)
 * ------------------------------------------------------------------
 * タイトル / ローディング / リザルトのオーバーレイ画面。
 * onStart / onRestart はキーボード（Space / R）とクリックの両方で発火する。
 */

import './hud.css';

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
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export class Screens {
  /**
   * @param {HTMLElement} root
   * @param {{onStart?:Function, onRestart?:Function}} callbacks
   */
  constructor(root, callbacks = {}) {
    this.callbacks = callbacks || {};
    this.root = document.createElement('div');
    this.root.className = 'av-screens';
    this.root.innerHTML = this._template();
    root.appendChild(this.root);

    this._cacheEls();

    this._current = null;
    this._rafId = null;
    this._lastLoadingPct = null;

    this._onKeyDown = this._onKeyDown.bind(this);
    window.addEventListener('keydown', this._onKeyDown);
    this._bindClicks();
  }

  _template() {
    return `
      <div class="av-screen av-screen--title" data-screen="title">
        <div class="av-screen-inner av-title-panel av-glass">
          <h1 class="av-logo">AQUA<br/>VELOCITY</h1>
          <p class="av-subtitle">灼熱の楽園を、水しぶきと共に滑走せよ</p>
          <ul class="av-controls" aria-label="操作方法">
            <li><span class="av-key">&larr;&rarr;</span><span class="av-key">A/D</span><span class="av-desc">左右移動</span></li>
            <li><span class="av-key">Shift</span><span class="av-desc">タック加速</span></li>
            <li><span class="av-key">Space</span><span class="av-desc">ブレーキ</span></li>
            <li><span class="av-key">C</span><span class="av-desc">視点切替</span></li>
            <li><span class="av-key">R</span><span class="av-desc">リスタート</span></li>
            <li><span class="av-key">M</span><span class="av-desc">ミュート</span></li>
          </ul>
          <button type="button" class="av-start-prompt" data-el="startPrompt">
            <span>SPACE</span> または <span>クリック</span> でスタート
          </button>
        </div>
      </div>

      <div class="av-screen av-screen--loading" data-screen="loading">
        <div class="av-screen-inner av-loading-panel av-glass">
          <div class="av-loading-logo">AQUA VELOCITY</div>
          <div class="av-loading-bar">
            <div class="av-loading-fill" data-el="loadingFill">
              <span class="av-loading-wave"></span>
              <span class="av-loading-wave av-loading-wave--2"></span>
            </div>
            <div class="av-loading-bubbles">
              <span></span><span></span><span></span><span></span><span></span>
            </div>
          </div>
          <div class="av-loading-pct" data-el="loadingPct">0%</div>
          <div class="av-loading-caption">読み込み中&hellip;</div>
        </div>
      </div>

      <div class="av-screen av-screen--result" data-screen="result">
        <div class="av-screen-inner av-result-panel av-glass">
          <div class="av-newbest" data-el="newBest">NEW RECORD!</div>
          <h2 class="av-result-title">フィニッシュ！</h2>
          <div class="av-result-grid">
            <div class="av-result-item">
              <div class="av-result-label">タイム</div>
              <div class="av-result-value" data-el="resultTime">00:00.000</div>
              <div class="av-result-sub" data-el="resultBestRef">自己ベスト --:--.---</div>
            </div>
            <div class="av-result-item">
              <div class="av-result-label">最高速度</div>
              <div class="av-result-value" data-el="resultSpeed">0 km/h</div>
            </div>
            <div class="av-result-item">
              <div class="av-result-label">最長エアタイム</div>
              <div class="av-result-value" data-el="resultAir">0.00s</div>
            </div>
          </div>
          <button type="button" class="av-retry-prompt" data-el="retryPrompt">
            <span>R</span>でリトライ
          </button>
        </div>
      </div>
    `;
  }

  _cacheEls() {
    this.screenEls = {};
    this.root.querySelectorAll('[data-screen]').forEach((node) => {
      this.screenEls[node.getAttribute('data-screen')] = node;
    });
    this.el = {};
    this.root.querySelectorAll('[data-el]').forEach((node) => {
      this.el[node.getAttribute('data-el')] = node;
    });
  }

  _bindClicks() {
    // タイトル画面はパネル全体のクリックでスタート
    this.screenEls.title.addEventListener('click', () => {
      if (this._current === 'title') this._fireStart();
    });
    this.el.startPrompt.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._current === 'title') this._fireStart();
    });
    this.el.retryPrompt.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._current === 'result') this._fireRestart();
    });
  }

  _onKeyDown(e) {
    if (this._current === 'title' && e.code === 'Space') {
      e.preventDefault();
      this._fireStart();
    } else if (this._current === 'result' && (e.code === 'KeyR' || e.key === 'r' || e.key === 'R')) {
      this._fireRestart();
    }
  }

  _fireStart() {
    if (typeof this.callbacks.onStart === 'function') this.callbacks.onStart();
  }
  _fireRestart() {
    if (typeof this.callbacks.onRestart === 'function') this.callbacks.onRestart();
  }

  // ================================================================
  // 画面切り替え
  // ================================================================

  showTitle() {
    this._activate('title');
  }

  showLoading(pct) {
    this._activate('loading');
    const clamped = clamp(Number(pct) || 0, 0, 100);
    const rounded = Math.round(clamped);
    if (rounded !== this._lastLoadingPct) {
      this._lastLoadingPct = rounded;
      this.el.loadingPct.textContent = `${rounded}%`;
      this.el.loadingFill.style.transform = `scaleX(${(clamped / 100).toFixed(4)})`;
    }
  }

  /**
   * @param {{timeMs:number, topSpeed:number, maxAir:number, bestMs?:number, isNewBest?:boolean}} result
   */
  showResult(result) {
    this._activate('result');
    this._populateResult(result || {});
  }

  hideAll() {
    this._current = null;
    Object.values(this.screenEls).forEach((elm) => elm.classList.remove('is-active'));
    this._stopCountUp();
  }

  _activate(name) {
    if (this._current !== name) {
      this._current = name;
      Object.entries(this.screenEls).forEach(([key, elm]) => {
        elm.classList.toggle('is-active', key === name);
      });
    }
  }

  _populateResult(result) {
    this._stopCountUp();

    const timeMs = Math.max(0, Number(result.timeMs) || 0);
    const topSpeedKmh = Math.max(0, (Number(result.topSpeed) || 0) * 3.6);
    const maxAir = Math.max(0, Number(result.maxAir) || 0);
    const bestMs = result.bestMs;
    const isNewBest = !!result.isNewBest;

    this.el.newBest.classList.toggle('is-shown', isNewBest);
    this.el.resultBestRef.textContent = bestMs != null && isFinite(bestMs)
      ? `自己ベスト ${formatTime(bestMs)}`
      : '自己ベスト --:--.---';

    const duration = 1200;
    const start = performance.now();

    const tick = (now) => {
      const t = clamp01((now - start) / duration);
      const e = easeOutCubic(t);
      this.el.resultTime.textContent = formatTime(lerp(0, timeMs, e));
      this.el.resultSpeed.textContent = `${Math.round(lerp(0, topSpeedKmh, e))} km/h`;
      this.el.resultAir.textContent = `${lerp(0, maxAir, e).toFixed(2)}s`;
      if (t < 1) {
        this._rafId = requestAnimationFrame(tick);
      } else {
        this._rafId = null;
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopCountUp() {
    if (this._rafId != null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /** 任意の後片付け（SPEC 契約外のボーナスメソッド）。 */
  dispose() {
    this._stopCountUp();
    window.removeEventListener('keydown', this._onKeyDown);
    if (this.root && this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
  }
}
