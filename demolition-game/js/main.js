/* main.js — 起動・シーン管理・入力の配線 */
(function () {
  'use strict';

  const ui = window.GameUI;
  const game = window.GameCore;
  const audio = window.GameAudio;
  const { LEVELS } = window.GameLevels;

  const canvas = document.getElementById('game-canvas');
  window.GameRender.init(canvas);

  let scene = 'title'; /* title | select | play | build */
  let currentLevel = null;
  let backdrop = null; /* タイトル/選択画面の背景用3Dシーン */

  function showBackdrop() {
    if (!backdrop) backdrop = window.GamePhysics.buildLevel(LEVELS[0]);
    window.GameRender.buildScene(backdrop);
  }

  /* ---------- 星の保存 ---------- */
  let stars = {};
  try { stars = JSON.parse(localStorage.getItem('demol_stars') || '{}'); } catch (e) {}
  function saveStars() {
    try { localStorage.setItem('demol_stars', JSON.stringify(stars)); } catch (e) {}
  }

  /* ---------- キャンバス ---------- */
  function resize() { window.GameRender.resize(); }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  resize();

  /* ---------- シーン切り替え ---------- */
  function gotoTitle() {
    scene = 'title';
    game.stop();
    window.GameBuild.exit();
    showBackdrop();
    ui.hide('hud');
    ui.showOnly('scr-title');
  }

  function gotoSelect() {
    scene = 'select';
    game.stop();
    window.GameBuild.exit();
    showBackdrop();
    ui.hide('hud');
    ui.buildLevelGrid(LEVELS, stars, (lv) => {
      audio.play('tap');
      startLevel(lv);
    }, () => {
      audio.play('tap');
      gotoBuild();
    });
    ui.showOnly('scr-select');
  }

  function gotoBuild() {
    scene = 'build';
    game.stop();
    ui.showOnly(null);
    ui.show('hud');
    ui.setDust(0, 60);
    window.GameBuild.enter();
  }

  function startLevel(level) {
    scene = 'play';
    currentLevel = level;
    ui.showOnly(null); /* すべてのスクリーンを隠す */
    ui.show('hud');
    game.start(level);
  }

  window.GameBuild.onStartDemolition = (level) => startLevel(level);

  game.events.onCleared = (earned, comment) => {
    if (currentLevel.sandbox) {
      setTimeout(() => ui.showSandboxResult(comment), 700);
      return;
    }
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
  onTap('btn-retry', () => {
    audio.play('tap');
    if (currentLevel && currentLevel.sandbox) gotoBuild(); /* もういちど たてる */
    else startLevel(currentLevel);
  });
  onTap('btn-fail-retry', () => { audio.play('tap'); startLevel(currentLevel); });
  onTap('btn-next', () => {
    audio.play('tap');
    if (currentLevel && currentLevel.sandbox) { /* さいしょから */
      window.GameBuild.layout.clear();
      gotoBuild();
      return;
    }
    const next = LEVELS.find((lv) => lv.id === currentLevel.id + 1);
    if (next) startLevel(next); else gotoSelect();
  });
  onTap('btn-go', () => game.startBoom());
  onTap('btn-build-done', () => { audio.play('tap'); window.GameBuild.startDemolition(); });
  onTap('btn-build-clear', () => window.GameBuild.clearAll());
  onTap('btn-mute', () => {
    audio.setMuted(!audio.muted);
    ui.setMuteIcon(audio.muted);
  });

  /* ---------- キャンバスへのタップ ---------- */
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audio.unlock();
    if (scene === 'play') game.tap(e.clientX, e.clientY);
    else if (scene === 'build') window.GameBuild.strokeStart(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (scene === 'build') window.GameBuild.strokeMove(e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', () => {
    if (scene === 'build') window.GameBuild.strokeEnd();
  });
  window.addEventListener('pointercancel', () => {
    if (scene === 'build') window.GameBuild.strokeEnd();
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

    if (scene === 'play') {
      game.update(dt, time);
      game.draw(time);
    } else if (scene === 'build' && window.GameBuild.pstate) {
      window.GameRender.render(window.GameBuild.pstate, time, { showSockets: false, pulseBombs: false });
    } else if (backdrop) {
      window.GameRender.render(backdrop, time, { showSockets: false, pulseBombs: false });
    }
    requestAnimationFrame(frame);
  }

  /* ---------- 起動 ---------- */
  ui.init();
  ui.setMuteIcon(audio.muted);
  showBackdrop();
  gotoTitle();
  requestAnimationFrame(frame);
})();
