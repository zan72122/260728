// 文字なし・大きなアイコンだけのツールバー

import { COLORS, TOOLS } from './config.js';

export class UI {
  // handlers: { onColor(idx), onTool(tool), onReset(), onMute(muted) }
  constructor(handlers) {
    this.handlers = handlers;
    this.selectedColor = 0;
    this.selectedTool = TOOLS.SEED;
    this.muted = false;
    this.colorButtons = [];
    this.toolButtons = new Map();
    this.build();
  }

  build() {
    const bar = document.getElementById('toolbar');

    // 色の種たち
    const colorGroup = document.createElement('div');
    colorGroup.className = 'tb-group';
    COLORS.forEach((c, idx) => {
      const btn = document.createElement('button');
      btn.className = 'color-btn';
      btn.style.setProperty('--c', c.hex);
      btn.setAttribute('aria-label', c.name);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.selectColor(idx);
      });
      colorGroup.appendChild(btn);
      this.colorButtons.push(btn);
    });
    bar.appendChild(colorGroup);

    bar.appendChild(this.divider());

    // 道具たち
    const toolGroup = document.createElement('div');
    toolGroup.className = 'tb-group';
    const toolDefs = [
      [TOOLS.SEED, '🌱', 'たねをおく・うごかす'],
      [TOOLS.WATER, '🚿', 'みずをかける'],
      [TOOLS.BUBBLE, '🫧', 'あわをふやす'],
    ];
    for (const [tool, icon, label] of toolDefs) {
      const btn = document.createElement('button');
      btn.className = 'tool-btn';
      btn.textContent = icon;
      btn.setAttribute('aria-label', label);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.selectTool(tool);
      });
      toolGroup.appendChild(btn);
      this.toolButtons.set(tool, btn);
    }
    bar.appendChild(toolGroup);

    bar.appendChild(this.divider());

    // ぜんぶ消す（おそうじ）
    const resetGroup = document.createElement('div');
    resetGroup.className = 'tb-group';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'tool-btn';
    resetBtn.textContent = '🧹';
    resetBtn.setAttribute('aria-label', 'ぜんぶきれいにする');
    resetBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      resetBtn.classList.remove('pushed');
      void resetBtn.offsetWidth; // アニメーションをやり直すためのリフロー
      resetBtn.classList.add('pushed');
      this.handlers.onReset();
    });
    resetGroup.appendChild(resetBtn);
    bar.appendChild(resetGroup);

    // 音の切り替え（画面右上）
    const muteBtn = document.createElement('button');
    muteBtn.id = 'mute-btn';
    muteBtn.textContent = '🔊';
    muteBtn.setAttribute('aria-label', 'おと');
    muteBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.muted = !this.muted;
      muteBtn.textContent = this.muted ? '🔇' : '🔊';
      this.handlers.onMute(this.muted);
    });
    document.body.appendChild(muteBtn);

    this.refresh();
  }

  divider() {
    const d = document.createElement('div');
    d.className = 'tb-divider';
    return d;
  }

  selectColor(idx) {
    this.selectedColor = idx;
    // 色を選んだら自動で「たね」道具に戻る（子どもが迷わないように）
    this.selectedTool = TOOLS.SEED;
    this.refresh();
    this.handlers.onColor(idx);
  }

  selectTool(tool) {
    this.selectedTool = tool;
    this.refresh();
    this.handlers.onTool(tool);
  }

  refresh() {
    this.colorButtons.forEach((btn, idx) => {
      btn.classList.toggle('selected', idx === this.selectedColor);
    });
    for (const [tool, btn] of this.toolButtons) {
      btn.classList.toggle('selected', tool === this.selectedTool);
    }
  }
}
