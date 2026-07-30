/* ui.js — DOMベースのHUDと各画面の表示制御 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const ui = {
    els: {},
    msgTimer: null,
  };

  ui.init = function () {
    ['hud', 'dust-fill', 'msg-banner', 'tutor-hand', 'scr-title', 'scr-select',
     'scr-result', 'scr-fail', 'level-grid', 'result-title', 'result-stars',
     'result-comment', 'btn-mute', 'btn-next'].forEach((id) => {
      ui.els[id] = $(id);
    });
  };

  ui.show = function (id) { ui.els[id].classList.remove('hidden'); };
  ui.hide = function (id) { ui.els[id].classList.add('hidden'); };

  ui.showOnly = function (screenId) {
    ['scr-title', 'scr-select', 'scr-result', 'scr-fail'].forEach((id) => {
      ui.els[id].classList.toggle('hidden', id !== screenId);
    });
  };

  ui.setDust = function (value, greenMax) {
    const pct = Math.min(100, value);
    const fill = ui.els['dust-fill'];
    fill.style.width = pct + '%';
    fill.style.backgroundColor =
      value < greenMax ? '#7ed957' : value < greenMax + 25 ? '#ffd23e' : '#ff5a5a';
  };

  ui.message = function (text, ms) {
    const el = ui.els['msg-banner'];
    el.textContent = text;
    el.classList.remove('hidden');
    if (ui.msgTimer) clearTimeout(ui.msgTimer);
    ui.msgTimer = null;
    if (ms) ui.msgTimer = setTimeout(() => el.classList.add('hidden'), ms);
  };

  ui.hideMessage = function () {
    if (ui.msgTimer) clearTimeout(ui.msgTimer);
    ui.msgTimer = null;
    ui.els['msg-banner'].classList.add('hidden');
  };

  /* チュートリアルの手アイコンを画面座標に置く */
  ui.handAt = function (sx, sy) {
    const el = ui.els['tutor-hand'];
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    el.classList.remove('hidden');
  };
  ui.hideHand = function () { ui.els['tutor-hand'].classList.add('hidden'); };

  ui.buildLevelGrid = function (levels, stars, onPick) {
    const grid = ui.els['level-grid'];
    grid.innerHTML = '';
    levels.forEach((lv) => {
      const btn = document.createElement('button');
      btn.className = 'level-btn';
      const got = stars[lv.id] || 0;
      btn.innerHTML =
        '<span class="lv-emoji">' + lv.emoji + '</span>' +
        '<span class="lv-name">' + lv.name + '</span>' +
        '<span class="lv-stars">' +
        '★'.repeat(got) + '<span style="color:#d9d4c5">' + '★'.repeat(3 - got) + '</span>' +
        '</span>';
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); onPick(lv); });
      grid.appendChild(btn);
    });
  };

  ui.showResult = function (stars, comment, hasNext) {
    ui.els['result-title'].textContent = stars >= 3 ? 'すごーい！' : 'やったね！';
    ui.els['result-comment'].textContent = comment;
    ui.els['btn-next'].style.display = hasNext ? '' : 'none';
    const spans = ui.els['result-stars'].querySelectorAll('span');
    spans.forEach((sp, i) => {
      sp.classList.remove('earned');
      sp.textContent = '★';
      if (i < stars) {
        setTimeout(() => {
          sp.classList.add('earned');
          window.GameAudio.play('star');
        }, 350 + i * 420);
      }
    });
    ui.showOnly('scr-result');
  };

  ui.setMuteIcon = function (muted) {
    ui.els['btn-mute'].textContent = muted ? '🔇' : '🔊';
  };

  window.GameUI = ui;
})();
