/* ============================================================
 * ui.js — 最小限のUI（パレット / 星 / つぎへ / ヒント）
 * ============================================================ */
(function () {
  const UI = {
    tools: [
      { id: 'syrup', icon: '🍯' },
      { id: 'choco', icon: '🍫' },
      { id: 'butter', icon: '🧈' },
      { id: 'cream', icon: '🍦' },
      { id: 'berry', icon: '🍓' },
      { id: 'poke', icon: '👆' },
    ],
    open: false,
    els: {},
    idleT: 0,
  };
  PT.UI = UI;

  UI.init = function () {
    UI.els.palette = document.getElementById('palette');
    UI.els.btn = document.getElementById('palette-btn');
    UI.els.fan = document.getElementById('palette-fan');
    UI.els.starPill = document.getElementById('star-pill');
    UI.els.starCount = document.getElementById('star-count');
    UI.els.next = document.getElementById('next-btn');
    UI.els.hint = document.getElementById('hint-hand');
    UI.els.mute = document.getElementById('mute-btn');
    UI.els.rebake = document.getElementById('rebake-btn');
    UI.els.toast = document.getElementById('unlock-toast');

    // 扇形パレット
    UI.tools.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'fan-item';
      b.textContent = t.icon;
      b.dataset.id = t.id;
      UI.els.fan.appendChild(b);
      t.el = b;
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        UI.select(t.id);
        PT.Audio.note(500 + i * 60, { type: 'triangle', gain: 0.15, dur: 0.25 });
        setTimeout(() => UI.setOpen(false), 130);
      });
    });

    UI.els.btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      UI.setOpen(!UI.open);
      PT.Audio.plop(1.8, 0.18);
    });

    UI.els.mute.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const m = !PT.Audio.muted;
      PT.Audio.setMuted(m);
      UI.els.mute.textContent = m ? '🔕' : '🔔';
    });

    UI.select('syrup');
  };

  UI.setOpen = function (o) {
    UI.open = o;
    UI.els.palette.classList.toggle('open', o);
    const n = UI.tools.length;
    UI.tools.forEach((t, i) => {
      if (o) {
        // 上向きの扇形に展開
        const a = Math.PI * (0.12 + 0.76 * (i / (n - 1)));
        const r = 108;
        t.el.style.transform =
          `translate(${-Math.cos(a) * r}px, ${-Math.sin(a) * r}px) scale(1)`;
        t.el.style.transitionDelay = (i * 28) + 'ms';
      } else {
        t.el.style.transform = 'translate(0px, 20px) scale(0)';
        t.el.style.transitionDelay = '0ms';
      }
    });
  };

  UI.select = function (id) {
    UI.currentId = id;
    PT.Toppings.current = id;
    const t = UI.tools.find((x) => x.id === id);
    UI.els.btn.textContent = t.icon;
    UI.tools.forEach((x) => x.el.classList.toggle('selected', x.id === id));
  };

  // ---- 星カウンター ----
  UI.setStars = function (n) {
    UI.els.starCount.textContent = n;
    UI.els.starPill.classList.add('flash');
    clearTimeout(UI._flashT);
    UI._flashT = setTimeout(() => UI.els.starPill.classList.remove('flash'), 900);
  };

  // ---- つぎへボタン ----
  UI.showNext = function (show) {
    UI.els.next.classList.toggle('hidden', !show);
  };

  // ---- ヒントの手 ----
  UI.showHint = function (screenX, screenY) {
    UI.els.hint.classList.remove('hidden');
    UI.els.hint.style.left = screenX + 'px';
    UI.els.hint.style.top = screenY + 'px';
  };
  UI.hideHint = function () {
    UI.els.hint.classList.add('hidden');
  };

  // ---- アンロック演出 ----
  UI.unlockToast = function (icon) {
    const t = UI.els.toast;
    t.textContent = icon;
    t.classList.remove('hidden');
    // アニメ再生し直し
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    clearTimeout(UI._toastT);
    UI._toastT = setTimeout(() => t.classList.add('hidden'), 2400);
  };
})();
