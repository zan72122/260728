import { test, expect } from '@playwright/test';

/**
 * ぐらぐらラボ 総合テスト。
 * ヘッドレス環境は描画が遅いため、再生の早送りに __lab.skipToEnd() を使う。
 * （skipToEnd はフレームを飛ばすだけで、物理記録そのものは変わらない）
 */

async function boot(page, viewport = { width: 900, height: 620 }) {
  await page.setViewportSize(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__lab?.getPhase?.() === 'placeA');
  return errors;
}

async function waitPhase(page, phase, timeout = 90_000) {
  await page.waitForFunction((p) => window.__lab.getPhase() === p, phase, { timeout });
}

/** 再生フェーズを早送りして終わらせる */
async function fastForwardPlay(page, endPhase) {
  await page.evaluate(() => window.__lab.skipToEnd());
  await waitPhase(page, endPhase);
}

test('起動：エラーなく子ども部屋が表示される', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.getByTestId('main-button')).toBeVisible();
  expect(await page.evaluate(() => window.__lab.getPhase())).toBe('placeA');
  expect(errors).toEqual([]);
});

test('くまを実ポインタ操作でドラッグできる', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => window.__lab.getBear());
  const from = await page.evaluate(() => window.__lab.bearScreenPos());
  const to = await page.evaluate(() => window.__lab.worldToScreen(1.4, 0.2, 0.9));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  const after = await page.evaluate(() => window.__lab.getBear());
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  expect(moved).toBeGreaterThan(0.5);
});

test('一連のフロー：A（危険）→巻き戻し→B（机の下＝安全）→比較', async ({ page }) => {
  await boot(page);

  // A: 本の落下地点のそばに置く
  await page.evaluate(() => window.__lab.setBear(-0.5, -1.5));
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'playA');
  expect(await page.evaluate(() => window.__lab.getDangerCount())).toBeGreaterThan(0);
  await fastForwardPlay(page, 'resultA');

  // 結果バッジ（注意）が出る
  await expect(page.getByTestId('result-badge')).toHaveAttribute('data-kind', 'danger');

  // 巻き戻し
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'placeB');

  // ゴースト（Aの着地リング）が残っている
  expect(await page.evaluate(() => window.__lab.game.effects.ghostMarkers.length)).toBeGreaterThan(0);

  // B: 机の下へ
  await page.evaluate(() => window.__lab.setBear(-1.12, -1.36));
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'playB');
  expect(await page.evaluate(() => window.__lab.getDangerCount())).toBe(0);
  await fastForwardPlay(page, 'compare');

  // 比較パネル：A=危険, B=机の下で安全
  await expect(page.getByTestId('compare-a')).toHaveAttribute('data-kind', 'danger');
  await expect(page.getByTestId('compare-b')).toHaveAttribute('data-kind', 'shield');
  const results = await page.evaluate(() => window.__lab.getResults());
  expect(results).toEqual({ a: 'danger', b: 'shield' });

  // もう一回 → 最初に戻る
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'placeA');
});

test('決定論：AとBで全オブジェクトの最終位置が一致する', async ({ page }) => {
  await boot(page);

  await page.evaluate(() => window.__lab.setBear(1.5, 1.4));
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'playA');
  await fastForwardPlay(page, 'resultA');
  const endA = await page.evaluate(() => window.__lab.getObjectPositions());

  await page.getByTestId('main-button').click(); // 巻き戻し
  await page.evaluate(() => window.__lab.skipToEnd()); // 巻き戻しも早送り
  await waitPhase(page, 'placeB');

  await page.evaluate(() => window.__lab.setBear(-1.12, -1.36));
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'playB');
  await fastForwardPlay(page, 'compare');
  const endB = await page.evaluate(() => window.__lab.getObjectPositions());

  for (const id of Object.keys(endA)) {
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(endA[id][i] - endB[id][i])).toBeLessThan(1e-9);
    }
  }
});

test('巻き戻しで全オブジェクトが初期位置に戻る', async ({ page }) => {
  await boot(page);
  const initial = await page.evaluate(() => window.__lab.getObjectPositions());
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'playA');
  await fastForwardPlay(page, 'resultA');
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'placeB');
  const restored = await page.evaluate(() => window.__lab.getObjectPositions());
  for (const id of Object.keys(initial)) {
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(initial[id][i] - restored[id][i])).toBeLessThan(1e-6);
    }
  }
});

test('メニュー：サイコロで別の揺れに切り替わる・おうちでリセット', async ({ page }) => {
  await boot(page);
  const seed0 = await page.evaluate(() => window.__lab.getSeed());
  await page.getByTestId('menu-button').click();
  await page.getByTestId('dice-button').click();
  const seed1 = await page.evaluate(() => window.__lab.getSeed());
  expect(seed1).not.toBe(seed0);

  await page.evaluate(() => window.__lab.setBear(0, 0.5));
  await page.getByTestId('menu-button').click();
  await page.getByTestId('home-button').click();
  const bear = await page.evaluate(() => window.__lab.getBear());
  expect(Math.abs(bear.x - 0.62)).toBeLessThan(0.01);
  expect(await page.evaluate(() => window.__lab.getPhase())).toBe('placeA');
});

test('縦画面（iPhone）でもUIが収まり操作できる', async ({ page }) => {
  await boot(page, { width: 390, height: 844 });
  await expect(page.getByTestId('main-button')).toBeVisible();
  await expect(page.getByTestId('mute-button')).toBeVisible();
  const box = await page.getByTestId('main-button').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  expect(box.width).toBeGreaterThanOrEqual(80);
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'playA');
});
