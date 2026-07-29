// ビューポートサイズからステージ座標を計算する。
// かみを画面の大部分に広げ、フックは上端付近に置く。

/** @type {ReturnType<typeof buildLayout> | null} */
let layout = null;

/**
 * @param {number} w 論理幅(px)
 * @param {number} h 論理高さ(px)
 */
export function computeLayout(w, h) {
  layout = buildLayout(w, h);
  return layout;
}

export function getLayout() {
  if (!layout) layout = buildLayout(900, 1200);
  return layout;
}

function buildLayout(w, h) {
  const scale = Math.min(w, h) / 900;
  const marginX = w * 0.032;
  const marginBottom = Math.max(6, h * 0.008);

  const anchorY = Math.max(32 * scale, h * 0.028);
  const paperW = w - marginX * 2;
  // フック〜かみ上端の余白 + かみ本体で画面をほぼ使い切る
  const paperTop = anchorY + h * 0.055;
  const paperH = h - marginBottom - paperTop;
  const paperX = marginX;
  const paperY = paperTop;
  const paperR = Math.min(38 * scale, paperW * 0.045);

  const paper = { x: paperX, y: paperY, w: paperW, h: paperH, r: paperR };
  const anchor = { x: w / 2, y: anchorY };
  const home = { x: paper.x + paper.w / 2, y: paper.y + paper.h / 2 };
  const pad = Math.max(36, 42 * scale);
  const limits = {
    rx: Math.max(60, paper.w / 2 - pad),
    ry: Math.max(60, paper.h / 2 - pad * 0.88),
  };

  return {
    stage: { w, h },
    paper,
    anchor,
    home,
    limits,
    grabRadius: 110 * scale,
    cup: { w: 66 * scale, h: 64 * scale },
    scale,
    push: { impulse: 240 * scale, maxSpeed: 1500 * scale, cooldownSec: 0.25 },
    settle: { amp: 14 * scale, speed: 26 * scale },
  };
}
