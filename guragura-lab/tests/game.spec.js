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
  await expect(page.getByTestId('strength-chips')).toBeVisible();
  const box = await page.getByTestId('main-button').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  expect(box.width).toBeGreaterThanOrEqual(80);
  const chips = await page.getByTestId('strength-chips').boundingBox();
  expect(chips.x).toBeGreaterThanOrEqual(0);
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'playA');
});

test('部屋切り替え：矢印で4部屋を一周できる', async ({ page }) => {
  await boot(page);
  const rooms = [];
  for (let i = 0; i < 4; i++) {
    rooms.push(await page.evaluate(() => window.__lab.getRoom()));
    await page.getByTestId('room-next').click();
    await page.waitForTimeout(1400);
  }
  expect(rooms).toEqual(['kids', 'bedroom', 'living', 'kitchen']);
  expect(await page.evaluate(() => window.__lab.getRoom())).toBe('kids');
  // 各部屋でくまは開始位置に置かれ、配置フェーズに戻る
  expect(await page.evaluate(() => window.__lab.getPhase())).toBe('placeA');
});

test('強さ選択：チップで切り替わり・別の記録になる・B配置中はロック', async ({ page }) => {
  await boot(page);
  await page.getByTestId('strength-0').click();
  expect(await page.evaluate(() => window.__lab.getStrength())).toBe(0);
  const recWeak = await page.evaluate(() => window.__lab.getRecording());
  await page.getByTestId('strength-2').click();
  expect(await page.evaluate(() => window.__lab.getStrength())).toBe(2);
  const recStrong = await page.evaluate(() => window.__lab.getRecording());
  expect(recWeak.strength).toBe(0);
  expect(recStrong.strength).toBe(2);
  // 強い揺れの方が多くの物が床に落ちる
  expect(Object.keys(recStrong.landings).length).toBeGreaterThanOrEqual(
    Object.keys(recWeak.landings).length,
  );

  // A実行→巻き戻し→B配置では強さがロックされる
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'playA');
  await fastForwardPlay(page, 'resultA');
  await page.getByTestId('main-button').click();
  await page.evaluate(() => window.__lab.skipToEnd());
  await waitPhase(page, 'placeB');
  await page.evaluate(() => window.__lab.setStrength(1));
  expect(await page.evaluate(() => window.__lab.getStrength())).toBe(2); // 変わらない
});

test('寝室：タンスの前は危険・ベッドの上は布団で安全', async ({ page }) => {
  await boot(page);
  await page.getByTestId('room-next').click();
  await page.waitForTimeout(1400);
  expect(await page.evaluate(() => window.__lab.getRoom())).toBe('bedroom');
  await page.getByTestId('strength-2').click();

  // A: タンスの前（転倒の直撃コース）
  await page.evaluate(() => window.__lab.setBear(0.62, -1.35));
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'playA');
  expect(await page.evaluate(() => window.__lab.getDangerCount())).toBeGreaterThan(0);
  await fastForwardPlay(page, 'resultA');
  await page.getByTestId('main-button').click();
  await page.evaluate(() => window.__lab.skipToEnd());
  await waitPhase(page, 'placeB');

  // B: ベッドの上（布団がかかる）
  await page.evaluate(() => window.__lab.setBear(-1.5, 0.4));
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'playB');
  expect(await page.evaluate(() => window.__lab.getDangerCount())).toBe(0);
  await fastForwardPlay(page, 'compare');
  expect(await page.evaluate(() => window.__lab.getResults())).toEqual({
    a: 'danger',
    b: 'futon',
  });
});

test('リビング：金具なしで棚が倒れて危険・同じ場所でも金具ありなら安全', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__lab.switchRoom(1));
  await page.waitForTimeout(1400);
  await page.evaluate(() => window.__lab.switchRoom(1));
  await page.waitForTimeout(1400);
  expect(await page.evaluate(() => window.__lab.getRoom())).toBe('living');
  await page.getByTestId('strength-2').click();

  // A: 飾り棚の倒れ先（金具なし）
  await page.evaluate(() => window.__lab.setBear(-1.0, -0.9));
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'playA');
  const recA = await page.evaluate(() => window.__lab.getRecording());
  expect(recA.tipEvents.length).toBeGreaterThan(0); // 棚が倒れる
  expect(await page.evaluate(() => window.__lab.getDangerCount())).toBeGreaterThan(0);
  await fastForwardPlay(page, 'resultA');
  await page.getByTestId('main-button').click();
  await page.evaluate(() => window.__lab.skipToEnd());
  await waitPhase(page, 'placeB');

  // B: くまは同じ場所のまま、金具だけON
  await page.evaluate(() => window.__lab.toggleAnchor('cabinet'));
  expect(await page.evaluate(() => window.__lab.getAnchors())).toEqual(['cabinet']);
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'playB');
  const recB = await page.evaluate(() => window.__lab.getRecording());
  expect(recB.tipEvents.length).toBe(0); // 金具で倒れない
  expect(await page.evaluate(() => window.__lab.getDangerCount())).toBe(0);
  await fastForwardPlay(page, 'compare');
  expect(await page.evaluate(() => window.__lab.getResults())).toEqual({
    a: 'danger',
    b: 'safe',
  });
});

test('キッチン：食器棚の前は危険・テーブルの下は安全', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__lab.switchRoom(-1));
  await page.waitForTimeout(1400);
  expect(await page.evaluate(() => window.__lab.getRoom())).toBe('kitchen');

  // A: 食器棚の前（お皿の雨）
  await page.evaluate(() => window.__lab.setBear(-1.05, -1.45));
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'playA');
  expect(await page.evaluate(() => window.__lab.getDangerCount())).toBeGreaterThan(0);
  await fastForwardPlay(page, 'resultA');
  await page.getByTestId('main-button').click();
  await page.evaluate(() => window.__lab.skipToEnd());
  await waitPhase(page, 'placeB');

  // B: テーブルの下
  await page.evaluate(() => window.__lab.setBear(0.72, -0.18));
  await page.getByTestId('main-button').click();
  await waitPhase(page, 'playB');
  expect(await page.evaluate(() => window.__lab.getDangerCount())).toBe(0);
  await fastForwardPlay(page, 'compare');
  expect(await page.evaluate(() => window.__lab.getResults())).toEqual({
    a: 'danger',
    b: 'shield',
  });
});
