// 遊びの流れ以外の「壊れやすいところ」を確かめる検証スクリプト。
//   ・2本目の指を無視できているか
//   ・遊んでいる途中で画面を回しても壊れないか
//   ・音のオン/オフが効くか
//   ・長時間まわしてもエラーが出ないか
import { createRequire } from 'module';

const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');

const URL = process.argv.find((a) => a.startsWith('--url='))?.split('=')[1]
  || 'http://127.0.0.1:8123/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
let failures = 0;

const check = (label, ok, extra = '') => {
  console.log(`  ${ok ? 'OK  ' : 'NG  '} ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(800);

  const g = (fn) => page.evaluate(fn);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p) => ({ x: p[0], y: p[1], id: p[2] })),
  });

  console.log('\n=== 壊れにくさの確認 ===');

  // ---- 本物のタッチイベントで始められるか
  await touch('touchStart', [[195, 740, 1]]);
  await touch('touchEnd', []);
  await sleep(400);
  check('タッチで開始できる', (await g(() => window.__game.state)) !== 'title');

  // タイヤいじりの場面まで待つ
  for (let i = 0; i < 60 && (await g(() => window.__game.state)) !== 'touch'; i++) await sleep(200);
  check('パンク発見の場面に到達', (await g(() => window.__game.state)) === 'touch');

  // ---- 2本目の指は無視されるか
  const pos = await g(() => {
    const gg = window.__game;
    const a = gg.w2s(gg.axle.x, gg.axle.y);
    return { x: a.x, y: a.y, r: gg.wheel.r * gg.cam.zoom };
  });
  await touch('touchStart', [[pos.x, pos.y - pos.r * 0.3, 1]]);
  await sleep(120);
  // 2本目を別の場所に置く（音ボタンの上）
  await touch('touchStart', [[pos.x, pos.y - pos.r * 0.3, 1], [40, 60, 2]]);
  await sleep(220);
  const two = await g(() => ({ dents: window.__game.wheel.dents.length, muted: window.__game.muted }));
  await touch('touchEnd', []);
  check('2本目の指でへこみが増えない', two.dents === 1, `dents=${two.dents}`);
  check('2本目の指で音ボタンが誤作動しない', two.muted === false);

  // ---- 音のオン/オフ
  const mute = await g(() => {
    const u = window.__game.ui();
    return { x: u.muteX, y: u.muteY };
  });
  await touch('touchStart', [[mute.x, mute.y, 5]]);
  await touch('touchEnd', []);
  await sleep(150);
  check('音ボタンで消音できる', (await g(() => window.__game.muted)) === true);
  await touch('touchStart', [[mute.x, mute.y, 6]]);
  await touch('touchEnd', []);
  await sleep(150);
  check('音ボタンで戻せる', (await g(() => window.__game.muted)) === false);

  // ---- 遊んでいる途中の画面回転
  const sizes = [[844, 390], [390, 844], [1180, 820], [820, 1180], [390, 844]];
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(320);
    const st = await g(() => {
      const gg = window.__game;
      const u = gg.ui();
      return {
        state: gg.state,
        zoom: gg.cam.zoom,
        w: gg.L.w,
        h: gg.L.h,
        dockIn: gg.dock ? 1 : gg.dockIn,
        muteInside: u.muteX > 0 && u.muteX < gg.L.w && u.muteY > 0 && u.muteY < gg.L.h,
        finite: Number.isFinite(gg.cam.zoom) && Number.isFinite(gg.cam.cx) && Number.isFinite(gg.cam.cy),
      };
    });
    check(`回転 ${w}x${h}`, st.finite && st.zoom > 0.05 && st.muteInside && st.w === w && st.h === h,
      `state=${st.state} zoom=${st.zoom.toFixed(2)}`);
  }

  // ---- そのまま放っておいても進行が壊れないか（お手本の手が出る）
  await sleep(2600);
  check('放置してもお手本が出て進行が止まらない', (await g(() => window.__game.hint)) > 1.6);

  // ---- 一気に最後まで進めて長時間まわす
  await page.evaluate(async () => {
    const gg = window.__game;
    gg.wheel.patch = { type: 'heart', color: '#FF8FA3', a: gg.wheel.hole.a, scale: 1, t: 1, grip: 1 };
    gg.pump.strokes = 3;
    gg.go('spin');
    gg.flicked = true;
    gg.wheel.omega = 8;
  });
  await sleep(3500);
  check('回転チェックから出発準備へ', ['ready', 'drive'].includes(await g(() => window.__game.state)));
  await page.evaluate(() => { if (window.__game.state === 'ready') window.__game.startDrive(); });
  await sleep(19000);
  check('試運転が終わってゴールへ', (await g(() => window.__game.state)) === 'finale');

  console.log(`\nconsole errors: ${errors.length}`);
  errors.forEach((e) => console.log('  !! ' + e));
  await browser.close();
  process.exit(failures || errors.length ? 1 : 0);
})().catch((e) => {
  console.error('CHECK CRASH', e);
  process.exit(2);
});
