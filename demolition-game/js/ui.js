/* ui.js — DOMベースのHUDと各画面の表示制御 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const ui = {
    els: {},
    msgTimer: null,
  };

  ui.init = function () {
    ['hud', 'hud-top', 'dust-fill', 'msg-banner', 'tutor-hand', 'scr-title', 'scr-select',
     'scr-result', 'scr-fail', 'level-grid', 'result-title', 'result-stars',
     'result-comment', 'btn-mute', 'btn-next', 'btn-go', 'btn-retry',
     'build-bar', 'palette-row', 'brush-row', 'shape-row', 'layer-row',
     'btn-build-done', 'dust-meter', 'btn-toolbox'].forEach((id) => {
      ui.els[id] = $(id);
    });

    /* ツールバー開閉ハンドル */
    ui.els['btn-toolbox'].addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ui.toggleBuildBar();
    });

    /* HUD上部バー: タップ後2秒だけくっきり表示（build/play中はうっすら表示） */
    let hudFadeTimer = null;
    ui.els['hud-top'].addEventListener('pointerdown', () => {
      const el = ui.els['hud-top'];
      el.classList.add('hud-active');
      if (hudFadeTimer) clearTimeout(hudFadeTimer);
      hudFadeTimer = setTimeout(() => el.classList.remove('hud-active'), 2000);
    }, true /* capture: 子ボタンのstopPropagationに影響されない */);

    /* ツールバーが開いているあいだは、中身（できた！ボタンなど。他機能が
       #decor-row 等を動的に追加して高さが変わることもある）に重ならないよう、
       ハンドルをバーのすぐ上まで押し上げる */
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => updateToolboxPos());
      ro.observe(ui.els['build-bar']);
    }
    window.addEventListener('resize', updateToolboxPos);
  };

  function updateToolboxPos() {
    const bar = ui.els['build-bar'];
    const handle = ui.els['btn-toolbox'];
    if (!bar || !handle) return;
    if (bar.classList.contains('hidden') || bar.classList.contains('bb-collapsed')) {
      handle.style.bottom = '';
      return;
    }
    const h = Math.ceil(bar.getBoundingClientRect().height);
    handle.style.bottom = 'calc(env(safe-area-inset-bottom, 0px) + ' + (h + 12) + 'px)';
  }

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
  ui.handAtGo = function () {
    const r = ui.els['btn-go'].getBoundingClientRect();
    if (r.width > 0) ui.handAt(r.left + r.width / 2 + 24, r.top + 6);
  };

  /* 「ばくは かいし！」ボタン */
  ui.showGo = function () { ui.els['btn-go'].classList.remove('hidden'); };
  ui.hideGo = function () { ui.els['btn-go'].classList.add('hidden'); };

  /* ---------- 建築モードのツールバー ---------- */
  const MAT_EMOJI = { stone: '🪨', wood: '🪵', rubber: '⚽', glass: '🧊' };
  const SHAPES = [['sq', '■'], ['tri', '▲'], ['cir', '●']];
  const LAYER_LABELS = [[0, 'おく'], [1, 'なか'], [2, 'まえ']];

  ui.showBuildBar = function (cfg) {
    /* いろ・そざい パレット（0..4=いろ、5..8=そざい） */
    const row = ui.els['palette-row'];
    row.innerHTML = '';
    cfg.brushes.forEach((p, i) => {
      const dot = document.createElement('button');
      dot.className = 'pal-dot' + (p.material ? ' mat-dot' : '');
      dot.dataset.pal = i;
      dot.style.background = p.wall;
      if (p.material) {
        dot.textContent = MAT_EMOJI[p.material] || '';
        dot.setAttribute('aria-label', p.material);
      } else {
        dot.setAttribute('aria-label', 'いろ' + (i + 1));
      }
      dot.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        cfg.onColor(i);
      });
      row.appendChild(dot);
    });
    /* けしゴム */
    const eraser = document.createElement('button');
    eraser.className = 'pal-dot tool-eraser';
    eraser.id = 'btn-eraser';
    eraser.textContent = '🧽';
    eraser.setAttribute('aria-label', 'けす');
    eraser.addEventListener('pointerdown', (e) => { e.preventDefault(); cfg.onEraser(); });
    row.appendChild(eraser);

    /* かたち（■▲●） */
    const srow = ui.els['shape-row'];
    srow.innerHTML = '';
    SHAPES.forEach(([s, label]) => {
      const btn = document.createElement('button');
      btn.className = 'brush-btn shape-btn';
      btn.dataset.shape = s;
      btn.textContent = label;
      btn.setAttribute('aria-label', 'かたち ' + label);
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); cfg.onShape(s); });
      srow.appendChild(btn);
    });

    /* レイヤー（おく/なか/まえ） */
    const lrow = ui.els['layer-row'];
    lrow.innerHTML = '';
    LAYER_LABELS.forEach(([l, label]) => {
      const btn = document.createElement('button');
      btn.className = 'brush-btn layer-btn';
      btn.dataset.layer = l;
      btn.textContent = label;
      btn.setAttribute('aria-label', label + ' レイヤー');
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); cfg.onLayer(l); });
      lrow.appendChild(btn);
    });

    /* ブラシサイズ＋もどす */
    const brow = ui.els['brush-row'];
    brow.innerHTML = '';
    [1, 2, 4, 8].forEach((n) => {
      const btn = document.createElement('button');
      btn.className = 'brush-btn';
      btn.dataset.n = n;
      btn.setAttribute('aria-label', n + 'x' + n);
      const sq = document.createElement('span');
      sq.className = 'sq sq-' + n;
      btn.appendChild(sq);
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); cfg.onBrush(n); });
      brow.appendChild(btn);
    });
    const undo = document.createElement('button');
    undo.className = 'brush-btn undo-btn';
    undo.id = 'btn-undo';
    undo.textContent = '↩';
    undo.setAttribute('aria-label', 'もどす');
    undo.addEventListener('pointerdown', (e) => { e.preventDefault(); cfg.onUndo(); });
    brow.appendChild(undo);

    ui.setBuildTool(cfg.mode, cfg.palIdx);
    ui.setBrushSel(cfg.brush);
    ui.setShapeSel(cfg.shape);
    ui.setLayerSel(cfg.layer);
    ui.els['build-bar'].classList.remove('hidden');
    /* 建築モード開始時は開いた状態から */
    ui.els['build-bar'].classList.remove('bb-collapsed');
    ui.els['btn-toolbox'].classList.remove('hidden');
    updateToolboxPos();
  };

  ui.setBuildTool = function (mode, palIdx) {
    const row = ui.els['palette-row'];
    row.querySelectorAll('.pal-dot').forEach((d) => {
      if (d.id === 'btn-eraser') d.classList.toggle('sel', mode === 'erase');
      else d.classList.toggle('sel', mode === 'draw' && Number(d.dataset.pal) === palIdx);
    });
  };

  ui.setBrushSel = function (n) {
    ui.els['brush-row'].querySelectorAll('.brush-btn').forEach((b) => {
      b.classList.toggle('sel', !b.id && Number(b.dataset.n) === n);
    });
  };

  ui.setShapeSel = function (s) {
    ui.els['shape-row'].querySelectorAll('.shape-btn').forEach((b) => {
      b.classList.toggle('sel', b.dataset.shape === s);
    });
  };

  ui.setLayerSel = function (l) {
    ui.els['layer-row'].querySelectorAll('.layer-btn').forEach((b) => {
      b.classList.toggle('sel', Number(b.dataset.layer) === l);
    });
  };

  ui.hideBuildBar = function () {
    ui.els['build-bar'].classList.add('hidden');
    ui.els['build-bar'].classList.remove('bb-collapsed');
    ui.els['btn-toolbox'].classList.add('hidden');
    updateToolboxPos();
  };
  ui.setBuildDoneEnabled = function (on) { ui.els['btn-build-done'].disabled = !on; };

  /* ツールバーの開閉トグル（ハンドルからのみ呼ばれる想定）。
     open===true→開く / false→閉じる / 省略→現在の状態を反転。
     buildシーン外（build-barがhidden）のときは何もしない。 */
  ui.toggleBuildBar = function (open) {
    const bar = ui.els['build-bar'];
    if (bar.classList.contains('hidden')) return;
    const isOpen = !bar.classList.contains('bb-collapsed');
    const shouldOpen = (open === undefined) ? !isOpen : open;
    bar.classList.toggle('bb-collapsed', !shouldOpen);
    updateToolboxPos();
  };

  ui.buildLevelGrid = function (levels, stars, onPick, onBuild) {
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
    /* じぶんでつくる（建築モード） */
    if (onBuild) {
      const btn = document.createElement('button');
      btn.className = 'level-btn';
      btn.id = 'btn-build-mode';
      btn.innerHTML =
        '<span class="lv-emoji">🛠️</span>' +
        '<span class="lv-name">じぶんで つくる</span>' +
        '<span class="lv-stars">🧱💥</span>';
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); onBuild(); });
      grid.appendChild(btn);
    }
  };

  function setResultButtons(retryLabel, nextLabel) {
    ui.els['btn-retry'].textContent = retryLabel;
    ui.els['btn-next'].textContent = nextLabel;
  }

  ui.showResult = function (stars, comment, hasNext) {
    setResultButtons('🔁 もういちど', '▶ つぎへ');
    ui.els['result-stars'].style.display = '';
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

  /* 建築モードのごほうびエンド（星なし） */
  ui.showSandboxResult = function (comment) {
    setResultButtons('🔨 もういちど たてる', '🆕 さいしょから');
    ui.els['result-stars'].style.display = 'none';
    ui.els['result-title'].textContent = 'ドッカーン！';
    ui.els['result-comment'].textContent = comment;
    ui.els['btn-next'].style.display = '';
    ui.showOnly('scr-result');
  };

  ui.setMuteIcon = function (muted) {
    ui.els['btn-mute'].textContent = muted ? '🔇' : '🔊';
  };

  window.GameUI = ui;
})();
