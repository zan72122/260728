import type { Game } from './game';
import { glow, chevron, starPath, clamp, lerp, TAU, type Ctx } from './gfx';
import { layoutGarage, layoutUnder, layoutChoice, underToScreen, PART } from './layout';

// Screen-space effects on a transparent canvas above the WebGL view:
// particles, guidance (chevrons / rings / ghost finger), the crisp arc core,
// small corner buttons, and the fade / lock-flash curtains.

export function drawOverlay(g: Game, ctx: Ctx): void {
  ctx.clearRect(0, 0, g.W, g.H);

  switch (g.phase) {
    case 'title': drawTitleOverlay(g, ctx); break;
    case 'garage': drawGarageHints(g, ctx); break;
    case 'under': drawUnderHints(g, ctx); break;
    case 'weld': drawWeldOverlay(g, ctx); break;
    case 'freeweld': drawFreeWeldOverlay(g, ctx); break;
    default: break;
  }

  if ((g.phase === 'weld' || g.phase === 'freeweld') && g.arcOn) {
    drawArc(g, ctx, g.arcX, g.arcY);
  }

  g.parts.draw(ctx);

  if (g.lockFlash > 0) {
    ctx.save();
    ctx.globalAlpha = g.lockFlash * 0.35;
    ctx.fillStyle = '#fff8e0';
    ctx.fillRect(0, 0, g.W, g.H);
    ctx.restore();
  }
  if (g.fade) {
    const f = g.fade;
    const half = f.dur / 2;
    const a = f.t < half ? f.t / half : 1 - (f.t - half) / half;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.fillStyle = '#232733';
    ctx.fillRect(0, 0, g.W, g.H);
    ctx.restore();
  }
}

function drawTitleOverlay(g: Game, ctx: Ctx): void {
  // expanding invitation ring around the 3D start puck
  const br = Math.min(g.W, g.H) * 0.11;
  const bx = g.W / 2;
  const by = g.H * 0.78;
  const ringT = (g.time % 1.6) / 1.6;
  ctx.save();
  ctx.globalAlpha = (1 - ringT) * 0.55;
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(bx, by, br * (1.15 + ringT * 0.8), 0, TAU);
  ctx.stroke();
  ctx.restore();
  glow(ctx, bx, by, br * 2.2, 'rgba(255,180,120,0.25)', 0.8);
}

function drawGarageHints(g: Game, ctx: Ctx): void {
  if (g.liftAnim || g.fade) return;
  const l = layoutGarage(g.W, g.H);
  const pulse = (Math.sin(g.time * 5) + 1) / 2;

  // free-play corner buttons (kept 2D so they never clash with the diorama)
  if (g.freePlay) {
    drawRoundIcon(ctx, l.homeX, l.homeY, l.homeR, (c) => {
      const hr = l.homeR;
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.moveTo(0, -hr * 0.52);
      c.lineTo(hr * 0.55, -hr * 0.05);
      c.lineTo(-hr * 0.55, -hr * 0.05);
      c.closePath();
      c.fill();
      c.fillRect(-hr * 0.38, -hr * 0.05, hr * 0.76, hr * 0.5);
      c.fillStyle = '#576070';
      c.fillRect(-hr * 0.1, hr * 0.12, hr * 0.2, hr * 0.33);
    });
  }

  const mask = g.maskScreenPos(l);
  if (mask) {
    // pulsing tap ring around the floating 3D mask
    const ringT = (g.time % 1.4) / 1.4;
    ctx.save();
    ctx.globalAlpha = (1 - ringT) * 0.7;
    ctx.strokeStyle = '#8fe0d8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(mask.x, mask.y, Math.max(40, l.carW * 0.13) * (1.15 + ringT * 0.9), 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  if (g.hintT <= 1.4) return;
  const upReady = g.liftT >= 1 && g.locked;
  const chevSize = Math.max(16, l.carW * 0.055);
  if (g.liftT === 0) {
    glow(ctx, l.leverX, l.leverY, l.carW * 0.2, 'rgba(255,209,102,0.5)', 0.5 + pulse * 0.5);
    for (let i = 0; i < 3; i++) {
      const yy = l.leverY - chevSize * 1.6 - ((g.time * 60 + i * 26) % 78);
      chevron(ctx, l.leverX, yy, chevSize, 0, '#ffd166', 0.9 - i * 0.25);
    }
  } else if (upReady && (g.freePlay || g.faultsRemaining() > 0)) {
    for (let i = 0; i < 3; i++) {
      const xx = l.mechHomeX - l.carW * 0.12 - ((g.time * 70 + i * 30) % 90);
      chevron(ctx, xx, l.mechY - l.mechS * 2, chevSize, -Math.PI / 2, '#ffd166', 0.9 - i * 0.25);
    }
    glow(ctx, l.mechHomeX, l.mechY, l.carW * 0.18, 'rgba(255,209,102,0.35)', 0.4 + pulse * 0.4);
  } else if (upReady && g.faultsRemaining() === 0 && g.cracksRemaining() > 0) {
    if (mask) glow(ctx, mask.x, mask.y, l.carW * 0.28, 'rgba(120,220,210,0.5)', 0.4 + pulse * 0.6);
  } else if (g.allRepaired() && g.liftT >= 1) {
    glow(ctx, l.leverX, l.leverY, l.carW * 0.2, 'rgba(255,209,102,0.5)', 0.5 + pulse * 0.5);
    for (let i = 0; i < 3; i++) {
      const yy = l.leverY + chevSize * 1.6 + ((g.time * 60 + i * 26) % 78);
      chevron(ctx, l.leverX, yy, chevSize, Math.PI, '#ffd166', 0.9 - i * 0.25);
    }
  }
}

function drawUnderHints(g: Game, ctx: Ctx): void {
  const l = layoutUnder(g.W, g.H);
  const pulse = (Math.sin(g.time * 5) + 1) / 2;
  const first = g.faults.find((f) => !f.fixed);
  if (first) {
    if (g.hintT <= 1.4) return;
    const fp = g.faultGrabPos(first);
    const sp = underToScreen(l, fp.x, fp.y);
    glow(ctx, sp.x, sp.y, l.grabR * (1.1 + pulse * 0.3), 'rgba(255,233,168,0.4)', 0.5 + pulse * 0.5);
    if (first.kind === 'exhaust') {
      const base = underToScreen(l, PART.exhaustGrab.x, PART.exhaustGrab.y);
      const top = underToScreen(l, PART.exhaustGrab.x, PART.exhaustGrab.y - 55);
      const ang = Math.atan2(top.y - base.y, top.x - base.x) + Math.PI / 2;
      const k = 1.2 + pulse * 0.5;
      chevron(ctx, base.x + (top.x - base.x) * k, base.y + (top.y - base.y) * k, l.grabR * 0.4, ang, '#ffd166', 0.9);
    } else if (first.kind === 'clip' || first.kind === 'hose') {
      const to = first.kind === 'clip' ? PART.clipSlot : PART.hoseFit;
      const tp = underToScreen(l, to.x, to.y);
      drawTargetRing(g, ctx, tp.x, tp.y, l.grabR * 0.55);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,233,168,0.7)';
      ctx.lineWidth = 4;
      ctx.setLineDash([2, 14]);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(tp.x, tp.y);
      ctx.stroke();
      ctx.restore();
    }
  } else {
    const y = l.floorY - l.mechS * 3;
    for (let i = 0; i < 3; i++) {
      const xx = g.W * 0.62 + ((g.time * 70 + i * 30) % 90);
      chevron(ctx, xx, y, l.mechS * 1.1, Math.PI / 2, '#c5f6d0', 0.9 - i * 0.25);
    }
  }
}

function drawTargetRing(g: Game, ctx: Ctx, x: number, y: number, r: number): void {
  const pulse = (Math.sin(g.time * 4) + 1) / 2;
  glow(ctx, x, y, r * 1.8, 'rgba(255,209,102,0.25)', 0.4 + pulse * 0.5);
  ctx.save();
  ctx.strokeStyle = `rgba(255,214,110,${0.55 + pulse * 0.45})`;
  ctx.lineWidth = 6;
  ctx.setLineDash([12, 10]);
  ctx.lineDashOffset = -g.time * 26;
  ctx.beginPath();
  ctx.arc(x, y, r + pulse * 4, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawWeldOverlay(g: Game, ctx: Ctx): void {
  const c = g.cracks[g.weldIdx];
  if (!c || c.done || g.arcOn) return;
  const pts = g.crackScreenPts();
  const firstIdx = c.welded.findIndex((w) => !w);
  if (firstIdx >= 0 && pts[firstIdx]) {
    const p = pts[firstIdx];
    const pu = (Math.sin(g.time * 5) + 1) / 2;
    glow(ctx, p.x, p.y, 40 + pu * 18, 'rgba(255,240,190,0.7)', 0.7);
    ctx.fillStyle = '#fff6d8';
    starPath(ctx, p.x, p.y, 12 + pu * 4, 4, 0.4, g.time * 2);
    ctx.fill();
  }
  if (g.hintT > 2.5 && pts.length > 1) {
    const idx = Math.floor(g.hintGhost * (pts.length - 1));
    const p = pts[idx];
    glow(ctx, p.x, p.y, 44, 'rgba(255,255,255,0.55)', 0.8);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 13, 0, TAU);
    ctx.fill();
  }
}

function drawFreeWeldOverlay(g: Game, ctx: Ctx): void {
  // back button
  drawRoundIcon(ctx, 46, 46, 26, (c) => {
    c.strokeStyle = '#ffffff';
    c.lineWidth = 7;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(10, 0);
    c.lineTo(-8, 0);
    c.moveTo(-1, -9);
    c.lineTo(-10, 0);
    c.lineTo(-1, 9);
    c.stroke();
  });
  // sample squiggle while blank
  if (g.doodle.length === 0) {
    const { W, H } = g;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = Math.max(6, Math.min(W, H) * 0.012);
    ctx.lineCap = 'round';
    ctx.setLineDash([2, Math.min(W, H) * 0.05]);
    ctx.lineDashOffset = -g.time * 30;
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const qx = W * (0.25 + (i / 24) * 0.5);
      const qy = H * 0.45 + Math.sin(i * 0.55) * H * 0.1;
      if (i === 0) ctx.moveTo(qx, qy);
      else ctx.lineTo(qx, qy);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawArc(g: Game, ctx: Ctx, x: number, y: number): void {
  const f = 0.75 + Math.random() * 0.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, x, y, 150 * f, 'rgba(120,180,255,0.5)');
  glow(ctx, x, y, 60 * f, 'rgba(190,230,255,0.9)');
  ctx.fillStyle = '#ffffff';
  starPath(ctx, x, y, 16 * f, 4, 0.32, g.time * 6);
  ctx.fill();
  starPath(ctx, x, y, 10 * f, 4, 0.4, -g.time * 8);
  ctx.fill();
  ctx.restore();
}

function drawRoundIcon(ctx: Ctx, x: number, y: number, r: number, icon: (c: Ctx) => void): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#576070';
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 3;
  ctx.stroke();
  icon(ctx);
  ctx.restore();
}

export function choiceDebugTargets(g: Game): Array<{ id: string; x: number; y: number }> {
  return layoutChoice(g.W, g.H).btns.map((b) => ({ id: b.id, x: b.x, y: b.y }));
}

export { lerp };
