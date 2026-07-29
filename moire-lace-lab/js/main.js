/*
 * main.js
 * 各モジュールを組み立てて、描画ループを回す。
 */
(function () {
  'use strict';
  const ML = window.MoireLab;

  const DPR_CAP = 2;             // 高解像度端末での描画負荷の上限
  const MIST_DECAY_RATE = 0.07;  // 霧吹きの霧が晴れていく速さ (1/s)
  const BOTTOM_DRIFT = 0.009;    // 下のシートが勝手にゆっくり回る速さ (rad/s)
  const BOTTOM_BREATH = 0.012;   // 下のシートの「呼吸」(拡大縮小のゆらぎ)

  const glCanvas = document.getElementById('gl');
  const fxCanvas = document.getElementById('fx');
  const splash = document.getElementById('splash');

  const state = ML.createState();

  let renderer;
  try {
    renderer = ML.createRenderer(glCanvas);
  } catch (err) {
    document.getElementById('nogl').classList.remove('hidden');
    splash.classList.add('hidden');
    console.error(err);
    return;
  }

  const particles = ML.createParticles(fxCanvas, state);
  const ui = ML.setupUI(state, particles);
  ML.setupInput(glCanvas, state, particles);

  function resize() {
    const dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
    renderer.resize(Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr));
    particles.resize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);
  resize();

  // 最初のカーテンは、どこかに触れたら開く
  function dismissSplash() {
    splash.classList.add('hidden');
    ML.audio.resume();
    ML.audio.twinkle();
  }
  splash.addEventListener('pointerdown', dismissSplash, { once: true });

  let prevTime = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - prevTime) / 1000);
    prevTime = now;
    const t = now / 1000;
    state.time = t;

    // 下のシートは、さわらなくてもゆっくり流れて模様が生きて見える
    state.bottom.rot += BOTTOM_DRIFT * dt;
    state.bottom.scale = 1.0 + BOTTOM_BREATH * Math.sin(t * 0.23);

    // 回転ボタンを押している間は、画面の中心を軸にくるくる回す
    if (ui.held.rotate !== 0) {
      ML.pivotTransform(state.top, 0, 0, ui.held.rotate * dt, 1);
    }

    // 光のスイッチが入っていて誰も触っていないときは、光がゆっくり散歩する
    if (state.light.on && !state.pointer.active) {
      state.light.x += (0.30 * Math.sin(t * 0.21) - state.light.x) * dt * 0.5;
      state.light.y += (0.22 * Math.cos(t * 0.17) - state.light.y) * dt * 0.5;
    }

    // 霧はだんだん晴れる
    state.mist *= Math.exp(-MIST_DECAY_RATE * dt);
    if (state.mist < 0.003) state.mist = 0;

    particles.update(dt);
    renderer.render(state, t);
    particles.draw();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
