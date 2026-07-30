/* main.js — 起動・シーン管理・入力の配線 */
(function () {
  'use strict';

  const ui = window.GameUI;
  const game = window.GameCore;
  const audio = window.GameAudio;
  const { LEVELS } = window.GameLevels;

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  let scene = 'title'; /* title | select | play */
  let currentLevel = null;
  let dpr = 1;

  /* ---------- 星の保存 ---------- */
  let stars = {};
  try { stars = JSON.parse(localStorage.getItem('demol_stars') || '{}'); } catch (e) {}
  function saveStars() {
    try { localStorage.setItem('demol_stars', JSON.stringify(stars)); } catch (e) {}
  }

  /* ---------- キャンバス ---------- */
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  resize();

  /* ---------- シーン切り替え ---------- */
  function gotoTitle() {
    scene = 'title';
    game.stop();
    ui.hide('hud');
    ui.showOnly('scr-title');
  }

  function gotoSelect() {
    scene = 'select';
    game.stop();
    ui.hide('hud');
    ui.buildLevelGrid(LEVELS, stars, (lv) => {
      audio.play('tap');
      startLevel(lv);
    });
    ui.showOnly('scr-select');
  }

  function startLevel(level) {
    scene = 'play';
    currentLevel = level;
    ui.showOnly(null); /* すべてのスクリーンを隠す */
    ui.show('hud');
    game.start(level);
  }

  game.events.onCleared = (earned, comment) => {
    const prev = stars[currentLevel.id] || 0;
    if (earned > prev) { stars[currentLevel.id] = earned; saveStars(); }
    const hasNext = LEVELS.some((lv) => lv.id === currentLevel.id + 1);
    setTimeout(() => ui.showResult(earned, comment, hasNext), 700);
  };

  game.events.onFail = (kind) => {
    document.getElementById('fail-title').textContent = kind === 'tall' ? 'おしい！' : 'あちゃー！';
    document.getElementById('fail-comment').textContent =
      kind === 'tall' ? 'まだ たかいね！' : 'おとなりに あたっちゃった！';
    ui.showOnly('scr-fail');
  };

  /* ---------- ボタン ---------- */
  function onTap(id, fn) {
    document.getElementById(id).addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      audio.unlock();
      fn();
    });
  }

  onTap('btn-play', () => {
    audio.play('tap');
    audio.startBgm();
    gotoSelect();
  });
  onTap('btn-back-title', () => { audio.play('tap'); gotoTitle(); });
  onTap('btn-home', () => { audio.play('tap'); gotoSelect(); });
  onTap('btn-retry', () => { audio.play('tap'); startLevel(currentLevel); });
  onTap('btn-fail-retry', () => { audio.play('tap'); startLevel(currentLevel); });
  onTap('btn-next', () => {
    audio.play('tap');
    const next = LEVELS.find((lv) => lv.id === currentLevel.id + 1);
    if (next) startLevel(next); else gotoSelect();
  });
  onTap('btn-mute', () => {
    audio.setMuted(!audio.muted);
    ui.setMuteIcon(audio.muted);
  });

  /* ---------- キャンバスへのタップ ---------- */
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audio.unlock();
    if (scene === 'play') game.tap(e.clientX, e.clientY);
  });

  /* スクロール・ダブルタップズームの抑止 */
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault());

  /* ---------- メインループ ---------- */
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    const time = now / 1000;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = window.innerWidth, ch = window.innerHeight;

    if (scene === 'play') {
      game.update(dt, time);
      game.draw(ctx, cw, ch, time);
    } else {
      game.drawSky(ctx, cw, ch, time);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- 起動 ---------- */
  ui.init();
  ui.setMuteIcon(audio.muted);
  gotoTitle();
  requestAnimationFrame(frame);
})();
