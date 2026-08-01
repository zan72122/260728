// クイック目視確認用：起動→スクショ→コンソールエラー収集
import { chromium } from '@playwright/test';

const [, , w = '1180', h = '820', name = 'landscape', extra = ''] = process.argv;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
if (extra === 'quake') {
  await page.evaluate(() => window.__lab.pressMain());
  await page.waitForTimeout(3300);
}
await page.screenshot({ path: `/tmp/claude-0/-home-user-260728/46da094a-a8c8-59cf-a0a2-35fc46c4371f/scratchpad/${name}.png` });
console.log('phase:', await page.evaluate(() => window.__lab?.getPhase?.() ?? 'no __lab'));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
