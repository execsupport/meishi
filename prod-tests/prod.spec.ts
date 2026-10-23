import { expect, test } from '@playwright/test'

test('a signed-out visitor reaches the app: skeleton, focused memo box, login entry, no errors', async ({ page }, info) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  const res = await page.goto('/', { waitUntil: 'commit' })
  expect(res?.status()).toBe(200)
  await expect(page.locator('#memo')).toBeFocused()
  await expect(page.locator('[data-skeleton]')).toHaveCount(0)
  await expect(page.locator('.toolbar')).toBeVisible()
  await page.keyboard.type('本番メモ')
  await page.keyboard.press('Enter')
  await expect(page.locator('.row', { hasText: '本番メモ' })).toBeVisible()
  await expect(page.locator('.login-btn')).toHaveText('Googleでログイン')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  await page.waitForTimeout(700)
  await page.screenshot({ path: `test-results/prod/${info.project.name}.png` })
  // No OAuth client configured yet: a plain inline notice, no navigation away.
  await page.locator('.login-btn').click()
  await expect(page.locator('.notice')).toHaveText('Googleログインは未設定です')
  expect(errors).toEqual([])
})

test('production API answers: 401 for /api/me, 404 for the test login, 503 until Google is configured', async ({ request }) => {
  const me = await request.get('/api/me')
  expect(me.status()).toBe(401)
  expect(await me.json()).toEqual({ error: 'unauthorized' })
  expect((await request.get('/auth/dev', { maxRedirects: 0 })).status()).toBe(404)
  const g = await request.get('/auth/google', { maxRedirects: 0 })
  if (!(await (await request.get('/auth/status')).json()).google) {
    expect(g.status()).toBe(503)
    expect(await g.json()).toEqual({ error: 'google_not_configured' })
  } else expect(g.status()).toBe(302)
})
