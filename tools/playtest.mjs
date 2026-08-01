// 実機に近い条件でゲームを自動プレイして、進行とコンソールエラーを確かめる開発用スクリプト。
//   node tools/playtest.mjs [--url=...] [--device=iphone|iphone-land|ipad|ipad-land] [--shots=dir] [--fast]
import { createRequire } from 'module';
import { mkdirSync } from 'fs';

const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const flag = (k) => process.argv.includes(`--${k}`);

const URL = arg('url', 'http://127.0.0.1:8123/index.html');
const SHOTS = arg('shots', '/tmp/shots');
const DEVICES = {
  iphone: { width: 390, height: 844, dsf: 3 },
  'iphone-land': { width: 844, height: 390, dsf: 3 },
  ipad: { width: 820, height: 1180, dsf: 2 },
  'ipad-land': { width: 1180, height: 820, dsf: 2 },
  'iphone-se': { width: 375, height: 667, dsf: 2 },
};
const devName = arg('device', 'iphone');
const dev = DEVICES[devName] || DEVICES.iphone;

mkdirSync(SHOTS, { recursive: true });

const errors = [];
const logs = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({
    viewport: { width: dev.width, height: dev.height },
    deviceScaleFactor: dev.dsf,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    logs.push(`[${m.type()}] ${m.text()}`);
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

  await page.goto(URL, { waitUntil: 'load' });
  await sleep(900);

  const state = () => page.evaluate(() => window.__game.state);
  const info = () => page.evaluate(() => {
    const g = window.__game;
    const ax = g.axle;
    const as = g.w2s(ax.x, ax.y);
    const h = g.holePos();
    const hs = g.w2s(h.x, h.y);
    const u = g.ui();
    return {
      state: g.state,
      axle: as,
      hole: hs,
      wheelR: g.wheel.r * g.cam.zoom,
      inflation: +g.wheel.inflation.toFixed(3),
      strokes: g.pump.strokes,
      patch: g.wheel.patch ? g.wheel.patch.type : null,
      dents: g.wheel.dents.length,
      omega: +g.wheel.omega.toFixed(2),
      patches: g.patches.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), type: p.type, mode: p.mode })),
      pump: { x: g.pumpDrawX, y: g.pumpDrawY, h: u.pumpH },
      rough: +(g.roughShown || 0).toFixed(4),
      driveT: +g.driveT.toFixed(1),
      w: g.L.w, h: g.L.h,
    };
  });

  const shot = (name) => page.screenshot({ path: `${SHOTS}/${devName}-${name}.png` });
  const tap = async (x, y) => {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await sleep(70);
    await page.mouse.up();
  };
  const drag = async (x1, y1, x2, y2, steps = 22, hold = 40) => {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await sleep(hold);
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps);
      await sleep(12);
    }
    await sleep(hold);
    await page.mouse.up();
  };

  const step = async (label) => {
    const i = await info();
    console.log(`  ${label.padEnd(18)} state=${i.state} infl=${i.inflation} strokes=${i.strokes} patch=${i.patch} dents=${i.dents}`);
    return i;
  };

  console.log(`\n=== ${devName} (${dev.width}x${dev.height}) ===`);
  await step('loaded');
  await shot('01-title');

  // タイトル → イントロ
  await tap(dev.width / 2, dev.height - 100);
  await sleep(600);
  await shot('02-intro');
  // イントロが終わってタイヤいじりへ（ここでパンク状態のガタつきを測る）
  let roughFlat = 0;
  for (let i = 0; i < 100 && (await state()) !== 'touch'; i++) {
    roughFlat = Math.max(roughFlat, await page.evaluate(() => window.__game.rideRough || 0));
    await sleep(150);
  }
  await step('touch reached');
  console.log(`  ride roughness (punctured) = ${roughFlat.toFixed(4)}`);

  // タイヤを触る（へこみ＆空気漏れ）
  let i2 = await info();
  await page.mouse.move(i2.axle.x + i2.wheelR * 0.3, i2.axle.y - i2.wheelR * 0.2);
  await page.mouse.down();
  await sleep(500);
  await shot('03-dent');
  const dented = await page.evaluate(() => ({
    dents: window.__game.wheel.dents.length,
    depth: +(window.__game.wheel.dents[0]?.depth ?? 0).toFixed(3),
    fx: window.__game.fx.items.length,
  }));
  console.log('  dent while pressing:', JSON.stringify(dented));
  await page.mouse.up();

  for (let i = 0; i < 60 && (await state()) !== 'patch'; i++) await sleep(200);
  await step('patch reached');
  await sleep(700);
  await shot('04-tray');

  // パッチを「だいたい」の位置へドラッグ（穴から意図的にずらす）
  let i3 = await info();
  const src = i3.patches[1];
  const offX = 55;
  const offY = -50;
  await drag(src.x, src.y, i3.hole.x + offX, i3.hole.y + offY, 26);
  await sleep(400);
  const afterPatch = await page.evaluate(() => (window.__game.wheel.patch ? window.__game.wheel.patch.type : null));
  console.log(`  rough drag (+${offX},${offY}) -> patch=${afterPatch}`);
  await shot('05-patched');

  for (let i = 0; i < 60 && (await state()) !== 'pump'; i++) await sleep(200);
  await step('pump reached');
  await sleep(800);
  await shot('06-pump');

  // ポンプを3回
  const inflations = [];
  for (let k = 0; k < 3; k++) {
    const i4 = await info();
    const px = i4.pump.x;
    const topY = i4.pump.y - i4.pump.h * 0.98;
    await drag(px, topY, px, topY + i4.pump.h * 0.42, 14, 60);
    await sleep(450);
    const st = await page.evaluate(() => ({ s: window.__game.pump.strokes, inf: +window.__game.wheel.inflation.toFixed(3) }));
    inflations.push(st);
    console.log(`  pump ${k + 1}: strokes=${st.s} inflation=${st.inf}`);
    await shot(`07-pump${k + 1}`);
  }

  for (let i = 0; i < 60 && (await state()) !== 'spin'; i++) await sleep(200);
  await step('spin reached');

  // 車輪を指で弾く
  const i5 = await info();
  await drag(i5.axle.x - i5.wheelR * 0.7, i5.axle.y - i5.wheelR * 0.5,
    i5.axle.x + i5.wheelR * 0.7, i5.axle.y - i5.wheelR * 0.5, 6, 0);
  await sleep(200);
  const spun = await page.evaluate(() => +window.__game.wheel.omega.toFixed(2));
  console.log(`  flick -> omega=${spun}`);
  await shot('08-spin');

  for (let i = 0; i < 80 && (await state()) !== 'ready'; i++) await sleep(200);
  await step('ready reached');
  await sleep(900);
  await shot('09-ready');

  await tap(dev.width / 2, dev.height - 110);
  for (let i = 0; i < 60 && (await state()) !== 'drive'; i++) await sleep(150);
  if ((await state()) !== 'drive') console.log('  !! drive did not start');
  const driveStart = Date.now();
  await step('drive start');
  let roughFixed = 0;
  for (let i = 0; i < 26; i++) {
    roughFixed = Math.max(roughFixed, await page.evaluate(() => window.__game.rideRough || 0));
    await sleep(150);
  }
  await step('drive mid');
  await shot('10-drive');
  console.log(`  ride roughness (repaired)  = ${roughFixed.toFixed(4)}  (punctured was ${roughFlat.toFixed(4)})`);

  for (let i = 0; i < 200 && (await state()) !== 'finale'; i++) await sleep(250);
  const driveSec = ((Date.now() - driveStart) / 1000).toFixed(1);
  await step('finale reached');
  console.log(`  test drive duration ~= ${driveSec}s`);
  await sleep(1800);
  await shot('11-finale');

  // リプレイ
  const rb = await page.evaluate(() => window.__game.mainButton());
  await tap(rb.x, rb.y);
  await sleep(600);
  await step('after replay');
  await shot('12-replay');

  console.log(`\nconsole errors: ${errors.length}`);
  errors.forEach((e) => console.log('  !! ' + e));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => {
  console.error('TEST CRASH', e);
  process.exit(2);
});
