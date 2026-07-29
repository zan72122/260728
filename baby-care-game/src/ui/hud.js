import { ICONS, CARE_ICONS } from './icons.js';
import { CARE_KINDS } from '../state/gameState.js';

/**
 * 画面の上にかぶせる操作パネル。文字はつかわず、絵アイコンだけ。
 */
export class Hud {
  constructor({ onCare, onBack, onMute }) {
    this.buttons = {};
    const holder = document.getElementById('care-buttons');

    for (const kind of CARE_KINDS) {
      const btn = document.createElement('button');
      btn.className = 'round-btn';
      btn.dataset.kind = kind;
      btn.setAttribute('aria-label', kind);
      btn.innerHTML = CARE_ICONS[kind];
      btn.addEventListener('click', () => onCare(kind));
      holder.appendChild(btn);
      this.buttons[kind] = btn;
    }

    this.backBtn = document.getElementById('back-btn');
    this.backBtn.innerHTML = ICONS.back;
    this.backBtn.addEventListener('click', onBack);

    this.muteBtn = document.getElementById('mute-btn');
    this.muteBtn.addEventListener('click', onMute);

    this.bubble = document.getElementById('bubble');
    this.hint = document.getElementById('hint');
    this.hint.innerHTML = ICONS.hand;
    this.reward = document.getElementById('reward');
    this.reward.innerHTML = ICONS.star;
    this.splash = document.getElementById('splash');

    this._bubbleKind = null;
  }

  setMuted(muted) {
    this.muteBtn.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn;
  }

  /** お世話ちゅうは、ほかのボタンを押せなくする。 */
  setBusy(busy) {
    for (const kind of CARE_KINDS) {
      this.buttons[kind].classList.toggle('busy', busy);
      this.buttons[kind].disabled = busy;
    }
    this.backBtn.classList.toggle('hidden', !busy);
  }

  setWanted(kind, wanted) {
    this.buttons[kind].classList.toggle('wanted', wanted);
  }

  /** 赤ちゃんのあたまの上に「〜してほしい」を出す。 */
  showBubble(kind, x, y) {
    if (this._bubbleKind !== kind) {
      this._bubbleKind = kind;
      this.bubble.innerHTML = CARE_ICONS[kind];
    }
    this.bubble.style.left = `${x}px`;
    this.bubble.style.top = `${y}px`;
    this.bubble.classList.remove('hidden');
  }

  hideBubble() {
    this._bubbleKind = null;
    this.bubble.classList.add('hidden');
  }

  /** 指の動かし方のお手本。motion は down / side / up。 */
  showHint(motion, x, y) {
    this.hint.classList.remove('down', 'side', 'up', 'hidden');
    this.hint.classList.add(motion);
    this.hint.style.left = `${x}px`;
    this.hint.style.top = `${y}px`;
  }

  moveHint(x, y) {
    this.hint.style.left = `${x}px`;
    this.hint.style.top = `${y}px`;
  }

  hideHint() {
    this.hint.classList.add('hidden');
  }

  /** ごほうびの ほし を どーんと出す。 */
  showReward() {
    this.reward.classList.remove('hidden');
    const svg = this.reward.firstElementChild;
    svg.style.animation = 'none';
    void svg.offsetWidth;   // アニメーションをやり直させる
    svg.style.animation = '';
    clearTimeout(this._rewardTimer);
    this._rewardTimer = setTimeout(() => this.reward.classList.add('hidden'), 1500);
  }

  hideSplash() {
    this.splash.classList.add('done');
    setTimeout(() => this.splash.remove(), 800);
  }
}
