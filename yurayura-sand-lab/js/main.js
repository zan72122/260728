// エントリーポイント。入力・リサイズ・ゲームループ。
import { SAND_TYPES, PAPERS } from './config.js';
import { computeLayout, getLayout } from './layout.js';
import { clamp, dist } from './utils.js';
import { Pendulum } from './pendulum.js';
import { SandSystem } from './sand.js';
import { Renderer } from './render.js';
import { AudioBox } from './audio.js';
import { UI } from './ui.js';

const canvas = document.getElementById('stage');
const audio = new AudioBox();

let prevLayout = null;
let pendulum = null;
let sand = null;
let renderer = null;

const state = {
  paperIndex: 0,
  type: SAND_TYPES[0],
  grabbing: false,
  pointerTrail: [],
  pointerStart: null,
  lastPushAt: -Infinity,
  mistTimer: 0,
  slideTimer: 0,
  releases: 0,
  emptiedOnce: false,
  time: 0,
  nextBadgeCheckAt: 0,
};

function applyStageSize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  prevLayout = getLayout();
  const layout = computeLayout(w, h);

  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  if (!sand) {
    sand = new SandSystem(w, h);
    sand.setType(state.type);
    sand.setPaper(PAPERS[state.paperIndex]);
    renderer = new Renderer(canvas, sand);
    pendulum = new Pendulum(layout.home, layout.limits);
    pendulum.settleAmp = layout.settle.amp;
    pendulum.settleSpeed = layout.settle.speed;
  } else {
    sand.resize(w, h, prevLayout);
    renderer.rebuildBackground();
    pendulum.applyLayout(layout.home, layout.limits, layout.scale);
  }

  renderer.setDpr(dpr);
}

const ui = new UI({
  onSelectType(type) {
    audio.ensure();
    state.type = type;
    sand.setType(type);
    audio.tick();
  },
  onRefill() {
    audio.ensure();
    sand.refill();
    audio.pour();
    ui.setRefillPulse(false);
    state.emptiedOnce = false;
  },
  onMist() {
    if (state.mistTimer > 0) return;
    audio.ensure();
    state.mistTimer = 1.2;
    sand.spawnMistDrops();
    audio.spray();
    ui.setMistBusy(true);
    ui.award('mist');
  },
  onPaper() {
    if (state.slideTimer > 0) return;
    audio.ensure();
    state.slideTimer = 0.45;
    audio.swoosh();
  },
  onMute(muted) {
    audio.ensure();
    audio.setMuted(muted);
  },
});

applyStageSize();
ui.positionFab();
window.addEventListener('resize', () => {
  applyStageSize();
  ui.positionFab();
});
window.addEventListener('orientationchange', () => setTimeout(() => {
  applyStageSize();
  ui.positionFab();
}, 120));

// ---- 座標変換 -------------------------------------------------------

function toStage(event) {
  const rect = canvas.getBoundingClientRect();
  const { stage } = getLayout();
  return {
    x: (event.clientX - rect.left) * (stage.w / rect.width),
    y: (event.clientY - rect.top) * (stage.h / rect.height),
  };
}

function recordTrail(point) {
  const now = performance.now();
  state.pointerTrail.push({ ...point, t: now });
  while (state.pointerTrail.length > 0 && now - state.pointerTrail[0].t > 120) {
    state.pointerTrail.shift();
  }
}

function flickVelocity() {
  const trail = state.pointerTrail;
  if (trail.length < 2) return { vx: 0, vy: 0 };
  const first = trail[0];
  const last = trail[trail.length - 1];
  const dtSec = Math.max((last.t - first.t) / 1000, 0.016);
  return { vx: (last.x - first.x) / dtSec, vy: (last.y - first.y) / dtSec };
}

// ---- ポインター入力 -------------------------------------------------

canvas.addEventListener('pointerdown', (event) => {
  if (ui.isPanelOpen()) return;
  audio.ensure();
  state.pointerStart = { x: event.clientX, y: event.clientY };
  const point = toStage(event);
  const { grabRadius } = getLayout();
  const cup = pendulum.pos;
  if (dist(point.x, point.y, cup.x, cup.y) <= grabRadius) {
    state.grabbing = true;
    state.pointerTrail = [];
    recordTrail(point);
    pendulum.grab(point.x, point.y);
    canvas.setPointerCapture(event.pointerId);
  }
});

canvas.addEventListener('pointermove', (event) => {
  if (!state.grabbing) return;
  const point = toStage(event);
  recordTrail(point);
  pendulum.grabTo(point.x, point.y);
});

function endPointer(event) {
  if (state.grabbing) {
    state.grabbing = false;
    const { vx, vy } = flickVelocity();
    pendulum.release(vx * 0.9, vy * 0.9);
    state.releases += 1;
    audio.pop();
    ui.hideHint();
    checkBadges();
    state.pointerStart = null;
    return;
  }

  if (ui.isPanelOpen() || !state.pointerStart) return;

  const dx = event.clientX - state.pointerStart.x;
  const dy = event.clientY - state.pointerStart.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  state.pointerStart = null;

  // 左右スワイプで色変更
  if (adx > 50 && adx > ady * 1.5) {
    ui.cycleColor(dx > 0 ? -1 : 1);
    return;
  }

  // 小さなタップは「そっと押す」
  const { push } = getLayout();
  if (adx < 18 && ady < 18 && state.time - state.lastPushAt > push.cooldownSec) {
    const point = toStage(event);
    state.lastPushAt = state.time;
    pendulum.push(point.x, point.y, push.impulse, push.maxSpeed);
    audio.tick();
  }
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.setHiss(0);
});

// ---- バッジ ----------------------------------------------------------

function checkBadges() {
  if (sand.depositCount > 260) {
    if (ui.award('first')) audio.badgeChime();
  }
  if (sand.colorsUsed.size >= 3) {
    if (ui.award('colors')) audio.badgeChime();
  }
  if (state.releases >= 5) {
    if (ui.award('five')) audio.badgeChime();
  }
}

// ---- ゲームループ ----------------------------------------------------

let lastFrame = performance.now();

function frame(now) {
  const dt = clamp((now - lastFrame) / 1000, 0, 0.033);
  lastFrame = now;
  state.time += dt;

  pendulum.update(dt);
  const flowing = sand.update(dt, pendulum.pos, state.time);

  if (state.time >= state.nextBadgeCheckAt) {
    state.nextBadgeCheckAt = state.time + 1.5;
    checkBadges();
  }
  audio.setHiss(flowing ? clamp(0.35 + pendulum.speed() / 900, 0, 1) : 0);

  if (sand.amount <= 0) {
    ui.setRefillPulse(true);
    if (!state.emptiedOnce) {
      state.emptiedOnce = true;
      if (ui.award('empty')) audio.badgeChime();
    }
  }

  if (!pendulum.settleNotified && pendulum.isSettled()) {
    pendulum.settleNotified = true;
    sand.spawnSettleSparkles(pendulum.pos.x, pendulum.pos.y);
    audio.settleChime();
    checkBadges();
  }

  if (state.mistTimer > 0) {
    state.mistTimer -= dt;
    sand.mistStep();
    if (state.mistTimer <= 0) ui.setMistBusy(false);
  }

  let slideX = 0;
  const { stage } = getLayout();
  if (state.slideTimer > 0) {
    state.slideTimer -= dt;
    const progress = 1 - Math.max(state.slideTimer, 0) / 0.45;
    slideX = progress * progress * (stage.w + 80);
    if (state.slideTimer <= 0) {
      state.paperIndex = (state.paperIndex + 1) % PAPERS.length;
      sand.setPaper(PAPERS[state.paperIndex]);
      slideX = 0;
    }
  }

  renderer.draw({
    pend: pendulum,
    sandColor: sand.currentColor(state.time),
    slideX,
    t: state.time,
  });

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
