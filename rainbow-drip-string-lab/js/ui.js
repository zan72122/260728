// DOM で作る大きなボタン UI。文字に頼らず、色とアイコンで伝える。
// すべてのボタンは 60px 以上のタッチターゲットを持つ。

import { PALETTE, rybToRgb, rgbCss } from './color.js';
import { sounds } from './audio.js';

export function buildUI(world, root) {
  root.innerHTML = '';

  // --- 上部: 色えらび ---
  const colorBar = el('div', 'color-bar');
  const colorBtns = new Map();
  for (const entry of PALETTE) {
    const btn = el('button', 'color-btn');
    btn.setAttribute('aria-label', entry.label);
    if (entry.id === 'rainbow') {
      btn.classList.add('rainbow');
    } else {
      btn.style.background = `radial-gradient(circle at 32% 28%, #ffffff 6%, ${rgbCss(rybToRgb(entry.ryb))} 55%)`;
    }
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sounds.unlock();
      world.setColor(entry.id);
      sounds.pop();
      refresh();
    });
    colorBar.appendChild(btn);
    colorBtns.set(entry.id, btn);
  }
  root.appendChild(colorBar);

  // --- 下部: ツールトレイ ---
  const tray = el('div', 'tool-tray');
  const toolBtns = new Map();
  const tools = [
    { id: 'pin', icon: '📍', label: 'ピン' },
    { id: 'string', icon: '🧶', label: 'ひも' },
    { id: 'eraser', icon: '🧽', label: 'けしごむ' },
  ];
  for (const t of tools) {
    const btn = toolButton(t.icon, t.label, () => {
      world.setTool(t.id);
      sounds.pop();
      refresh();
    });
    tray.appendChild(btn);
    toolBtns.set(t.id, btn);
  }
  tray.appendChild(divider());
  tray.appendChild(toolButton('↩️', 'もどす', () => {
    world.undo();
    sounds.poof();
  }));
  root.appendChild(tray);

  // --- 右下: おそうじボタン ---
  const cleanTray = el('div', 'clean-tray');
  cleanTray.appendChild(toolButton('🫧', 'おそうじ', () => {
    world.clearLiquid();
    sounds.bubble();
  }));
  const resetBtn = toolButton('🔄', 'ぜんぶリセット', () => {
    world.resetAll();
    sounds.poof();
  });
  resetBtn.classList.add('small');
  cleanTray.appendChild(resetBtn);
  root.appendChild(cleanTray);

  function refresh() {
    for (const [id, btn] of colorBtns) {
      btn.classList.toggle('active', world.currentColor.id === id);
    }
    for (const [id, btn] of toolBtns) {
      btn.classList.toggle('active', world.tool === id);
    }
  }
  refresh();
  return { refresh };
}

function el(tag, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function toolButton(icon, label, onPress) {
  const btn = el('button', 'tool-btn');
  btn.textContent = icon;
  btn.setAttribute('aria-label', label);
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sounds.unlock();
    onPress();
    btn.classList.remove('pressed');
    // 連打でもアニメが毎回動くよう reflow を挟む
    void btn.offsetWidth;
    btn.classList.add('pressed');
  });
  return btn;
}

function divider() {
  return el('div', 'tray-divider');
}
