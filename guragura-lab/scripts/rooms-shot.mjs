// 全部屋のスクリーンショットを順に撮る（開発用）
import { chromium } from '@playwright/test';
const SS = '/tmp/claude-0/-home-user-260728/46da094a-a8c8-59cf-a0a2-35fc46c4371f/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__lab?.getPhase?.() === 'placeA');
for (const room of ['kids', 'bedroom', 'living', 'kitchen']) {
  if (room !== 'kids') {
    await page.evaluate(() => window.__lab.switchRoom(1));
    await page.waitForTimeout(1400);
  }
  console.log('room:', await page.evaluate(() => window.__lab.getRoom()));
  await page.screenshot({ path: `${SS}/v2-${room}.png` });
}
await browser.close();
