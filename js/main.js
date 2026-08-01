// 起動：キャンバスの用意とメインループ。
import { Game } from './game.js';

const canvas = document.getElementById('stage');
const game = new Game(canvas);

// 画面サイズ・向きの変化に追従（iOS はアドレスバーの伸縮でも発火する）
const doResize = () => game.resize();
window.addEventListener('resize', doResize);
window.addEventListener('orientationchange', () => {
  doResize();
  // iOS は orientationchange 直後だとまだ旧サイズを返すことがある
  setTimeout(doResize, 120);
  setTimeout(doResize, 400);
});
if (window.visualViewport) window.visualViewport.addEventListener('resize', doResize);
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(doResize).observe(canvas);
document.addEventListener('visibilitychange', () => { last = 0; });

let last = 0;
// コマ落ちが続く端末では、静かに描画解像度を落とす
let frameEma = 16.7;
let checkAt = 0;

function frame(now) {
  if (!last) last = now;
  const raw = now - last;
  const dt = Math.min(raw / 1000, 0.1);
  last = now;
  try {
    game.update(dt);
    game.draw();
  } catch (err) {
    // 1 フレームの失敗でゲームが止まらないようにする
    console.error('frame error', err);
  }
  if (raw > 0 && raw < 500) frameEma += (raw - frameEma) * 0.06;
  if (now > checkAt) {
    if (frameEma > 26 && game.degradeQuality()) frameEma = 16.7;
    checkAt = now + 2500;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// デバッグ / 自動テストからさわれるように
window.__game = game;
