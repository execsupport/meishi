import { expect, test } from '@playwright/test'
import { addMemo, ready, row, watchErrors } from './helpers'

// Signed-out flows (no test login needed).

test('memo box is focused and typeable on first paint, before the app bundle loads', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  await page.route('**/assets/*.js', async (route) => {
    await gate
    await route.continue()
  })
  await page.goto('/', { waitUntil: 'commit' })
  const memo = page.locator('#memo')
  await expect(memo).toBeVisible()
  await expect(page.locator('html')).not.toHaveClass(/mounted/)
  await expect(memo).toBeFocused()
  await page.keyboard.type('すぐ書ける')
  await expect(memo).toHaveValue('すぐ書ける')
  await expect(page.locator('html')).not.toHaveClass(/mounted/)
  release()
  await expect(page.locator('html')).toHaveClass(/mounted/)
  // The draft typed before mount survives the hand-off to the app.
  await expect(memo).toHaveValue('すぐ書ける')
})

test('full-screen skeleton is shown while loading, then replaced by content', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  await page.route('**/assets/*.js', async (route) => {
    await gate
    await route.continue()
  })
  await page.goto('/', { waitUntil: 'commit' })
  const sk = page.locator('[data-skeleton]')
  await expect(sk).toBeVisible()
  await expect(page.locator('.sk-card').first()).toBeVisible()
  const covered = await sk.evaluate((el) => el.getBoundingClientRect().bottom / innerHeight)
  expect(covered).toBeGreaterThan(0.9)
  await expect(page.locator('.hdr-slot .sk-avatar')).toBeVisible()
  // The memo box stays live during loading.
  await page.locator('#memo').fill('ロード中のメモ')
  release()
  await ready(page)
  await expect(sk).toHaveCount(0)
  await expect(page.locator('#memo')).toHaveValue('ロード中のメモ')
})

test('signed out: memo is kept on this device and the Google sign-in button is shown', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  await expect(page.locator('.login-btn')).toHaveText('Googleでログイン')
  await expect(page.locator('.login-btn')).toHaveAttribute('href', '/auth/google')
  await addMemo(page, '端末メモ')
  await expect(row(page, '端末メモ').locator('.pending')).toBeVisible()
  await page.reload()
  await ready(page)
  await expect(row(page, '端末メモ')).toBeVisible()
})

test('Google sign-in redirect is a well-formed Authorization Code + PKCE request', async ({ page, baseURL }) => {
  const res = await page.request.get('/auth/google', { maxRedirects: 0 })
  expect(res.status()).toBe(302)
  const loc = new URL(res.headers()['location'])
  expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
  const p = loc.searchParams
  expect(p.get('client_id')).toMatch(/\.apps\.googleusercontent\.com$/)
  expect(p.get('redirect_uri')).toBe(new URL('/auth/google/callback', baseURL).toString())
  expect(p.get('response_type')).toBe('code')
  expect(p.get('scope')).toBe('openid email profile')
  expect(p.get('code_challenge_method')).toBe('S256')
  expect(p.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(p.get('state')).toBeTruthy()
  const cookies = res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value)
  expect(cookies.some((c) => c.startsWith('meishi_oauth_state=') && /HttpOnly/i.test(c))).toBe(true)
})

test('without an OAuth client the login button shows a plain inline notice', async ({ page }) => {
  // Production has no Google client yet: /auth/status says so (and /auth/google answers 503).
  await page.route('**/auth/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"google":false}' }))
  await page.goto('/')
  await ready(page)
  await page.locator('.login-btn').click()
  const notice = page.locator('.notice')
  await expect(notice).toHaveText('Googleログインは未設定です')
  await expect(page).toHaveURL(/\/$/)
  await notice.locator('.notice-close').click()
  await expect(notice).toHaveCount(0)
})

test('auth status reports the configured OAuth client', async ({ page }) => {
  expect(await (await page.request.get('/auth/status')).json()).toEqual({ google: true })
})

test('OAuth callback rejects a forged state', async ({ page }) => {
  const res = await page.request.get('/auth/google/callback?code=x&state=forged', { maxRedirects: 0 })
  expect(res.status()).toBe(400)
})

test('API refuses anonymous access and cross-site writes', async ({ page, baseURL }) => {
  const me = await page.request.get('/api/me')
  expect(me.status()).toBe(401)
  expect(await me.json()).toEqual({ error: 'unauthorized' })
  expect((await page.request.get('/api/cards')).status()).toBe(401)
  expect((await page.request.get('/api/export.csv')).status()).toBe(401)
  const cross = await page.request.post('/api/cards', { data: { memo: 'x' }, headers: { Origin: 'https://evil.example' } })
  expect(cross.status()).toBe(403)
  const noOrigin = await page.request.post(new URL('/auth/logout', baseURL).toString())
  expect(noOrigin.status()).toBe(403)
})

test('signed-out page has no console errors and no horizontal overflow; tap targets are comfortable', async ({ page }, info) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await ready(page)
  await addMemo(page, 'レイアウト確認用のとても長いメモで折り返しが自然に起きるかどうかを確認するためのテキスト')
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  expect(sw).toBeLessThanOrEqual(0)
  for (const sel of ['#send-btn', '#scan-btn', '.tab', '.login-btn', '.search', '#csv-link']) {
    const h = await page.locator(sel).first().evaluate((el) => (el as HTMLElement).offsetHeight)
    expect(h, sel).toBeGreaterThanOrEqual(40)
  }
  await page.waitForTimeout(700)
  await page.screenshot({ path: `test-results/screens/${info.project.name}-signed-out.png` })
  expect(errors).toEqual([])
})
