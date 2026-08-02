import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5 })).newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto('http://127.0.0.1:4173/');
await page.waitForFunction(() => !!window.__game, null, { timeout: 20000 });
await page.evaluate(() => {
  const g = window.__game.game;
  g.resetCar(0, true);
  g.setPhase('garage');
});
await page.waitForTimeout(1500);
const d = await page.evaluate(() => window.__game.debug());
console.log('phase', d.phase, 'freePlay', d.freePlay, 'plate target', JSON.stringify(d.targets.plate));
await page.screenshot({ path: 'shots/free-dbg-1.png' });
// tap plate
await page.mouse.move(d.targets.plate.x, d.targets.plate.y);
await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
await page.waitForTimeout(1200);
const d2 = await page.evaluate(() => window.__game.debug());
console.log('after tap phase:', d2.phase);
await page.screenshot({ path: 'shots/free-dbg-2.png' });
await b.close();
