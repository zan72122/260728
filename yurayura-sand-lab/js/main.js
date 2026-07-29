// エントリーポイント。入力・ゲームループ・各モジュールの糊付けを担当。
import {
  STAGE, HOME, LIMITS, GRAB_RADIUS, PUSH, SAND_TYPES, PAPERS,
} from './config.js';
import { clamp, dist } from './utils.js';
import { Pendulum } from './pendulum.js';
import { SandSystem } from './sand.js';
import { Renderer } from './render.js';
import { AudioBox } from './audio.js';
import { UI } from './ui.js';

const canvas = document.getElementById('stage');
const audio = new AudioBox();
const pendulum = new Pendulum(HOME, LIMITS);
const sand = new SandSystem(STAGE.W, STAGE.H);
const renderer = new Renderer(canvas, sand);

const state = {
  paperIndex: 0,
  type: SAND_TYPES[0],
  grabbing: false,
  pointerTrail: [],   // フリック速度の計測用 {x, y, t}
  lastPushAt: -Infinity,
  mistTimer: 0,
  slideTimer: 0,      // かみ替えスライドアニメの残り時間
  releases: 0,
  mistUsedOnce: false,
  emptiedOnce: false,
  time: 0,
};

sand.setType(state.type);
sand.setPaper(PAPERS[state.paperIndex]);

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
    state.emptiedOnce = false; // 次に空にしたらまたバッジ判定できる
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

// ---- ポインター入力 -------------------------------------------------

function toStage(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (STAGE.W / rect.width),
    y: (event.clientY - rect.top) * (STAGE.H / rect.height),
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

canvas.addEventListener('pointerdown', (event) => {
  audio.ensure();
  const point = toStage(event);
  const cup = pendulum.pos;
  if (dist(point.x, point.y, cup.x, cup.y) <= GRAB_RADIUS) {
    state.grabbing = true;
    state.pointerTrail = [];
    recordTrail(point);
    pendulum.grab(point.x, point.y);
    canvas.setPointerCapture(event.pointerId);
  } else if (state.time - state.lastPushAt > PUSH.cooldownSec) {
    // そっと押す:カップ以外をタップすると、指から離れる向きへ小さな力
    state.lastPushAt = state.time;
    pendulum.push(point.x, point.y, PUSH.impulse, PUSH.maxSpeed);
    audio.tick();
  }
});

canvas.addEventListener('pointermove', (event) => {
  if (!state.grabbing) return;
  const point = toStage(event);
  recordTrail(point);
  pendulum.grabTo(point.x, point.y);
});

function endGrab() {
  if (!state.grabbing) return;
  state.grabbing = false;
  const { vx, vy } = flickVelocity();
  pendulum.release(vx * 0.9, vy * 0.9);
  state.releases += 1;
  audio.pop();
  ui.hideHint();
  checkBadges();
}

canvas.addEventListener('pointerup', endGrab);
canvas.addEventListener('pointercancel', endGrab);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.setHiss(0);
});

// ---- バッジ(あそびの小目標) ----------------------------------------

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
  audio.setHiss(flowing ? clamp(0.35 + pendulum.speed() / 900, 0, 1) : 0);

  // すなが空になった瞬間
  if (sand.amount <= 0) {
    ui.setRefillPulse(true);
    if (!state.emptiedOnce) {
      state.emptiedOnce = true;
      if (ui.award('empty')) audio.badgeChime();
    }
  }

  // 揺れおわりの「できあがり」演出(1回の揺れにつき1度だけ)
  if (!pendulum.settleNotified && pendulum.isSettled()) {
    pendulum.settleNotified = true;
    sand.spawnSettleSparkles(pendulum.pos.x, pendulum.pos.y);
    audio.settleChime();
    checkBadges();
  }

  // きりのアニメーション
  if (state.mistTimer > 0) {
    state.mistTimer -= dt;
    sand.mistStep();
    if (state.mistTimer <= 0) ui.setMistBusy(false);
  }

  // かみ替えのスライドアニメーション
  let slideX = 0;
  if (state.slideTimer > 0) {
    state.slideTimer -= dt;
    const progress = 1 - Math.max(state.slideTimer, 0) / 0.45;
    slideX = progress * progress * (STAGE.W + 80);
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
