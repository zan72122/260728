import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const page = await (await b.newContext({ viewport: { width: 844, height: 390 } })).newPage();
page.on('console', (m) => { if (m.text().startsWith('[retint]')) console.log(m.text()); });
await page.goto('http://127.0.0.1:4173/?pdb=1');
await page.waitForFunction(() => !!window.__game, null, { timeout: 20000 });
await page.mouse.click(422, 300);
await page.waitForTimeout(6000);
// sample the car roof pixel from the WebGL canvas
const px = await page.evaluate(() => {
  const c = document.getElementById('stage');
  const t = document.createElement('canvas');
  t.width = c.width; t.height = c.height;
  const ctx = t.getContext('2d');
  ctx.drawImage(c, 0, 0);
  const sx = Math.round(c.width * 0.42), sy = Math.round(c.height * 0.62);
  const d = ctx.getImageData(sx, sy, 1, 1).data;
  return { sx, sy, rgb: [d[0], d[1], d[2]] };
});
console.log('roof pixel:', JSON.stringify(px));
await b.close();
