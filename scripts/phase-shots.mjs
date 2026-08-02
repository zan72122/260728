// Plays a full loop (landscape by default) capturing every phase for visual review.
import { chromium } from 'playwright-core';

const LAND = !process.argv.includes('--portrait');
const W = LAND ? 844 : 390;
const H = LAND ? 390 : 844;
const TAG = LAND ? 'p-land' : 'p-port';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const page = await (await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1.5 })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/favicon/i.test(t)) errs.push('console: ' + t);
  if (t.startsWith('[retint]')) console.log(t);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dbg = () => page.evaluate(() => window.__game.debug());
async function waitPhase(want, timeout = 25000) {
  const t0 = Date.now();
  for (;;) {
    const d = await dbg();
    if (d.phase === want) return d;
    if (Date.now() - t0 > timeout) throw new Error(`timeout: want ${want} got ${d.phase}`);
    await sleep(150);
  }
}
const shot = (n) => page.screenshot({ path: `shots/${TAG}-${n}.png` });
async function tap(x, y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}
async function swipe(x0, y0, x1, y1, ms = 170) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8);
    await sleep(ms / 8);
  }
  await page.mouse.up();
}

await page.goto('http://127.0.0.1:4173/');
await page.waitForFunction(() => !!window.__game, null, { timeout: 20000 });
await sleep(1000);
await shot('01-title');
await tap(W / 2, H * 0.78);
await waitPhase('garage');
await sleep(1400);
await shot('02-arrived');
let d = await dbg();
await swipe(d.targets.lever.x, d.targets.lever.y, d.targets.lever.x, d.targets.lever.y - 130);
await sleep(2600);
await shot('03-lifted');
d = await dbg();
await swipe(d.targets.mech.x, d.targets.mech.y, d.targets.mech.x - 240, d.targets.mech.y, 130);
await sleep(600);
await shot('04-sliding');
await waitPhase('under');
await sleep(900);
await shot('05-under');
// fix faults
d = await dbg();
for (let i = 0; i < d.faults.length; i++) {
  d = await dbg();
  const f = d.faults[i];
  if (f.fixed) continue;
  const from = d.targets[`fault${i}_from`];
  const to = d.targets[`fault${i}_to`];
  if (f.kind === 'bolt') {
    for (let t = 0; t < 3; t++) {
      const dd = await dbg();
      if (dd.faults[i].fixed) break;
      const p = dd.targets[`fault${i}_from`];
      await tap(p.x, p.y);
      await sleep(400);
    }
  } else if (f.kind === 'exhaust') {
    await swipe(from.x, from.y, to.x, to.y, 300);
  } else {
    await swipe(from.x, from.y, to.x, to.y, 480);
  }
  await sleep(500);
}
d = await dbg();
console.log('faults remaining:', d.faultsRemaining);
await shot('06-under-fixed');
await swipe(W * 0.5, H * 0.55, W * 0.5 + 240, H * 0.55, 130);
await waitPhase('garage');
await sleep(800);
await shot('07-out-mask');
d = await dbg();
if (d.targets.mask) await tap(d.targets.mask.x, d.targets.mask.y);
await waitPhase('weld');
await sleep(900);
await shot('08-weld-start');
// trace
d = await dbg();
for (let attempt = 0; attempt < 3 && d.cracksRemaining > 0; attempt++) {
  const pts = d.crackPts;
  await page.mouse.move(pts[0].x, pts[0].y + 10);
  await page.mouse.down();
  await sleep(90);
  for (let pass = 0; pass < 2; pass++) {
    const seq = pass % 2 === 0 ? pts : [...pts].reverse();
    for (const p of seq) {
      await page.mouse.move(p.x, p.y + 8);
      await sleep(30);
    }
    if (pass === 0) await shot('09-welding');
  }
  await page.mouse.up();
  await sleep(500);
  d = await dbg();
  if (d.phase !== 'weld') break;
}
console.log('cracks remaining:', (await dbg()).cracksRemaining);
await shot('10-weld-done');
await waitPhase('garage');
await sleep(600);
await shot('11-repaired');
d = await dbg();
await swipe(d.targets.lever.x, d.targets.lever.y, d.targets.lever.x, d.targets.lever.y + 130);
await waitPhase('test', 30000);
await sleep(3000);
await shot('12-test');
await waitPhase('choice', 40000);
await sleep(1400);
await shot('13-choice');
// free play quick look
d = await dbg();
await tap(d.targets.free.x, d.targets.free.y);
await waitPhase('garage');
await sleep(1200);
await shot('14-free');
d = await dbg();
await tap(d.targets.plate.x, d.targets.plate.y);
await waitPhase('freeweld');
await sleep(900);
await swipe(W * 0.3, H * 0.5, W * 0.7, H * 0.4, 500);
await shot('15-freeweld');

if (errs.length) console.log('ERRORS:\n' + errs.join('\n'));
else console.log('phase run ok');
await b.close();
