'use strict';
(function(){
const G = window.G;
const S = {};
(G.scenes = G.scenes || {}).title = S;

let clouds = [];

S.enter = function(){
  clouds = [
    { x: 0.15, y: 0.13, s: 42, v: 7 },
    { x: 0.72, y: 0.08, s: 55, v: 5 },
    { x: 0.45, y: 0.2, s: 30, v: 9 }
  ];
};

S.update = function(dt){
  for (const c of clouds) {
    c.x += c.v * dt / Math.max(1, G.W);
    if (c.x > 1.2) c.x = -0.2;
  }
};

S.draw = function(ctx){
  const W = G.W, H = G.H, t = G.time;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#8fd0ef');
  sky.addColorStop(0.65, '#cdeaf8');
  sky.addColorStop(1, '#eef9ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  const sunR = Math.min(W, H) * 0.14;
  const sx = W / 2, sy = H * 0.26;
  ctx.save();
  ctx.translate(sx, sy);
  G.icons.sun(ctx, sunR, t, false, 0.25 + 0.15 * Math.sin(t * 2));
  ctx.restore();
  G.icons.hint(ctx, sx, sy, sunR * 1.55, t);

  for (const c of clouds) {
    ctx.save();
    ctx.translate(c.x * W, c.y * H + c.s);
    G.icons.cloud(ctx, c.s);
    ctx.restore();
  }

  // wooden table with a coated sheet and a few objects
  const tableY = H * 0.68;
  const wood = ctx.createLinearGradient(0, tableY, 0, H);
  wood.addColorStop(0, '#cfa273');
  wood.addColorStop(1, '#a87c4f');
  ctx.fillStyle = wood;
  ctx.fillRect(0, tableY, W, H - tableY);

  const pw = Math.min(W * 0.56, 340);
  const ph = pw * 0.72;
  const px = W / 2 - pw / 2, py = tableY + (H - tableY) * 0.5 - ph / 2;
  ctx.save();
  ctx.translate(W / 2, py + ph / 2);
  ctx.rotate(-0.03);
  ctx.shadowColor = 'rgba(80,50,20,0.3)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#e9ecc9';
  G.roundRect(ctx, -pw / 2, -ph / 2, pw, ph, 6);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  const os = pw * 0.13;
  ctx.save(); ctx.translate(-pw * 0.22, -ph * 0.05); ctx.rotate(0.5); G.shapes.byId.leaf.real(ctx, os); ctx.restore();
  ctx.save(); ctx.translate(pw * 0.18, -ph * 0.12); ctx.rotate(-0.3); G.shapes.byId.star.real(ctx, os * 0.8); ctx.restore();
  ctx.save(); ctx.translate(pw * 0.05, ph * 0.24); ctx.rotate(0.15); G.shapes.byId.heart.real(ctx, os * 0.7); ctx.restore();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fs = Math.min(W * 0.068, 46);
  ctx.font = '700 ' + fs + 'px ' + G.FONT;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('おひさま しゃしんやさん', W / 2 + 2, H * 0.55 + 2);
  ctx.fillStyle = '#2b4d86';
  ctx.fillText('おひさま しゃしんやさん', W / 2, H * 0.55);
};

S.down = function(id, p){
  G.audio.ping();
  G.fadeTo('table');
};
})();
