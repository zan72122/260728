/*
 * sheets.js
 * 「透明シート」の状態と、模様(周期構造)の数学をまとめたモジュール。
 * GLSL シェーダー側 (gl-renderer.js) と完全に同じ式を JS でも持ち、
 * 粒子エフェクトが「いま画面のどこが明るいか」を計算できるようにする。
 */
(function () {
  'use strict';
  const ML = (window.MoireLab = window.MoireLab || {});

  const TAU = Math.PI * 2;
  // 画面の短辺を 1.0 とした座標系での、細かい縞の本数 (周期構造の基本周波数)
  const BASE_FREQ = 42.0;

  // 模様の種類 (子ども向けの呼び名)
  //  0: しましま (レースカーテンの縦じま)
  //  1: あみあみ (レースの網目)
  //  2: あまつぶ (雨粒のドット)
  //  3: なみのわ (水の輪)
  //  4: おはな   (花びらのうずまき)
  const PATTERN_COUNT = 5;

  // 色のセット (m=0 の暗い色 → m=1 の明るい色 へ 3 段グラデーション)
  // rainbow: true のものは色相環をまわる特別扱い
  const PALETTES = [
    { name: 'レースカーテン', a: [0.33, 0.27, 0.42], b: [0.79, 0.64, 0.78], c: [1.0, 0.96, 0.92], rainbow: false },
    { name: 'いろみず あお', a: [0.05, 0.17, 0.36], b: [0.18, 0.62, 0.82], c: [0.92, 0.99, 1.0], rainbow: false },
    { name: 'いちごミルク', a: [0.48, 0.12, 0.28], b: [0.95, 0.43, 0.60], c: [1.0, 0.93, 0.95], rainbow: false },
    { name: 'にじ', a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0], rainbow: true },
    { name: 'よるのまど', a: [0.04, 0.06, 0.19], b: [0.29, 0.25, 0.56], c: [1.0, 0.85, 0.54], rainbow: false },
  ];

  // 1 枚のシート: 位置 (x, y) / 回転 rot / 拡大率 scale / 模様 pattern
  function createSheet(pattern, rot, scale) {
    return { x: 0, y: 0, rot, scale, pattern };
  }

  function createState() {
    return {
      // 下のシートはゆっくり自動で流れ、上のシートを子どもが動かす
      bottom: createSheet(0, 0.0, 1.0),
      top: createSheet(0, 0.06, 1.03),
      palette: 0,
      light: { on: false, x: 0.0, y: -0.05 },
      mist: 0.0,               // 霧吹きの残り香 (0..1)
      pointer: { x: 0, y: 0, active: false }, // 画面座標 (px)
      time: 0,
    };
  }

  // ---- 模様の値 (0..1)。GLSL 側 patternValue() と同一式を保つこと ----
  function patternValue(type, x, y) {
    const f = BASE_FREQ;
    if (type === 0) {
      return 0.5 + 0.5 * Math.sin(TAU * f * x);
    }
    if (type === 1) {
      const a = 0.5 + 0.5 * Math.sin(TAU * f * x);
      const b = 0.5 + 0.5 * Math.sin(TAU * f * y);
      return Math.max(a, b) * 0.85 + 0.15 * a * b;
    }
    if (type === 2) {
      const d = Math.sin(TAU * f * 0.75 * x) * Math.sin(TAU * f * 0.75 * y);
      return 0.5 + 0.5 * d;
    }
    if (type === 3) {
      return 0.5 + 0.5 * Math.sin(TAU * f * 0.9 * Math.hypot(x, y));
    }
    // type === 4 (おはな): 花びら + うずまき
    const ang = Math.atan2(y, x);
    const r = Math.hypot(x, y);
    return 0.5 + 0.5 * Math.sin(12.0 * ang + TAU * f * 0.35 * r);
  }

  // ワールド座標 (短辺=1, 中心原点, y は下向き) → シートのローカル座標
  function toSheet(sheet, wx, wy) {
    const c = Math.cos(-sheet.rot);
    const s = Math.sin(-sheet.rot);
    const qx = wx - sheet.x;
    const qy = wy - sheet.y;
    return [(c * qx - s * qy) / sheet.scale, (s * qx + c * qy) / sheet.scale];
  }

  // 2 枚を重ねた明るさ (掛け算 = 透過光の干渉)
  function moireAt(state, wx, wy) {
    const pa = toSheet(state.top, wx, wy);
    const pb = toSheet(state.bottom, wx, wy);
    return (
      patternValue(state.top.pattern, pa[0], pa[1]) *
      patternValue(state.bottom.pattern, pb[0], pb[1])
    );
  }

  // 細かい縞をならして「大きな模様 (うなり) の明るさ」を近似する。
  // 半波長ぶんだけ離した点をいくつか平均すると、細部が打ち消し合って包絡線が残る。
  const ENV_OFFSETS = (function () {
    const l = 1.0 / BASE_FREQ;
    return [
      [0, 0],
      [0.5 * l, 0], [-0.5 * l, 0],
      [0, 0.5 * l], [0, -0.5 * l],
      [0.35 * l, 0.35 * l], [-0.35 * l, -0.35 * l],
    ];
  })();

  function envelopeAt(state, wx, wy) {
    let sum = 0;
    for (let i = 0; i < ENV_OFFSETS.length; i++) {
      sum += moireAt(state, wx + ENV_OFFSETS[i][0], wy + ENV_OFFSETS[i][1]);
    }
    return sum / ENV_OFFSETS.length; // 0 (暗い谷) .. ~0.9 (明るい山)
  }

  // ピボット (ワールド座標の一点) を固定したまま、回転 dTheta / 倍率 k をかける。
  // つまみ回し (ピンチ) や回転ボタンで「その場でくるっと回る」感触を作る。
  function pivotTransform(sheet, pivotX, pivotY, dTheta, k) {
    const local = toSheet(sheet, pivotX, pivotY); // 変形前のローカル点
    sheet.rot += dTheta;
    sheet.scale = Math.min(1.9, Math.max(0.55, sheet.scale * k));
    // 変形後も同じローカル点がピボットに来るよう、平行移動を補正する
    const c = Math.cos(sheet.rot);
    const s = Math.sin(sheet.rot);
    const gx = (c * local[0] - s * local[1]) * sheet.scale;
    const gy = (s * local[0] + c * local[1]) * sheet.scale;
    sheet.x = pivotX - gx;
    sheet.y = pivotY - gy;
  }

  ML.TAU = TAU;
  ML.BASE_FREQ = BASE_FREQ;
  ML.PATTERN_COUNT = PATTERN_COUNT;
  ML.PALETTES = PALETTES;
  ML.createState = createState;
  ML.patternValue = patternValue;
  ML.moireAt = moireAt;
  ML.envelopeAt = envelopeAt;
  ML.pivotTransform = pivotTransform;
})();
