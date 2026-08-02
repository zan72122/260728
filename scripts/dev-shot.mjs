import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const errs = [];
const page = await (await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto('http://127.0.0.1:4173/');
await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 }).catch(() => errs.push('no __game'));
await page.waitForTimeout(1200);
await page.screenshot({ path: 'shots/dev-title-land.png' });
// tap start -> garage
await page.mouse.click(422, 300);
await page.waitForTimeout(3500);
await page.screenshot({ path: 'shots/dev-garage-land.png' });
if (errs.length) console.log(errs.join('\n'));
else console.log('no errors');
await b.close();
