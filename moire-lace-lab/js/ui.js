/*
 * ui.js
 * 文字なしで遊べる、大きな丸いアイコンボタン。
 * シートの模様アイコンは現在の模様のミニプレビューになっていて、
 * 押すたびに次の模様へ切り替わる。
 */
(function () {
  'use strict';
  const ML = (window.MoireLab = window.MoireLab || {});

  const ROTATE_SPEED = 0.55; // rad/s (回転ボタンを押している間)

  // ---- 模様のミニプレビュー (viewBox 0 0 40 40 の中身) ----
  function patternIcon(type, stroke) {
    const s = `fill="none" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round"`;
    if (type === 0) {
      return `<g ${s}><path d="M12 6v28"/><path d="M20 6v28"/><path d="M28 6v28"/></g>`;
    }
    if (type === 1) {
      return `<g ${s}><path d="M11 8v24M20 8v24M29 8v24M8 11h24M8 20h24M8 29h24"/></g>`;
    }
    if (type === 2) {
      let dots = '';
      for (const cx of [12, 20, 28]) for (const cy of [12, 20, 28]) {
        dots += `<circle cx="${cx}" cy="${cy}" r="2.6"/>`;
      }
      return `<g fill="${stroke}">${dots}</g>`;
    }
    if (type === 3) {
      return `<g ${s}><circle cx="20" cy="20" r="5"/><circle cx="20" cy="20" r="10"/><circle cx="20" cy="20" r="15"/></g>`;
    }
    let petals = '';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = 20 + Math.cos(a) * 8.5, y = 20 + Math.sin(a) * 8.5;
      petals += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.6"/>`;
    }
    return `<g fill="${stroke}">${petals}<circle cx="20" cy="20" r="3.4" fill="#ffd76e"/></g>`;
  }

  function paletteIcon(palette) {
    if (palette.rainbow) {
      return `<g stroke-width="4" fill="none">
        <path d="M8 26 a12 12 0 0 1 24 0" stroke="#ff5f6d"/>
        <path d="M12 26 a8 8 0 0 1 16 0" stroke="#ffc93c"/>
        <path d="M16 26 a4 4 0 0 1 8 0" stroke="#38b6ff"/></g>`;
    }
    const rgb = (v) => `rgb(${Math.round(v[0] * 255)},${Math.round(v[1] * 255)},${Math.round(v[2] * 255)})`;
    return `<g>
      <path d="M20 4 A16 16 0 0 1 33.8 28 L20 20 Z" fill="${rgb(palette.c)}"/>
      <path d="M33.8 28 A16 16 0 0 1 6.2 28 L20 20 Z" fill="${rgb(palette.b)}"/>
      <path d="M6.2 28 A16 16 0 0 1 20 4 L20 20 Z" fill="${rgb(palette.a)}"/>
      <circle cx="20" cy="20" r="15.5" fill="none" stroke="#fff" stroke-width="1.6"/></g>`;
  }

  const LIGHT_ICON = `<g fill="none" stroke="#f5a623" stroke-width="2.6" stroke-linecap="round">
    <circle cx="20" cy="20" r="7" fill="#ffe08a"/>
    <path d="M20 5v4M20 31v4M5 20h4M31 20h4M9.4 9.4l2.8 2.8M27.8 27.8l2.8 2.8M30.6 9.4l-2.8 2.8M12.2 27.8l-2.8 2.8"/></g>`;

  const MIST_ICON = `<g>
    <path d="M14 16h8v16a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z" fill="#9ed6f5" stroke="#4a90b8" stroke-width="2"/>
    <path d="M15 10h6v6h-6z" fill="#4a90b8"/>
    <path d="M16 7h4v3h-4z" fill="#33627e"/>
    <g fill="#bde6ff" stroke="#7fc4e8" stroke-width="1.2">
      <circle cx="28" cy="9" r="2"/><circle cx="33" cy="13" r="2.4"/><circle cx="29" cy="17" r="1.8"/><circle cx="35" cy="20" r="1.6"/></g></g>`;

  function rotateIcon(clockwise) {
    const flip = clockwise ? '' : ' transform="scale(-1,1) translate(-40,0)"';
    return `<g${flip}><path d="M31 20 a11 11 0 1 1 -5-9.2" fill="none" stroke="#7b6cf6" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M25 4 l7 5.5 -8.5 3 z" fill="#7b6cf6"/></g>`;
  }

  function setupUI(state, particles) {
    const toolbar = document.getElementById('toolbar');
    const held = { rotate: 0 };

    function makeButton(id, label, html) {
      const btn = document.createElement('button');
      btn.id = 'btn-' + id;
      btn.className = 'tool';
      btn.type = 'button';
      btn.setAttribute('aria-label', label);
      btn.innerHTML = `<svg viewBox="0 0 40 40">${html}</svg>`;
      toolbar.appendChild(btn);
      return btn;
    }

    function setIcon(btn, html) {
      btn.querySelector('svg').innerHTML = html;
    }

    function pop(btn) {
      btn.classList.remove('pop');
      void btn.offsetWidth; // アニメーションを最初から再生し直す
      btn.classList.add('pop');
      ML.audio.pop();
    }

    // 上のシートの模様 (ピンクの縁取り)
    const btnA = makeButton('patA', 'うえのシートのもよう', patternIcon(state.top.pattern, '#e0568c'));
    btnA.classList.add('ring-pink');
    btnA.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      state.top.pattern = (state.top.pattern + 1) % ML.PATTERN_COUNT;
      setIcon(btnA, patternIcon(state.top.pattern, '#e0568c'));
      pop(btnA);
    });

    // 下のシートの模様 (水色の縁取り)
    const btnB = makeButton('patB', 'したのシートのもよう', patternIcon(state.bottom.pattern, '#2e86c1'));
    btnB.classList.add('ring-blue');
    btnB.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      state.bottom.pattern = (state.bottom.pattern + 1) % ML.PATTERN_COUNT;
      setIcon(btnB, patternIcon(state.bottom.pattern, '#2e86c1'));
      pop(btnB);
    });

    // 色をかえる
    const btnColor = makeButton('color', 'いろをかえる', paletteIcon(ML.PALETTES[state.palette]));
    btnColor.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      state.palette = (state.palette + 1) % ML.PALETTES.length;
      setIcon(btnColor, paletteIcon(ML.PALETTES[state.palette]));
      pop(btnColor);
    });

    // 光を当てる (トグル)
    const btnLight = makeButton('light', 'ひかりをあてる', LIGHT_ICON);
    btnLight.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      state.light.on = !state.light.on;
      btnLight.classList.toggle('active', state.light.on);
      pop(btnLight);
    });

    // 霧吹き
    const btnMist = makeButton('mist', 'きりふきをかける', MIST_ICON);
    btnMist.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      particles.sprayBurst();
      pop(btnMist);
    });

    // 回転 (押している間まわる)
    function makeRotate(id, label, dir) {
      const btn = makeButton(id, label, rotateIcon(dir > 0));
      const start = (e) => {
        e.stopPropagation();
        held.rotate = dir * ROTATE_SPEED;
        btn.classList.add('active');
        ML.audio.pop();
      };
      const stop = () => {
        if (Math.sign(held.rotate) === Math.sign(dir)) held.rotate = 0;
        btn.classList.remove('active');
      };
      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', stop);
      btn.addEventListener('pointercancel', stop);
      btn.addEventListener('pointerleave', stop);
    }
    makeRotate('ccw', 'ひだりにまわす', -1);
    makeRotate('cw', 'みぎにまわす', 1);

    return { held };
  }

  ML.setupUI = setupUI;
})();
