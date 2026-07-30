'use strict';
(function(){
const G = window.G;
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
G.canvas = cv;
G.time = 0;
G.W = 0;
G.H = 0;

let dpr = 1;
function resize(){
  dpr = Math.min(2, window.devicePixelRatio || 1);
  G.W = window.innerWidth;
  G.H = window.innerHeight;
  cv.width = Math.round(G.W * dpr);
  cv.height = Math.round(G.H * dpr);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 60));
resize();

G.state = { sheet: null, objects: [], prints: [] };
G.newSheet = function(){
  G.state.sheet = new G.Sheet(G.H > G.W);
  G.state.objects = [];
};

let cur = null;
G.currentName = '';
G.setScene = function(n, a){
  if (cur && cur.exit) cur.exit();
  cur = G.scenes[n];
  G.currentName = n;
  if (cur.enter) cur.enter(a);
};

let fade = null;
G.fadeTo = function(n, a){
  if (fade) return;
  fade = { n, a, v: 0, dir: 1 };
};

const mute = { x: 34, y: 34, r: 20 };
function drawUI(c){
  c.save();
  c.globalAlpha = 0.8;
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.beginPath();
  c.arc(mute.x, mute.y, mute.r, 0, G.TAU);
  c.fill();
  c.translate(mute.x, mute.y);
  G.icons.speaker(c, 10, G.audio.muted);
  c.restore();
}

let last = performance.now();
function frame(now){
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  G.time += dt;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (cur.update) cur.update(dt);
  cur.draw(ctx);
  drawUI(ctx);
  if (fade) {
    fade.v += dt * 3 * fade.dir;
    if (fade.dir > 0 && fade.v >= 1) {
      fade.v = 1;
      G.setScene(fade.n, fade.a);
      fade.dir = -1;
    }
    if (fade && fade.dir < 0 && fade.v <= 0) fade = null;
    if (fade) {
      ctx.fillStyle = 'rgba(252,250,240,' + G.clamp(fade.v, 0, 1) + ')';
      ctx.fillRect(0, 0, G.W, G.H);
    }
  }
  requestAnimationFrame(frame);
}

function pt(e){ return { x: e.clientX, y: e.clientY }; }

cv.addEventListener('pointerdown', e => {
  e.preventDefault();
  G.audio.unlock();
  const p = pt(e);
  if (G.dist(p.x, p.y, mute.x, mute.y) < mute.r + 8) {
    G.audio.toggle();
    return;
  }
  if (fade) return;
  if (cur.down) cur.down(e.pointerId, p);
});
window.addEventListener('pointermove', e => {
  if (fade || !cur) return;
  if (cur.move) cur.move(e.pointerId, pt(e));
});
const up = e => { if (cur && cur.up) cur.up(e.pointerId, pt(e)); };
window.addEventListener('pointerup', up);
window.addEventListener('pointercancel', up);
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());

G.setScene('title');
requestAnimationFrame(frame);
})();
