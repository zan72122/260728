import {
  quakeIcon,
  rewindIcon,
  againIcon,
  soundOnIcon,
  soundOffIcon,
  menuIcon,
  diceIcon,
  homeIcon,
  badgeSafe,
  badgeDanger,
  badgeShield,
  bearFace,
  handIcon,
} from './icons.js';

/**
 * DOMベースのUIレイヤー。3Dシーンの揺れの影響を一切受けない。
 * 常時表示は「メインボタン」「音」「メニュー」だけに絞る。
 */
export class Hud {
  constructor(root, { onMain, onMute, onDice, onHome }) {
    this.root = root;
    this.onMain = onMain;

    // メインボタン
    this.mainBtn = document.createElement('button');
    this.mainBtn.className = 'big-button';
    this.mainBtn.dataset.testid = 'main-button';
    this.mainBtn.setAttribute('aria-label', 'main');
    this.mainBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.mainBtn.addEventListener('click', () => onMain());
    root.appendChild(this.mainBtn);

    // 右上のアイコン列
    const corner = document.createElement('div');
    corner.className = 'corner-buttons';
    root.appendChild(corner);

    this.muteBtn = document.createElement('button');
    this.muteBtn.className = 'icon-button';
    this.muteBtn.dataset.testid = 'mute-button';
    this.muteBtn.innerHTML = soundOnIcon;
    this.muteBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.muteBtn.addEventListener('click', () => {
      this.mutedView = !this.mutedView;
      this.muteBtn.innerHTML = this.mutedView ? soundOffIcon : soundOnIcon;
      onMute(this.mutedView);
    });
    this.mutedView = false;
    corner.appendChild(this.muteBtn);

    this.menuBtn = document.createElement('button');
    this.menuBtn.className = 'icon-button';
    this.menuBtn.dataset.testid = 'menu-button';
    this.menuBtn.innerHTML = menuIcon;
    corner.appendChild(this.menuBtn);

    this.submenu = document.createElement('div');
    this.submenu.className = 'submenu';
    corner.appendChild(this.submenu);

    this.diceBtn = document.createElement('button');
    this.diceBtn.className = 'icon-button';
    this.diceBtn.dataset.testid = 'dice-button';
    this.diceBtn.innerHTML = diceIcon;
    this.submenu.appendChild(this.diceBtn);

    this.homeBtn = document.createElement('button');
    this.homeBtn.className = 'icon-button';
    this.homeBtn.dataset.testid = 'home-button';
    this.homeBtn.innerHTML = homeIcon;
    this.submenu.appendChild(this.homeBtn);

    this.menuBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.menuBtn.addEventListener('click', () => {
      this.submenu.classList.toggle('open');
    });
    this.diceBtn.addEventListener('click', () => {
      this.submenu.classList.remove('open');
      onDice();
    });
    this.homeBtn.addEventListener('click', () => {
      this.submenu.classList.remove('open');
      onHome();
    });

    // 結果バッジ（左上）
    this.badge = document.createElement('div');
    this.badge.className = 'result-badge';
    this.badge.dataset.testid = 'result-badge';
    root.appendChild(this.badge);

    // 比較パネル（上中央）
    this.compare = document.createElement('div');
    this.compare.className = 'compare-panel';
    this.compare.dataset.testid = 'compare-panel';
    root.appendChild(this.compare);

    // 手のヒント
    this.hint = document.createElement('div');
    this.hint.className = 'hand-hint';
    this.hint.innerHTML = handIcon;
    root.appendChild(this.hint);

    // 巻き戻しのベール
    this.veilEl = document.createElement('div');
    this.veilEl.className = 'rewind-veil';
    root.appendChild(this.veilEl);
  }

  /** モード: 'quake' | 'rewind' | 'again' | 'hidden' */
  setMainMode(mode) {
    this.mainBtn.classList.remove('hidden', 'mode-rewind', 'mode-again');
    this.mainBtn.dataset.mode = mode;
    if (mode === 'hidden') {
      this.mainBtn.classList.add('hidden');
      return;
    }
    if (mode === 'quake') this.mainBtn.innerHTML = quakeIcon;
    else if (mode === 'rewind') {
      this.mainBtn.innerHTML = rewindIcon;
      this.mainBtn.classList.add('mode-rewind');
    } else if (mode === 'again') {
      this.mainBtn.innerHTML = againIcon;
      this.mainBtn.classList.add('mode-again');
    }
  }

  badgeIcon(kind) {
    if (kind === 'safe') return badgeSafe;
    if (kind === 'shield') return badgeShield;
    return badgeDanger;
  }

  /** kind: 'safe' | 'shield' | 'danger' */
  showBadge(kind) {
    this.badge.innerHTML = this.badgeIcon(kind);
    this.badge.dataset.kind = kind;
    this.badge.classList.add('show');
  }

  hideBadge() {
    this.badge.classList.remove('show');
    this.badge.dataset.kind = '';
  }

  /** A・Bの結果を並べて見せる */
  showCompare(kindA, kindB) {
    this.compare.innerHTML = `
      <div class="compare-slot slot-a" data-testid="compare-a" data-kind="${kindA}">
        <div style="position:absolute;top:-9px;left:-9px;width:38%;height:38%">${bearFace(true)}</div>
        ${this.badgeIcon(kindA)}
      </div>
      <div class="compare-slot slot-b" data-testid="compare-b" data-kind="${kindB}">
        <div style="position:absolute;top:-9px;left:-9px;width:38%;height:38%">${bearFace(false)}</div>
        ${this.badgeIcon(kindB)}
      </div>`;
    this.compare.classList.add('show');
  }

  hideCompare() {
    this.compare.classList.remove('show');
  }

  /** 画面座標(px)に手のヒントを出す */
  showHint(x, y) {
    this.hint.style.left = `${x}px`;
    this.hint.style.top = `${y}px`;
    this.hint.classList.add('show');
  }

  hideHint() {
    this.hint.classList.remove('show');
  }

  veil(show) {
    this.veilEl.classList.toggle('show', show);
  }
}
