import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const page = await (await b.newContext({ viewport: { width: 844, height: 390 } })).newPage();
await page.goto('http://127.0.0.1:4173/');
await page.waitForFunction(() => !!window.__game, null, { timeout: 20000 });
const out = await page.evaluate(() => {
  const view = window.__view;
  const res = [];
  view.car.root.traverse((o) => {
    if (o.isMesh && o.material && o.material.map && (o.name === 'body' || o.parent?.name === 'body') && res.length < 1) {
      const img = o.material.map.image;
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const colors = new Map();
      for (let i = 0; i < d.length; i += 16) {
        const key = `${d[i]},${d[i+1]},${d[i+2]}`;
        colors.set(key, (colors.get(key) ?? 0) + 1);
      }
      const top = [...colors.entries()].sort((a, z) => z[1] - a[1]).slice(0, 12);
      res.push({ mesh: o.name || o.parent?.name, isCanvasTex: o.material.map.isCanvasTexture === true, flipY: o.material.map.flipY, top });
    }
  });
  return res;
});
console.log(JSON.stringify(out, null, 1));
await b.close();
