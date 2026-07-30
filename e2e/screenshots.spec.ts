// ?test=1 の決定的フック(window.__sim)でシミュレーションを検証し、
// iPhone 相当のビューポートでスクリーンショットを取得する。

import { test, expect, Page } from '@playwright/test'

interface SimState {
  waterLevel: number
  inflowRate: number
  doorAngle: number
  charState: string
  charPos: { x: number; y: number; z: number }
  time: number
}

declare global {
  interface Window {
    __sim: {
      step: (n: number) => void
      setDoorOmega: (omega: number, seconds: number) => void
      setMove: (x: number, y: number) => void
      reset: () => void
      setQuality: (hi: boolean) => void
      roomCoverage: () => number
      knobScreen: () => { x: number; y: number }
      state: () => SimState
    }
  }
}

async function boot(page: Page): Promise<void> {
  await page.goto('/?test=1')
  await page.waitForFunction(() => !!window.__sim, undefined, { timeout: 30_000 })
}

const state = (page: Page) => page.evaluate(() => window.__sim.state())

test.describe('浸水シミュレーション', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('ゆっくり開ける → 緩やかな流入', async ({ page }) => {
    await boot(page)
    // 0.35 rad/s で 1 秒(約 20° = シール角は超えるが控えめ)
    await page.evaluate(() => {
      window.__sim.setDoorOmega(0.35, 1.0)
      window.__sim.step(60)
    })
    const s1 = await state(page)
    expect(s1.doorAngle).toBeGreaterThan(0.05)
    // 手を離して 5 秒経過
    await page.evaluate(() => window.__sim.step(300))
    const s2 = await state(page)
    expect(s2.waterLevel).toBeGreaterThan(0.02)
    await page.screenshot({ path: 'e2e/out/slow-open-portrait.png' })
  })

  test('勢いよく開ける → 水圧バーストで大きく開き激流', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      window.__sim.setDoorOmega(4.5, 0.6)
      window.__sim.step(36)
    })
    const s1 = await state(page)
    // 水圧に押されて大きく開く
    await page.evaluate(() => window.__sim.step(120))
    const s2 = await state(page)
    expect(s2.doorAngle).toBeGreaterThan(1.2)
    expect(s2.waterLevel).toBeGreaterThan(0.15)
    await page.screenshot({ path: 'e2e/out/burst-open.png' })
  })

  test('少し開けて放置しても水圧で押し開けられる', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      window.__sim.setDoorOmega(0.6, 0.5) // 約 17° まで開けて手を離す
      window.__sim.step(30)
      window.__sim.step(240)
    })
    const s = await state(page)
    expect(s.doorAngle).toBeGreaterThan(0.6)
  })

  test('満水まで進むと天井空気層で泳ぐ(AIR_POCKET)', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      window.__sim.setDoorOmega(4.5, 0.8)
      window.__sim.step(60)
    })
    // 十分な時間経過(全開の激流なら数十秒で満水)
    await page.evaluate(() => window.__sim.step(2400))
    const s = await state(page)
    expect(s.waterLevel).toBeGreaterThan(2.0)
    expect(s.charState).toBe('AIR_POCKET')
    // 主人公は天井付近に浮いている
    expect(s.charPos.y).toBeGreaterThan(1.2)
    await page.screenshot({ path: 'e2e/out/air-pocket.png' })
  })

  test('歩行 → 徒渉 → 泳ぎの状態遷移', async ({ page }) => {
    await boot(page)
    const s0 = await state(page)
    expect(s0.charState).toBe('WALK')
    await page.evaluate(() => {
      window.__sim.setDoorOmega(4.5, 0.8)
      window.__sim.step(300) // 水位上昇
    })
    const s1 = await state(page)
    expect(['WADE', 'SWIM']).toContain(s1.charState)
    await page.evaluate(() => window.__sim.step(600))
    const s2 = await state(page)
    expect(['SWIM', 'AIR_POCKET']).toContain(s2.charState)
    await page.screenshot({ path: 'e2e/out/swimming.png' })
  })

  test('移動入力で主人公が歩く', async ({ page }) => {
    await boot(page)
    const s0 = await state(page)
    await page.evaluate(() => {
      window.__sim.setMove(0, 1)
      window.__sim.step(120)
      window.__sim.setMove(0, 0)
    })
    const s1 = await state(page)
    const moved = Math.hypot(s1.charPos.x - s0.charPos.x, s1.charPos.z - s0.charPos.z)
    expect(moved).toBeGreaterThan(0.5)
  })

  test('ノブのスワイプ(実ポインタ操作)でドアが開く', async ({ page }) => {
    await boot(page)
    const knob = await page.evaluate(() => window.__sim.knobScreen())
    await page.mouse.move(knob.x, knob.y)
    await page.mouse.down()
    // ヒンジ周りに指を回す(開く方向へ)+ その間シミュレーションを進める
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(knob.x + i * 6, knob.y + i * 14)
      await page.evaluate(() => window.__sim.step(6))
    }
    await page.mouse.up()
    const s = await state(page)
    expect(s.doorAngle).toBeGreaterThan(0.08)
  })

  test('構図: 縦画面で部屋が画面を満たす', async ({ page }) => {
    await boot(page)
    await page.waitForTimeout(1200) // カメラのスムージング収束待ち
    const cov = await page.evaluate(() => window.__sim.roomCoverage())
    expect(cov).toBeGreaterThan(0.8)
  })

  test('品質トグルで両レンダリング経路が生存する', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      window.__sim.setQuality(false)
      window.__sim.step(30)
    })
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'e2e/out/quality-low.png' })
    const s1 = await state(page)
    expect(s1.time).toBeGreaterThan(0)
    await page.evaluate(() => {
      window.__sim.setQuality(true)
      window.__sim.step(30)
    })
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'e2e/out/quality-high.png' })
    const s2 = await state(page)
    expect(s2.time).toBeGreaterThan(s1.time - 0.001)
  })

  test('リセットで初期状態に戻る', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      window.__sim.setDoorOmega(4.5, 0.8)
      window.__sim.step(600)
      window.__sim.reset()
      window.__sim.step(10)
    })
    const s = await state(page)
    expect(s.waterLevel).toBeLessThan(0.01)
    expect(s.doorAngle).toBeLessThan(0.05)
    expect(s.charState).toBe('WALK')
  })
})

test.describe('横画面', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true })

  test('横画面スクリーンショット', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      window.__sim.setDoorOmega(2.5, 0.8)
      window.__sim.step(420)
    })
    await page.screenshot({ path: 'e2e/out/landscape-flood.png' })
  })

  test('構図: 横画面で部屋が画面を満たす', async ({ page }) => {
    await boot(page)
    await page.waitForTimeout(1200)
    const cov = await page.evaluate(() => window.__sim.roomCoverage())
    expect(cov).toBeGreaterThan(0.8)
  })
})
