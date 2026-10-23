import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import path from 'node:path'

export const fixture = (name: string) => path.join(import.meta.dirname, 'fixtures', name)

export const uniqueEmail = (info: TestInfo) =>
  `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}-${info.project.name}@example.test`

export async function devLogin(page: Page, info: TestInfo) {
  const email = uniqueEmail(info)
  await page.goto(`/auth/dev?email=${encodeURIComponent(email)}`)
  await expect(page.locator('.avatar')).toBeVisible()
  return email
}

export async function ready(page: Page) {
  await expect(page.locator('[data-skeleton]')).toHaveCount(0)
  await expect(page.locator('.toolbar')).toBeVisible()
}

export async function addMemo(page: Page, text: string) {
  const memo = page.locator('#memo')
  await memo.click()
  await memo.fill(text)
  await memo.press('Enter')
  await expect(page.locator('.row .title', { hasText: text.split('\n')[0] }).first()).toBeVisible()
  await expect(memo).toHaveValue('')
}

export const row = (page: Page, text: string) => page.locator('.row', { hasText: text })
export const card = (page: Page, text: string) => row(page, text).locator('.card')
export const count = (page: Page, status: 'inbox' | 'follow' | 'done' | 'archived') => page.locator(`.tab[data-status="${status}"] .count`)
export const tab = (page: Page, status: 'inbox' | 'follow' | 'done' | 'archived') => page.locator(`.tab[data-status="${status}"]`)

/**
 * Horizontal flick. Mobile Chromium uses real touch events through CDP (so touch-action
 * and pointer capture are exercised); other projects drag with the mouse.
 */
export async function flick(page: Page, target: Locator, dx: number, opts: { steps?: number; info: TestInfo }) {
  const box = (await target.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const steps = opts.steps ?? 10
  if (opts.info.project.name === 'mobile-chromium') {
    const cdp = await page.context().newCDPSession(page)
    const touch = (type: string, px: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: px, y, id: 1 }] })
    await touch('touchStart', x)
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', x + (dx * i) / steps)
      await page.waitForTimeout(16)
    }
    await touch('touchEnd', x + dx)
    await cdp.detach()
  } else {
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x + (dx * i) / steps, y)
      await page.waitForTimeout(16)
    }
    await page.mouse.up()
  }
}

/** Press and hold without moving: touch via CDP on mobile Chromium, mouse elsewhere. */
export async function longPress(page: Page, target: Locator, info: TestInfo) {
  const box = (await target.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  if (info.project.name === 'mobile-chromium') {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
    await page.waitForTimeout(700)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
  } else {
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.waitForTimeout(700)
    await page.mouse.up()
  }
}

export type ServerCard = { id: string; name: string; company: string; email: string; memo: string; status: string; imageKey: string | null }

export async function serverCards(page: Page) {
  const res = await page.request.get('/api/cards')
  expect(res.status()).toBe(200)
  return (await res.json()) as ServerCard[]
}

export async function scanFiles(page: Page, files: string[]) {
  await page.locator('#scan-input').setInputFiles(files.map(fixture))
  await expect(page.locator('.sheet[aria-label="スキャン"]')).toBeVisible()
}

/** Collect console errors and uncaught exceptions for the whole test. */
export function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  return errors
}
