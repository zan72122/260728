import { Game } from './game';
import { render } from './render';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const game = new Game();
game.resetCar(0, false);
game.phase = 'title';

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  game.W = w;
  game.H = h;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => window.setTimeout(resize, 60));
resize();

// single-pointer input
let activeId: number | null = null;
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (activeId !== null) return;
  activeId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  game.pointerDown(e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== activeId) return;
  e.preventDefault();
  game.pointerMove(e.clientX, e.clientY);
});
const endPointer = (e: PointerEvent): void => {
  if (e.pointerId !== activeId) return;
  activeId = null;
  game.pointerUp(e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
window.addEventListener('blur', () => {
  if (activeId !== null) {
    activeId = null;
    game.pointerUp(game.pointer.x, game.pointer.y);
  }
});
document.addEventListener('gesturestart', (e) => e.preventDefault());
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  ctx.clearRect(0, 0, game.W, game.H);
  render(game, ctx);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// E2E / debug hook
declare global {
  interface Window { __game?: { debug: () => Record<string, unknown>; game: Game } }
}
window.__game = { debug: () => game.debug(), game };
