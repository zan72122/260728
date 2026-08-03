// 追加エピソード（ベル・ハンドル・油・洗車）を自動プレイで通す検証スクリプト。
//   node tools/episodes-test.mjs [--url=...] [--device=iphone|ipad-land] [--shots=dir]
import { createRequire } from 'module';
import { mkdirSync } from 'fs';

const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const URL = arg('url', 'http://127.0.0.1:8123/index.html');
const SHOTS = arg('shots', '/tmp/shots');
const DEVICES = {
  iphone: { width: 390, height: 844, dsf: 3 },
  'iphone-land': { width: 844, height: 390, dsf: 3 },
  ipad: { width: 820, height: 1180, dsf: 2 },
  'ipad-land': { width: 1180, height: 820, dsf: 2 },
};
const devName = arg('device', 'iphone');
const dev = DEVICES[devName] || DEVICES.iphone;
mkdirSync(SHOTS, { recursive: true });

const errors = [];
let failures = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAU = Math.PI * 2;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({
    viewport: { width: dev.width, height: dev.height },
    deviceScaleFactor: dev.dsf,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(800);

  const g = (fn, a) => page.evaluate(fn, a);
  const state = () => g(() => window.__game.state);
  const waitState = async (s, tries = 90) => {
    for (let i = 0; i < tries; i++) {
      if ((await state()) === s) return true;
      await sleep(220);
    }
    console.log(`  !! timeout waiting for state=${s} (now=${await state()})`);
    failures++;
    return false;
  };
  const tap = async (x, y) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await sleep(80);
    await page.mouse.up();
  };
  const drag = async (x1, y1, x2, y2, steps = 20) => {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await sleep(50);
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps);
      await sleep(12);
    }
    await sleep(50);
    await page.mouse.up();
  };
  const circle = async (cx, cy, r, turns) => {
    await page.mouse.move(cx + r, cy);
    await page.mouse.down();
    const steps = Math.round(30 * turns);
    for (let i = 1; i <= steps; i++) {
      const a = (i / 30) * TAU;
      await page.mouse.move(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      await sleep(10);
    }
    await page.mouse.up();
  };
  const startEp = async (ep) => {
    await waitState('title');
    await sleep(400);
    const b = await g((e) => window.__game.epButtons().find((x) => x.ep === e), ep);
    await tap(b.x, b.y);
  };
  const rideToFinale = async (label) => {
    await waitState('ready');
    await sleep(1200);
    const mb = await g(() => window.__game.mainButton());
    await tap(mb.x, mb.y);
    if (!(await waitState('drive', 40))) return;
    await sleep(2500);
    await page.screenshot({ path: `${SHOTS}/${devName}-ep-${label}-drive.png` });
    await waitState('finale', 120);
    console.log(`  ${label}: finale reached`);
    await sleep(1900);
    const rb = await g(() => window.__game.mainButton());
    await tap(rb.x, rb.y);
    await waitState('title', 30);
  };

  console.log(`\n=== episodes @ ${devName} (${dev.width}x${dev.height}) ===`);

  /* ---- ② ベル ---- */
  await startEp('bell');
  await waitState('belltap');
  await sleep(400);
  let bs = await g(() => { const G = window.__game; const b = G.bellPos(); return G.w2s(b.x, b.y); });
  await tap(bs.x, bs.y);
  await sleep(500);
  await tap(bs.x, bs.y);
  await page.screenshot({ path: `${SHOTS}/${devName}-ep-bell-tap.png` });
  await waitState('bellfit');
  await sleep(700);
  const part = await g(() => window.__game.patches[1]);
  bs = await g(() => { const G = window.__game; const b = G.bellPos(); return G.w2s(b.x, b.y); });
  await drag(part.x, part.y, bs.x + 40, bs.y - 35, 24); // わざとずらして吸着を確認
  const fitted = await g(() => (window.__game.bell.part ? window.__game.bell.part.type : null));
  console.log(`  bell: rough drop -> part=${fitted}`);
  if (!fitted) failures++;
  await page.screenshot({ path: `${SHOTS}/${devName}-ep-bell-fit.png` });
  await waitState('screw');
  await sleep(500);
  let sc = await g(() => window.__game.screwScreen());
  await circle(sc.x, sc.y, 62, 4);
  const turns = await g(() => window.__game.rotary.turns);
  console.log(`  bell: screw turns=${turns}`);
  if (turns < 3) failures++;
  await waitState('ringtest');
  await sleep(400);
  bs = await g(() => { const G = window.__game; const b = G.bellPos(); return G.w2s(b.x, b.y); });
  await tap(bs.x, bs.y);
  await sleep(700);
  await page.screenshot({ path: `${SHOTS}/${devName}-ep-bell-ring.png` });
  await tap(bs.x, bs.y);
  const rings = await g(() => window.__game.bell.rings);
  console.log(`  bell: rings=${rings}`);
  await rideToFinale('bell');

  /* ---- ③ ぐらぐらハンドル ---- */
  await startEp('bar');
  await waitState('bartouch');
  await sleep(400);
  const bp = await g(() => { const G = window.__game; const b = G.barPos(); return G.w2s(b.x, b.y); });
  await tap(bp.x, bp.y);
  await page.screenshot({ path: `${SHOTS}/${devName}-ep-bar-touch.png` });
  await waitState('tool');
  await sleep(700);
  let tool = await g(() => window.__game.toolItem);
  sc = await g(() => window.__game.screwScreen());
  await drag(tool.x, tool.y, sc.x + 34, sc.y + 28, 24);
  const placed = await g(() => window.__game.toolItem && window.__game.toolItem.mode);
  console.log(`  bar: wrench -> ${placed}`);
  await waitState('screw');
  await sleep(500);
  sc = await g(() => window.__game.screwScreen());
  await circle(sc.x, sc.y, 66, 4);
  const wob = await g(() => +window.__game.barWobble.toFixed(2));
  console.log(`  bar: turns=${await g(() => window.__game.rotary.turns)} wobble=${wob}`);
  if (wob > 0.05) failures++;
  await page.screenshot({ path: `${SHOTS}/${devName}-ep-bar-screw.png` });
  await rideToFinale('bar');

  /* ---- ④ きしみ→油さし ---- */
  await startEp('oil');
  await waitState('tool');
  await sleep(700);
  tool = await g(() => window.__game.toolItem);
  const hub = await g(() => { const G = window.__game; return G.w2s(G.axle.x, G.axle.y); });
  await drag(tool.x, tool.y, hub.x + 40, hub.y - 45, 24);
  await waitState('drip');
  await sleep(400);
  for (let i = 0; i < 3; i++) {
    const cs = await g(() => { const G = window.__game; const c = G.oilCanPos(); return G.w2s(c.x, c.y); });
    await tap(cs.x, cs.y);
    await sleep(800);
  }
  const drips = await g(() => window.__game.drips);
  const squeak = await g(() => +window.__game.squeak.toFixed(2));
  console.log(`  oil: drips=${drips} squeak=${squeak}`);
  if (drips < 3 || squeak > 0.05) failures++;
  await page.screenshot({ path: `${SHOTS}/${devName}-ep-oil-drip.png` });
  await waitState('spin');
  await sleep(400);
  const ax = await g(() => { const G = window.__game; return { ...G.w2s(G.axle.x, G.axle.y), r: G.wheel.r * G.cam.zoom }; });
  await drag(ax.x - ax.r * 0.7, ax.y - ax.r * 0.5, ax.x + ax.r * 0.7, ax.y - ax.r * 0.5, 6);
  await rideToFinale('oil');

  /* ---- ⑤ どろんこ→洗車 ---- */
  await startEp('wash');
  await waitState('scrub');
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}/${devName}-ep-wash-mud.png` });
  for (let round = 0; round < 7; round++) {
    const box = await g(() => {
      const G = window.__game;
      const a = G.w2s(G.trike.x - 80, -150);
      const b = G.w2s(G.trike.x + 140, -20);
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    });
    for (let row = 0; row < 4; row++) {
      const y = box.y1 + ((box.y2 - box.y1) * row) / 3;
      await drag(box.x1, y, box.x2, y, 14);
      if ((await state()) !== 'scrub') break;
    }
    const left = await g(() => window.__game.mud.filter((m) => m.hp > 0.02).length);
    if ((await state()) !== 'scrub' || left === 0) break;
  }
  console.log(`  wash: mud left=${await g(() => window.__game.mud.filter((m) => m.hp > 0.02).length)}`);
  await waitState('polish');
  await page.screenshot({ path: `${SHOTS}/${devName}-ep-wash-clean.png` });
  await sleep(500);
  for (let i = 0; i < 5; i++) {
    const c = await g(() => { const G = window.__game; return G.w2s(G.trike.x + 30, -90); });
    await drag(c.x - 120, c.y, c.x + 120, c.y + 12, 12);
    if ((await state()) !== 'polish') break;
  }
  console.log(`  wash: glints=${await g(() => window.__game.polishGlints)}`);
  await rideToFinale('wash');

  const done = await g(() => [...window.__game.completed]);
  console.log(`  completed: ${done.join(', ')}`);
  if (!(done.includes('bell') && done.includes('bar') && done.includes('oil') && done.includes('wash'))) failures++;
  await page.screenshot({ path: `${SHOTS}/${devName}-ep-title-stars.png` });

  console.log(`\nfailures: ${failures}  console errors: ${errors.length}`);
  errors.slice(0, 8).forEach((e) => console.log('  !! ' + e));
  await browser.close();
  process.exit(failures || errors.length ? 1 : 0);
})().catch((e) => {
  console.error('TEST CRASH', e);
  process.exit(2);
});
