// E2E playthrough driver: plays a full repair loop on iPhone/iPad viewports,
// portrait and landscape, verifies phase progression + rotation persistence,
// and captures screenshots for review.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:4173/';
const SHOTS = process.env.E2E_SHOTS ?? 'shots';
mkdirSync(SHOTS, { recursive: true });

const errors = [];
let shotIdx = 0;

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dbg(page) {
  return page.evaluate(() => window.__game.debug());
}

async function waitPhase(page, phases, timeout = 15000) {
  const want = Array.isArray(phases) ? phases : [phases];
  const t0 = Date.now();
  for (;;) {
    const d = await dbg(page);
    if (want.includes(d.phase)) return d;
    if (Date.now() - t0 > timeout) {
      throw new Error(`timeout waiting for phase ${want.join('/')}, got ${d.phase}`);
    }
    await sleep(120);
  }
}

async function shot(page, name) {
  shotIdx++;
  await page.screenshot({ path: join(SHOTS, `${String(shotIdx).padStart(2, '0')}-${name}.png`) });
}

async function tap(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
}

async function swipe(page, x0, y0, x1, y1, ms = 160) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await sleep(ms / steps);
  }
  await page.mouse.up();
}

async function trace(page, pts, padStart = 2) {
  // trace the crack polyline slowly enough for weld coverage
  const first = pts[0];
  await page.mouse.move(first.x, first.y + 10);
  await page.mouse.down();
  await sleep(80);
  for (let pass = 0; pass < padStart; pass++) {
    const seq = pass % 2 === 0 ? pts : [...pts].reverse();
    for (const p of seq) {
      await page.mouse.move(p.x, p.y + 8);
      await sleep(28);
    }
  }
  await page.mouse.up();
}

async function fixFault(page, i, tag) {
  let d = await dbg(page);
  const f = d.faults[i];
  if (!f || f.fixed) return;
  const from = d.targets[`fault${i}_from`];
  const to = d.targets[`fault${i}_to`];
  if (f.kind === 'bolt') {
    for (let t = 0; t < 3; t++) {
      d = await dbg(page);
      if (d.faults[i].fixed) break;
      const p = d.targets[`fault${i}_from`];
      await tap(page, p.x, p.y);
      await sleep(250);
    }
  } else if (f.kind === 'exhaust') {
    await swipe(page, from.x, from.y, to.x, to.y, 260);
  } else {
    await swipe(page, from.x, from.y, to.x, to.y, 420);
  }
  await sleep(400);
  d = await dbg(page);
  if (!d.faults[i].fixed) {
    // one retry with fresh coordinates
    const f2 = d.faults[i];
    const from2 = d.targets[`fault${i}_from`];
    const to2 = d.targets[`fault${i}_to`];
    if (f2.kind === 'bolt') {
      for (let t = 0; t < 3; t++) await tap(page, from2.x, from2.y).then(() => sleep(250));
    } else {
      await swipe(page, from2.x, from2.y, to2.x, to2.y, 500);
    }
    await sleep(400);
    d = await dbg(page);
    if (!d.faults[i].fixed) throw new Error(`${tag}: fault ${i} (${f.kind}) not fixed`);
  }
}

async function playLoop(page, tag, { rotateDuring } = {}) {
  const W = () => page.viewportSize().width;
  const H = () => page.viewportSize().height;

  await shot(page, `${tag}-title`);
  await tap(page, W() / 2, H() * 0.78);
  await waitPhase(page, 'garage', 8000);
  await shot(page, `${tag}-garage-arrived`);

  // lift up: swipe up on the lever
  let d = await dbg(page);
  let lever = d.targets.lever;
  await swipe(page, lever.x, lever.y, lever.x, lever.y - 130);
  await sleep(2200);
  d = await dbg(page);
  if (d.liftT < 1 || !d.locked) throw new Error(`${tag}: lift did not raise/lock (liftT=${d.liftT})`);
  await shot(page, `${tag}-lifted`);

  // creeper slide-in: swipe toward the car
  const mech = d.targets.mech;
  await swipe(page, mech.x, mech.y, mech.x - Math.min(240, W() * 0.5), mech.y, 130);
  await waitPhase(page, 'under', 6000);
  await sleep(700);
  await shot(page, `${tag}-under`);

  // fix all underbody faults
  d = await dbg(page);
  for (let i = 0; i < d.faults.length; i++) {
    await fixFault(page, i, tag);
  }
  d = await dbg(page);
  if (d.faultsRemaining !== 0) throw new Error(`${tag}: faults remaining ${d.faultsRemaining}`);
  await shot(page, `${tag}-under-fixed`);

  // rotation test in the middle of the repair
  if (rotateDuring) {
    const vs = page.viewportSize();
    await page.setViewportSize({ width: vs.height, height: vs.width });
    await sleep(500);
    const dr = await dbg(page);
    if (dr.phase !== 'under' || dr.faultsRemaining !== 0) {
      throw new Error(`${tag}: rotation lost state (phase=${dr.phase}, faults=${dr.faultsRemaining})`);
    }
    await shot(page, `${tag}-under-rotated`);
    await page.setViewportSize({ width: vs.width, height: vs.height });
    await sleep(500);
  }

  // slide out
  await swipe(page, W() * 0.5, H() * 0.55, W() * 0.5 + Math.min(240, W() * 0.5), H() * 0.55, 130);
  await waitPhase(page, 'garage', 6000);
  await shot(page, `${tag}-out`);

  // shield: tap the mask
  d = await dbg(page);
  if (!d.targets.mask) throw new Error(`${tag}: mask target missing`);
  await tap(page, d.targets.mask.x, d.targets.mask.y);
  await waitPhase(page, 'weld', 6000);
  await sleep(300);
  await shot(page, `${tag}-weld-start`);

  // weld the crack: trace along its points
  d = await dbg(page);
  for (let attempt = 0; attempt < 3 && d.cracksRemaining > 0; attempt++) {
    await trace(page, d.crackPts, 2);
    await sleep(400);
    d = await dbg(page);
    if (d.phase !== 'weld') break;
  }
  d = await dbg(page);
  if (d.cracksRemaining !== 0) throw new Error(`${tag}: crack not welded`);
  await shot(page, `${tag}-weld-done`);
  await waitPhase(page, 'garage', 8000);

  // lower the lift: swipe down on the lever
  d = await dbg(page);
  lever = d.targets.lever;
  await swipe(page, lever.x, lever.y, lever.x, lever.y + 130);
  await waitPhase(page, 'test', 12000);
  await sleep(2500);
  await shot(page, `${tag}-test`);
  await tap(page, W() * 0.5, H() * 0.5); // horn for fun
  const dEnd = await waitPhase(page, 'choice', 15000);
  await sleep(1100); // let the fade finish so the shot shows the real screen
  await shot(page, `${tag}-choice`);
  return dEnd;
}

async function tapChoice(page, id) {
  // buttons can be tapped even during the fade-in, but retry to be safe
  for (let i = 0; i < 4; i++) {
    const d = await dbg(page);
    if (d.phase !== 'choice') return;
    const t = d.targets[id];
    if (t) await tap(page, t.x, t.y);
    await sleep(900);
    const d2 = await dbg(page);
    if (d2.phase !== 'choice') return;
  }
  throw new Error(`choice tap ${id} did not leave the choice screen`);
}

async function run() {
  const browser = await launch();
  try {
    await runInner(browser);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runInner(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  await page.goto(BASE);
  await page.waitForFunction(() => !!window.__game, null, { timeout: 10000 });

  // ---- full loop on iPhone portrait, with mid-repair rotation check
  console.log('iPhone portrait: full loop...');
  await playLoop(page, 'iphone-portrait', { rotateDuring: true });

  // ---- choice: next car -> quick second loop on iPhone landscape
  let d;
  await tapChoice(page, 'next');
  await waitPhase(page, 'garage', 10000);
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(400);
  console.log('iPhone landscape: full loop (car 2)...');
  d = await dbg(page);
  if (d.carIdx !== 1) throw new Error(`expected car 2, got ${d.carIdx}`);
  // run remaining loop manually from garage
  {
    const tag = 'iphone-landscape';
    await shot(page, `${tag}-garage`);
    let dd = await dbg(page);
    const lever = dd.targets.lever;
    await swipe(page, lever.x, lever.y, lever.x, lever.y - 130);
    await sleep(2200);
    dd = await dbg(page);
    if (dd.liftT < 1) throw new Error(`${tag}: lift failed`);
    const mech = dd.targets.mech;
    await swipe(page, mech.x, mech.y, mech.x - 240, mech.y, 130);
    await waitPhase(page, 'under', 6000);
    await sleep(700);
    await shot(page, `${tag}-under`);
    dd = await dbg(page);
    for (let i = 0; i < dd.faults.length; i++) await fixFault(page, i, tag);
    await swipe(page, 420, 195, 700, 195, 130);
    await waitPhase(page, 'garage', 6000);
    dd = await dbg(page);
    await tap(page, dd.targets.mask.x, dd.targets.mask.y);
    await waitPhase(page, 'weld', 6000);
    await sleep(300);
    await shot(page, `${tag}-weld`);
    dd = await dbg(page);
    for (let attempt = 0; attempt < 3 && dd.cracksRemaining > 0; attempt++) {
      await trace(page, dd.crackPts, 2);
      await sleep(400);
      dd = await dbg(page);
      if (dd.phase !== 'weld') break;
    }
    dd = await dbg(page);
    if (dd.cracksRemaining !== 0) throw new Error(`${tag}: crack not welded`);
    await waitPhase(page, 'garage', 8000);
    dd = await dbg(page);
    await swipe(page, dd.targets.lever.x, dd.targets.lever.y, dd.targets.lever.x, dd.targets.lever.y + 130);
    await waitPhase(page, 'test', 12000);
    await sleep(2500);
    await shot(page, `${tag}-test`);
    await waitPhase(page, 'choice', 15000);
    await sleep(1100);
    await shot(page, `${tag}-choice`);
  }

  // ---- free play check (iPhone landscape)
  console.log('free play...');
  await tapChoice(page, 'free');
  await waitPhase(page, 'garage', 10000);
  d = await dbg(page);
  if (!d.freePlay) throw new Error('free play flag not set');
  await shot(page, 'free-garage');
  // weld doodle on the plate
  await tap(page, d.targets.plate.x, d.targets.plate.y);
  await waitPhase(page, 'freeweld', 5000);
  const W = page.viewportSize().width;
  const H = page.viewportSize().height;
  await trace(page, [
    { x: W * 0.3, y: H * 0.45 }, { x: W * 0.4, y: H * 0.35 }, { x: W * 0.5, y: H * 0.45 },
    { x: W * 0.6, y: H * 0.35 }, { x: W * 0.7, y: H * 0.45 },
  ], 1);
  await shot(page, 'free-weld-doodle');
  await tap(page, 46, 46);
  await waitPhase(page, 'garage', 5000);
  // creeper joy: lift and slide in/out twice
  d = await dbg(page);
  console.log('free: lift, phase=', d.phase);
  await swipe(page, d.targets.lever.x, d.targets.lever.y, d.targets.lever.x, d.targets.lever.y - 130);
  await sleep(2200);
  d = await dbg(page);
  console.log('free: after lift, phase=', d.phase, 'liftT=', d.liftT);
  for (let i = 0; i < 2; i++) {
    const mech = d.targets.mech;
    await swipe(page, mech.x, mech.y, mech.x - 240, mech.y, 120);
    await waitPhase(page, 'under', 6000);
    await sleep(300);
    await swipe(page, W * 0.5, H * 0.55, W * 0.5 + 240, H * 0.55, 120);
    d = await waitPhase(page, 'garage', 6000);
  }
  await shot(page, 'free-after-slides');
  // home
  d = await dbg(page);
  await tap(page, d.targets.home.x, d.targets.home.y);
  await waitPhase(page, 'title', 5000);

  // ---- iPad portrait & landscape: full loop each
  await page.setViewportSize({ width: 810, height: 1080 });
  await sleep(400);
  console.log('iPad portrait: full loop (car 3)...');
  // title -> loop uses whatever car is current
  await playLoop(page, 'ipad-portrait', {});

  await tapChoice(page, 'next');
  await waitPhase(page, 'garage', 10000);
  await page.setViewportSize({ width: 1080, height: 810 });
  await sleep(400);
  await shot(page, 'ipad-landscape-garage');
  d = await dbg(page);
  if (d.phase !== 'garage') throw new Error('ipad rotation lost garage state');

  console.log('screenshots:', shotIdx);
  if (errors.length) {
    console.log('PAGE ERRORS:');
    for (const e of errors) console.log('  ', e);
    process.exitCode = 1;
  } else {
    console.log('E2E OK — no console/page errors');
  }
}

run().catch((e) => {
  console.error('E2E FAILED:', e.stack || e.message);
  process.exitCode = 1;
});
