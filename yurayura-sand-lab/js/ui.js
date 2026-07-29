// DOM まわりの UI。パレット・アクションボタン・バッジ表示・ポップアップ。
// ゲームロジックからは callbacks 経由でしか触られない。
import { SAND_TYPES, BADGES } from './config.js';

const STORAGE_KEY = 'yurayura-sand-lab-badges';

export class UI {
  /**
   * @param {object} callbacks
   *   onSelectType(type), onRefill(), onMist(), onPaper(), onMute(muted)
   */
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.awarded = this.loadBadges();
    this.buildPalette();
    this.buildBadgeBar();
    this.wireActions();
    this.hint = document.getElementById('hint');
    this.popup = document.getElementById('popup');
    this.popupTimer = null;
  }

  loadBadges() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  }

  saveBadges() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.awarded]));
    } catch {
      /* プライベートモードなどで保存できなくても遊べる */
    }
  }

  buildPalette() {
    const palette = document.getElementById('palette');
    for (const type of SAND_TYPES) {
      const btn = document.createElement('button');
      btn.className = 'swatch';
      btn.dataset.typeId = type.id;
      btn.style.setProperty('--swatch-color', type.color ?? '#ff9ecb');
      if (type.kind === 'rainbow') btn.classList.add('swatch-rainbow');
      btn.innerHTML = `<span class="swatch-emoji">${type.emoji}</span><span class="swatch-label">${type.label}</span>`;
      btn.addEventListener('click', () => {
        this.selectType(type.id);
        this.callbacks.onSelectType(type);
      });
      palette.appendChild(btn);
    }
    this.selectType(SAND_TYPES[0].id);
  }

  selectType(typeId) {
    document.querySelectorAll('.swatch').forEach((el) => {
      el.classList.toggle('selected', el.dataset.typeId === typeId);
    });
  }

  buildBadgeBar() {
    const bar = document.getElementById('badgeBar');
    bar.innerHTML = '';
    for (const badge of BADGES) {
      const el = document.createElement('span');
      el.className = 'badge';
      el.dataset.badgeId = badge.id;
      el.textContent = this.awarded.has(badge.id) ? badge.emoji : '☆';
      el.title = badge.label;
      el.classList.toggle('earned', this.awarded.has(badge.id));
      bar.appendChild(el);
    }
  }

  wireActions() {
    document.getElementById('refillBtn').addEventListener('click', () => this.callbacks.onRefill());
    document.getElementById('mistBtn').addEventListener('click', () => this.callbacks.onMist());
    document.getElementById('paperBtn').addEventListener('click', () => this.callbacks.onPaper());
    const muteBtn = document.getElementById('muteBtn');
    muteBtn.addEventListener('click', () => {
      const muted = muteBtn.textContent !== '🔇';
      muteBtn.textContent = muted ? '🔇' : '🔊';
      this.callbacks.onMute(muted);
    });
  }

  hideHint() {
    this.hint.classList.add('hidden');
  }

  /** すなが空のとき、おかわりボタンをぷるぷるさせる */
  setRefillPulse(active) {
    document.getElementById('refillBtn').classList.toggle('pulse', active);
  }

  setMistBusy(busy) {
    document.getElementById('mistBtn').disabled = busy;
  }

  /** バッジ授与。すでに持っていたら false を返す。 */
  award(badgeId) {
    if (this.awarded.has(badgeId)) return false;
    const badge = BADGES.find((b) => b.id === badgeId);
    if (!badge) return false;
    this.awarded.add(badgeId);
    this.saveBadges();
    this.buildBadgeBar();
    this.showPopup(`${badge.emoji} できたね!<br /><strong>${badge.label}</strong>`);
    return true;
  }

  showPopup(html) {
    this.popup.innerHTML = html;
    this.popup.classList.remove('hidden');
    this.popup.classList.remove('pop-in');
    void this.popup.offsetWidth; // アニメーションをリスタートさせる
    this.popup.classList.add('pop-in');
    clearTimeout(this.popupTimer);
    this.popupTimer = setTimeout(() => this.popup.classList.add('hidden'), 2600);
  }
}
