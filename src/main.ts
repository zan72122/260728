import { Game } from './game';
import { initView, view } from './three/scene3d';
import { drawOverlay } from './overlay';

const glCanvas = document.getElementById('stage') as HTMLCanvasElement;
const fxCanvas = document.getElementById('fx') as HTMLCanvasElement;
const fctx = fxCanvas.getContext('2d')!;

async function boot(): Promise<void> {
  await initView(glCanvas);
  const game = new Game();
  game.resetCar(0, false);
  game.phase = 'title';

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    view.resize(w, h, dpr);
    fxCanvas.width = Math.round(w * dpr);
    fxCanvas.height = Math.round(h * dpr);
    fxCanvas.style.width = `${w}px`;
    fxCanvas.style.height = `${h}px`;
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    game.W = w;
    game.H = h;
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => window.setTimeout(resize, 60));
  resize();

  // single-pointer input
  let activeId: number | null = null;
  glCanvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (activeId !== null) return;
    activeId = e.pointerId;
    glCanvas.setPointerCapture(e.pointerId);
    game.pointerDown(e.clientX, e.clientY);
  });
  glCanvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    e.preventDefault();
    game.pointerMove(e.clientX, e.clientY);
  });
  const endPointer = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    game.pointerUp(e.clientX, e.clientY);
  };
  glCanvas.addEventListener('pointerup', endPointer);
  glCanvas.addEventListener('pointercancel', endPointer);
  window.addEventListener('blur', () => {
    if (activeId !== null) {
      activeId = null;
      game.pointerUp(game.pointer.x, game.pointer.y);
    }
  });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  glCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

  let last = performance.now();
  function frame(now: number): void {
    const dt = Math.min(0.12, (now - last) / 1000);
    last = now;
    game.update(dt);
    view.update(game, dt);
    view.render();
    drawOverlay(game, fctx);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // E2E / debug hook
  window.__game = { debug: () => game.debug(), game };
  (window as unknown as { __view: unknown }).__view = view;
}

declare global {
  interface Window { __game?: { debug: () => Record<string, unknown>; game: Game } }
}

void boot();
