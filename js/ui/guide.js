// js/ui/guide.js — Agent P
// 「こねこね！パンの森」進行バー・光る誘導・音声ガイド。
// ユーザーテストで「こね段階から先へ進めない」ことが判明したための介助システム。
// 4歳児が文字を読めなくても「今ここ・次はこれ」を一目で分かるようにする。
//
// 契約 (docs/SPEC-GUIDE.md Agent P):
//   export class GuideBar {
//     constructor(root, callbacks)   // callbacks: { onStepTap(stepId) }
//     setMethod(method)              // 'bake'|'fry'|'steam'
//     setCurrent(stepId)
//     setReady(stepId, ready)
//     wiggle(stepId)
//     highlightRect(stepId)
//     destroy()
//   }
//   export const Voice = { say(text, opts), cancel(), setMuted(bool), muted }
//
// このファイルは DOM/speechSynthesis 以外に副作用を持たない。main.js が
// 進行条件の判定を行い、GuideBar/Voice は「見た目・声」だけを担当する。

const STEPS = [
  { id: 'knead', icon: '👐', label: 'こねる' },
  { id: 'rest', icon: '🧺', label: 'ねかせる' },
  { id: 'cook', icon: '🔥', label: 'やく' },
  { id: 'forest', icon: '🌲', label: 'もりへ' },
];

const METHOD_ICON = { bake: '🔥', fry: '🍳', steam: '♨️' };

function stepTemplate(step) {
  return `
    <button type="button" class="gd-step is-locked" data-step="${step.id}" aria-label="${step.label}">
      <span class="gd-step-glow" aria-hidden="true"></span>
      <span class="gd-step-icon" data-role="icon-${step.id}">${step.icon}</span>
    </button>`;
}

const TEMPLATE = `
  <div class="gd-track" data-role="track">
    <div class="gd-line" aria-hidden="true"></div>
    <div class="gd-line-fill" data-role="line-fill" aria-hidden="true"></div>
    <div class="gd-steps" data-role="steps">
      ${STEPS.map(stepTemplate).join('')}
    </div>
  </div>
`;

export class GuideBar {
  constructor(root, callbacks = {}) {
    this.root = root;
    this.callbacks = callbacks || {};
    this.current = null;
    this.ready = Object.create(null);
    this.method = 'bake';

    this.el = document.createElement('div');
    this.el.className = 'gd-bar';
    this.el.innerHTML = TEMPLATE;
    (this.root || document.body).appendChild(this.el);

    this.lineFill = this.el.querySelector('[data-role="line-fill"]');
    this.stepEls = Object.create(null);
    STEPS.forEach((s) => {
      this.stepEls[s.id] = this.el.querySelector(`.gd-step[data-step="${s.id}"]`);
    });
    this.cookIconEl = this.el.querySelector('[data-role="icon-cook"]');

    this._wireEvents();
    this.setCurrent('knead');
  }

  _fire(name, ...args) {
    const fn = this.callbacks[name];
    if (typeof fn === 'function') {
      try { fn(...args); } catch (e) { /* ゲームを止めない */ }
    }
  }

  _wireEvents() {
    STEPS.forEach((s) => {
      const btn = this.stepEls[s.id];
      if (!btn) return;
      btn.addEventListener('click', () => {
        this._fire('onStepTap', s.id);
      });
    });
  }

  // 4歳児にわかる焼き方アイコンへの切り替え（🔥/🍳/♨️）
  setMethod(method) {
    this.method = (method === 'fry' || method === 'steam') ? method : 'bake';
    if (this.cookIconEl) this.cookIconEl.textContent = METHOD_ICON[this.method];
    const cookBtn = this.stepEls.cook;
    if (cookBtn) {
      if (this.method === 'bake') delete cookBtn.dataset.method;
      else cookBtn.dataset.method = this.method;
    }
  }

  // 現在段階を光らせる（他は自動的に「解禁済み/完了/未解禁」へ再計算される）
  setCurrent(stepId) {
    if (!STEPS.some((s) => s.id === stepId)) return;
    this.current = stepId;
    STEPS.forEach((s) => this._refreshStep(s.id));
    this._updateLineFill();
  }

  // 次段階の解禁状態。ready=true でアイコンが脈動+色づく
  setReady(stepId, ready) {
    this.ready[stepId] = !!ready;
    this._refreshStep(stepId);
  }

  _refreshStep(stepId) {
    const btn = this.stepEls[stepId];
    if (!btn) return;
    const idx = STEPS.findIndex((s) => s.id === stepId);
    const curIdx = STEPS.findIndex((s) => s.id === this.current);
    const isCurrent = stepId === this.current;
    const isDone = !isCurrent && curIdx >= 0 && idx < curIdx;
    const isReady = !isCurrent && !isDone && !!this.ready[stepId];
    const isLocked = !isCurrent && !isDone && !isReady;

    btn.classList.toggle('is-current', isCurrent);
    btn.classList.toggle('is-done', isDone);
    btn.classList.toggle('is-ready', isReady);
    btn.classList.toggle('is-locked', isLocked);
  }

  _updateLineFill() {
    if (!this.lineFill) return;
    const idx = STEPS.findIndex((s) => s.id === this.current);
    const frac = STEPS.length > 1 ? Math.max(0, idx) / (STEPS.length - 1) : 0;
    this.lineFill.style.transform = `translateY(-50%) scaleX(${frac})`;
  }

  // 未解禁アイコンをタップされた時の「ダメじゃなくて、まだだよ」ぷるぷる
  wiggle(stepId) {
    const btn = this.stepEls[stepId];
    if (!btn) return;
    btn.classList.remove('gd-wiggle');
    // 強制リフローで同じアニメーションを連続して再生できるようにする
    void btn.offsetWidth;
    btn.classList.add('gd-wiggle');
  }

  // そのステップアイコンの画面上の {x,y,w,h}（ゴーストハンドのタップ実演先）
  highlightRect(stepId) {
    const btn = this.stepEls[stepId];
    if (!btn) return { x: 0, y: 0, w: 0, h: 0 };
    const r = btn.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  destroy() {
    if (this.el && this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
    this.el = null;
    this.stepEls = Object.create(null);
    this.lineFill = null;
    this.cookIconEl = null;
  }
}

// ---------------------------------------------------------------------------
// Voice — Web Speech API (speechSynthesis) による短い声かけ。
// 非対応ブラウザ・発話失敗は完全に黙る（ゲームを止めない）。
// ---------------------------------------------------------------------------

const DEFAULT_RATE = 0.95;
const DEFAULT_PITCH = 1.15;
const REPEAT_GUARD_MS = 5000;

const hasSpeech = typeof window !== 'undefined'
  && typeof window.speechSynthesis !== 'undefined'
  && typeof window.SpeechSynthesisUtterance !== 'undefined';

let mutedFlag = false;
let selectedJaVoice = null;
const lastSaidAt = new Map(); // text -> timestamp(ms)

function pickJaVoice() {
  if (!hasSpeech) return null;
  try {
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    return (
      voices.find((v) => v.lang === 'ja-JP')
      || voices.find((v) => /^ja/i.test(v.lang))
      || null
    );
  } catch (e) {
    return null;
  }
}

if (hasSpeech) {
  try {
    selectedJaVoice = pickJaVoice();
    // getVoices() は非同期にロードされることが多いため voiceschanged で再取得する
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      selectedJaVoice = pickJaVoice() || selectedJaVoice;
    });
  } catch (e) {
    // 非対応環境でも黙って諦める
  }
}

export const Voice = {
  // Web Speech API で短い声かけを再生する。非対応・失敗は完全に黙る。
  say(text, opts = {}) {
    if (mutedFlag) return;
    if (!hasSpeech) return;
    if (!text) return;
    try {
      const t = Date.now();
      const last = lastSaidAt.get(text);
      if (last !== undefined && t - last < REPEAT_GUARD_MS) return; // 同一文の連続発話を無視
      lastSaidAt.set(text, t);

      window.speechSynthesis.cancel(); // 発話前に必ず前の発話を止める

      const utter = new window.SpeechSynthesisUtterance(text);
      utter.lang = 'ja-JP';
      utter.rate = typeof opts.rate === 'number' ? opts.rate : DEFAULT_RATE;
      utter.pitch = typeof opts.pitch === 'number' ? opts.pitch : DEFAULT_PITCH;
      if (typeof opts.volume === 'number') utter.volume = opts.volume;
      if (selectedJaVoice) utter.voice = selectedJaVoice;

      window.speechSynthesis.speak(utter);
    } catch (e) {
      // 発話に失敗してもゲームは止めない
    }
  },

  cancel() {
    if (!hasSpeech) return;
    try { window.speechSynthesis.cancel(); } catch (e) { /* 無視 */ }
  },

  setMuted(bool) {
    mutedFlag = !!bool;
    Voice.muted = mutedFlag;
    if (mutedFlag) Voice.cancel();
  },

  muted: false,
};
