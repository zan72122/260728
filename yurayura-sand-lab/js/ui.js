// DOM まわりの UI。パネル開閉・FAB 配置・スワイプ色切替・バッジ。
import { SAND_TYPES, BADGES } from './config.js';
import { getLayout } from './layout.js';

const STORAGE_KEY = 'yurayura-sand-lab-badges';
const HINT_KEY = 'yurayura-sand-lab-hint';

export class UI {
  /**
   * @param {object} callbacks
   *   onSelectType(type), onRefill(), onMist(), onPaper(), onMute(muted)
   */
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.awarded = this.loadBadges();
    this.colorIndex = 0;
    this.toggleCount = 0;
    this.panelOpen = false;

    this.panel = document.getElementById('panel');
    this.fab = document.getElementById('fabBtn');
    this.hint = document.getElementById('hint');
    this.popup = document.getElementById('popup');
    this.colorToast = document.getElementById('colorToast');
    this.popupTimer = null;
    this.toastTimer = null;

    this.buildPalette();
    this.buildBadgeBar();
    this.wireActions();
    this.wireFab();
    this.initHint();
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
    } catch { /* 保存できなくても遊べる */ }
  }

  initHint() {
    try {
      if (!localStorage.getItem(HINT_KEY)) this.hint.classList.remove('hidden');
    } catch {
      this.hint.classList.remove('hidden');
    }
  }

  buildPalette() {
    const palette = document.getElementById('palette');
    for (const type of SAND_TYPES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch';
      btn.dataset.typeId = type.id;
      btn.style.setProperty('--swatch-color', type.color ?? '#ff9ecb');
      if (type.kind === 'rainbow') btn.classList.add('swatch-rainbow');
      btn.innerHTML = `<span class="swatch-emoji">${type.emoji}</span><span class="swatch-label">${type.label}</span>`;
      btn.addEventListener('click', () => {
        this.setColorById(type.id, true);
      });
      palette.appendChild(btn);
    }
    this.setColorById(SAND_TYPES[0].id, false);
  }

  setColorById(typeId, notify) {
    const idx = SAND_TYPES.findIndex((t) => t.id === typeId);
    if (idx < 0) return;
    this.colorIndex = idx;
    this.selectType(typeId);
    if (notify) this.callbacks.onSelectType(SAND_TYPES[idx]);
  }

  selectType(typeId) {
    document.querySelectorAll('.swatch').forEach((el) => {
      el.classList.toggle('selected', el.dataset.typeId === typeId);
    });
  }

  /** パネル非表示時の左右スワイプで色を切り替える */
  cycleColor(direction) {
    const n = SAND_TYPES.length;
    this.colorIndex = (this.colorIndex + direction + n) % n;
    const type = SAND_TYPES[this.colorIndex];
    this.selectType(type.id);
    this.callbacks.onSelectType(type);
    this.showColorToast(type.emoji);
  }

  showColorToast(emoji) {
    this.colorToast.textContent = emoji;
    this.colorToast.classList.remove('hidden');
    this.colorToast.style.animation = 'none';
    void this.colorToast.offsetWidth;
    this.colorToast.style.animation = '';
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.colorToast.classList.add('hidden'), 800);
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

  wireFab() {
    this.fab.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleCount += 1;
      if (this.toggleCount % 2 === 1) this.openPanel();
      else this.closePanel();
    });
  }

  openPanel() {
    this.panelOpen = true;
    this.panel.classList.add('open');
    this.panel.setAttribute('aria-hidden', 'false');
    this.fab.classList.add('open');
    this.fab.setAttribute('aria-expanded', 'true');
    this.fab.setAttribute('aria-label', 'メニューを とじる');
  }

  closePanel() {
    this.panelOpen = false;
    this.panel.classList.remove('open');
    this.panel.setAttribute('aria-hidden', 'true');
    this.fab.classList.remove('open');
    this.fab.setAttribute('aria-expanded', 'false');
    this.fab.setAttribute('aria-label', 'メニューを ひらく');
  }

  isPanelOpen() {
    return this.panelOpen;
  }

  /** かみ領域の右下に FAB を重ねる(画面下端は使わない) */
  positionFab() {
    const { paper, stage } = getLayout();
    const wrap = document.getElementById('stageWrap');
    const rect = wrap.getBoundingClientRect();
    const inset = 12;
    const fabSize = this.fab.offsetWidth || 52;
    this.fab.style.left = `${(paper.x + paper.w - inset - fabSize) / stage.w * rect.width}px`;
    this.fab.style.top = `${(paper.y + paper.h - inset - fabSize) / stage.h * rect.height}px`;
  }

  hideHint() {
    this.hint.classList.add('hidden');
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch { /* ignore */ }
  }

  setRefillPulse(active) {
    document.getElementById('refillBtn').classList.toggle('pulse', active);
  }

  setMistBusy(busy) {
    document.getElementById('mistBtn').disabled = busy;
  }

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
    void this.popup.offsetWidth;
    this.popup.classList.add('pop-in');
    clearTimeout(this.popupTimer);
    this.popupTimer = setTimeout(() => this.popup.classList.add('hidden'), 2600);
  }
}
