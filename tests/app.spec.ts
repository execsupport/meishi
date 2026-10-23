import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import { addMemo, card, count, devLogin, fixture, flick, longPress, ready, row, scanFiles, serverCards, tab, watchErrors } from './helpers'

// Signed-in flows use the local-only /auth/dev login (DEV_LOGIN=1 + localhost).

const scanSheet = (page: Page) => page.locator('.sheet[aria-label="スキャン"]')
const field = (page: Page, name: string) => page.locator(`.sheet input[name="${name}"], .sheet textarea[name="${name}"]`)

test('memos saved while signed out move to the account on sign-in', async ({ page }, info) => {
  await page.goto('/')
  await ready(page)
  await addMemo(page, 'ログイン前のメモ')
  await addMemo(page, 'もう一枚')
  await devLogin(page, info)
  await ready(page)
  await expect(row(page, 'ログイン前のメモ')).toBeVisible()
  await expect(row(page, 'ログイン前のメモ').locator('.pending')).toHaveCount(0)
  const titles = (await serverCards(page)).map((c) => c.memo)
  expect(titles).toEqual(expect.arrayContaining(['ログイン前のメモ', 'もう一枚']))
  expect(await page.evaluate(() => localStorage.getItem('meishi.outbox'))).toBe('[]')
})

test('Enter in the memo box creates an inbox card; IME Enter does not', async ({ page }, info) => {
  await devLogin(page, info)
  await ready(page)
  await addMemo(page, '展示会で会った人')
  await addMemo(page, '二枚目')
  await expect(count(page, 'inbox')).toHaveText('2')
  await expect(page.locator('.row .title').first()).toHaveText('二枚目')
  await expect.poll(async () => (await serverCards(page)).map((c) => `${c.memo}:${c.status}`).sort()).toEqual(['二枚目:inbox', '展示会で会った人:inbox'])

  const memo = page.locator('#memo')
  await memo.fill('へんかん')
  await memo.evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229, bubbles: true, cancelable: true })))
  await expect(memo).toHaveValue('へんかん')
  await expect(count(page, 'inbox')).toHaveText('2')
})

test('flick right advances, flick left goes back, a short drag springs back', async ({ page }, info) => {
  await devLogin(page, info)
  await ready(page)
  await addMemo(page, 'フリック')
  await expect.poll(async () => (await serverCards(page)).length).toBe(1)

  await flick(page, card(page, 'フリック'), 260, { info })
  await expect(row(page, 'フリック')).toHaveCount(0)
  await expect(count(page, 'follow')).toHaveText('1')
  await expect.poll(async () => (await serverCards(page))[0]?.status).toBe('follow')

  await tab(page, 'follow').click()
  await flick(page, card(page, 'フリック'), 260, { info })
  await expect(count(page, 'done')).toHaveText('1')
  await expect.poll(async () => (await serverCards(page))[0]?.status).toBe('done')

  await tab(page, 'done').click()
  await flick(page, card(page, 'フリック'), -260, { info })
  await expect(count(page, 'follow')).toHaveText('1')
  await expect.poll(async () => (await serverCards(page))[0]?.status).toBe('follow')

  // Short, slow drag: below the threshold, nothing changes and the card springs home.
  await tab(page, 'follow').click()
  await flick(page, card(page, 'フリック'), 50, { info, steps: 12 })
  const c = card(page, 'フリック')
  await expect(c).toBeVisible()
  await expect(count(page, 'follow')).toHaveText('1')
  await expect.poll(() => c.evaluate((el) => el.getAnimations().length)).toBe(0)
  expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(await c.evaluate((el) => getComputedStyle(el).transform))
})

test('flick left on an inbox card archives it, and undo restores it', async ({ page }, info) => {
  await devLogin(page, info)
  await ready(page)
  await addMemo(page, 'アーカイブする名刺')
  await expect.poll(async () => (await serverCards(page)).length).toBe(1)
  await flick(page, card(page, 'アーカイブする名刺'), -260, { info })
  await expect(row(page, 'アーカイブする名刺')).toHaveCount(0)
  await expect(count(page, 'archived')).toHaveText('1')
  await expect.poll(async () => (await serverCards(page))[0]?.status).toBe('archived')
  await page.locator('.toast button', { hasText: '元に戻す' }).click()
  await expect(card(page, 'アーカイブする名刺')).toBeVisible()
  await expect(count(page, 'archived')).toHaveText('0')
  await expect.poll(async () => (await serverCards(page))[0]?.status).toBe('inbox')
})

test('long press opens the action menu: advance, archive and restore without gestures', async ({ page }, info) => {
  await devLogin(page, info)
  await ready(page)
  await addMemo(page, '長押し')
  await expect.poll(async () => (await serverCards(page)).length).toBe(1)

  await longPress(page, card(page, '長押し'), info)
  const menu = page.locator('.action-menu')
  await expect(menu).toBeVisible()
  await expect(page.locator('.sheet')).toHaveCount(0)
  await menu.locator('.menu-item', { hasText: 'フォロー中へ' }).click()
  await expect(menu).toHaveCount(0)
  await expect(count(page, 'follow')).toHaveText('1')
  await expect.poll(async () => (await serverCards(page))[0]?.status).toBe('follow')

  await tab(page, 'follow').click()
  await longPress(page, card(page, '長押し'), info)
  await menu.locator('.menu-item', { hasText: 'アーカイブ' }).click()
  await expect(count(page, 'archived')).toHaveText('1')

  await tab(page, 'archived').click()
  await longPress(page, card(page, '長押し'), info)
  await menu.locator('.menu-item', { hasText: '復元' }).click()
  await expect(count(page, 'follow')).toHaveText('1')
  await expect.poll(async () => (await serverCards(page))[0]?.status).toBe('follow')
})

test('tap opens the detail sheet; edits persist; AI memo parsing fills empty fields', async ({ page }, info) => {
  await devLogin(page, info)
  await ready(page)
  await addMemo(page, '株式会社テスト 営業部長 yamada@example.com 03-1111-2222')
  await expect.poll(async () => (await serverCards(page)).length).toBe(1)
  await card(page, 'yamada@example.com').click()
  const sheet = page.locator('.sheet[aria-label="名刺の詳細"]')
  await expect(sheet).toBeVisible()

  const res = page.waitForResponse('**/api/ai/parse-memo')
  await sheet.locator('.chip-btn', { hasText: 'AI解析' }).click()
  const body = await (await res).json()
  if (process.env.REMOTE_AI) expect(body.source).toBe('ai')
  await expect(field(page, 'email')).toHaveValue('yamada@example.com')
  await expect(field(page, 'phone')).toHaveValue('03-1111-2222')
  await expect(field(page, 'company')).toHaveValue('株式会社テスト')
  await expect(field(page, 'title')).toHaveValue('部長')

  await field(page, 'name').fill('山田 太郎')
  await sheet.locator('.seg-btn', { hasText: '完了' }).click()
  await sheet.locator('.primary-btn', { hasText: '保存' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(count(page, 'done')).toHaveText('1')
  await expect
    .poll(async () => (await serverCards(page)).map((c) => `${c.name}|${c.company}|${c.email}|${c.status}`))
    .toEqual(['山田 太郎|株式会社テスト|yamada@example.com|done'])
  await page.reload()
  await ready(page)
  await tab(page, 'done').click()
  await expect(card(page, '山田 太郎')).toBeVisible()
  await expect(row(page, '山田 太郎').locator('.sub')).toHaveText('株式会社テスト / 部長')
})

test('scan: image is resized, stored, read (fallback without AI) and saved as a card', async ({ page }, info) => {
  await devLogin(page, info)
  await ready(page)
  // A large photo (2400 x 1450 PNG) must arrive as a JPEG no larger than 1280 px.
  const big = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 2400
    c.height = 1450
    const x = c.getContext('2d')!
    x.fillStyle = '#fbfaf7'
    x.fillRect(0, 0, 2400, 1450)
    x.fillStyle = '#2f3439'
    x.font = '120px sans-serif'
    x.fillText('山田 太郎', 160, 640)
    return c.toDataURL('image/png').split(',')[1]
  })
  const scanRes = page.waitForResponse('**/api/cards/scan')
  await page.locator('#scan-input').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.from(big, 'base64') })
  const scanned = await (await scanRes).json()
  if (!process.env.REMOTE_AI) expect(scanned.source).toBe('fallback')
  const size = await page.evaluate(async (url) => {
    const blob = await (await fetch(url)).blob()
    const bmp = await createImageBitmap(blob)
    return { type: blob.type, w: bmp.width, h: bmp.height }
  }, `/api/images/${scanned.imageKey}`)
  expect(size).toEqual({ type: 'image/jpeg', w: 1280, h: 773 })
  const sheet = scanSheet(page)
  await expect(sheet.locator('.scan-count')).toHaveText('1 / 1')
  await expect(sheet.locator('.scan-preview img')).toBeVisible()
  await expect(field(page, 'name')).toBeVisible({ timeout: 30_000 })
  if (!process.env.REMOTE_AI) await expect(sheet.locator('.pill.source')).toHaveText('手入力')
  await field(page, 'name').fill('山田 太郎')
  await field(page, 'company').fill('株式会社サンプル商事')
  await field(page, 'email').fill('taro.yamada@sample.example')
  await sheet.locator('.primary-btn', { hasText: '保存' }).click()
  await expect(sheet).toHaveCount(0)
  const r = row(page, '山田 太郎')
  await expect(r.locator('.thumb img')).toBeVisible()
  await expect.poll(() => r.locator('.thumb img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)

  const cards = await serverCards(page)
  expect(cards).toHaveLength(1)
  expect(cards[0].imageKey).toBeTruthy()
  const img = await page.request.get(`/api/images/${cards[0].imageKey}`)
  expect(img.status()).toBe(200)
  expect(img.headers()['content-type']).toBe('image/jpeg')
  // Only the owner can read the image.
  const other = await page.context().browser()!.newContext({ baseURL: info.project.use.baseURL })
  const op = await other.newPage()
  await op.goto(`/auth/dev?email=${encodeURIComponent('other-' + Date.now() + '@example.test')}`)
  expect((await op.request.get(`/api/images/${cards[0].imageKey}`)).status()).toBe(404)
  await other.close()

  // Tap the image in the detail sheet to zoom.
  await card(page, '山田 太郎').click()
  await page.locator('.card-image').click()
  await expect(page.locator('.zoom img')).toBeVisible()
  await page.locator('.zoom').click()
  await expect(page.locator('.zoom')).toHaveCount(0)
})

test('batch scan queues several images with progress and saves each', async ({ page }, info) => {
  await devLogin(page, info)
  await ready(page)
  await page.locator('#batch-input').setInputFiles([fixture('card-a.jpg'), fixture('card-b.jpg')])
  const sheet = scanSheet(page)
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('.scan-count')).toHaveText('1 / 2')
  await expect(sheet.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '2', { timeout: 30_000 })
  await field(page, 'name').fill('一枚目')
  await sheet.locator('.primary-btn', { hasText: '保存' }).click()
  await expect(sheet.locator('.scan-count')).toHaveText('2 / 2')
  await expect(field(page, 'name')).toHaveValue('')
  await field(page, 'name').fill('二枚目')
  await sheet.locator('.primary-btn', { hasText: '保存' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(count(page, 'inbox')).toHaveText('2')
  await expect.poll(async () => (await serverCards(page)).filter((c) => c.imageKey).length).toBe(2)
})

test('duplicate detection offers merge or save-as-new', async ({ page }, info) => {
  await devLogin(page, info)
  await ready(page)
  const sheet = scanSheet(page)

  await scanFiles(page, ['card-a.jpg'])
  await expect(field(page, 'name')).toBeVisible({ timeout: 30_000 })
  await field(page, 'name').fill('山田 太郎')
  await field(page, 'email').fill('Taro@Sample.example')
  await sheet.locator('.primary-btn', { hasText: '保存' }).click()
  await expect(sheet).toHaveCount(0)
  await expect.poll(async () => (await serverCards(page)).length).toBe(1)

  // Same email (different case) -> duplicate; merge fills the blank phone.
  await scanFiles(page, ['card-a.jpg'])
  await expect(field(page, 'name')).toBeVisible({ timeout: 30_000 })
  await field(page, 'email').fill('taro@sample.example')
  await field(page, 'phone').fill('03-1234-5678')
  await sheet.locator('.primary-btn', { hasText: '保存' }).click()
  const dupes = sheet.locator('.dupes')
  await expect(dupes).toBeVisible()
  await expect(dupes.locator('.dupe')).toHaveCount(1)
  await expect(dupes.locator('.pill', { hasText: 'メール一致' })).toBeVisible()
  await dupes.locator('.primary-btn', { hasText: '統合' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(count(page, 'inbox')).toHaveText('1')
  await expect.poll(async () => (await serverCards(page)).map((c) => `${c.name}|${(c as { phone?: string }).phone}`)).toEqual(['山田 太郎|03-1234-5678'])

  // Same phone in another format -> duplicate; keep both.
  await scanFiles(page, ['card-b.jpg'])
  await expect(field(page, 'name')).toBeVisible({ timeout: 30_000 })
  await field(page, 'name').fill('別人')
  await field(page, 'mobile').fill('+81 3 1234 5678')
  await sheet.locator('.primary-btn', { hasText: '保存' }).click()
  await expect(sheet.locator('.pill', { hasText: '電話一致' })).toBeVisible()
  await sheet.locator('.ghost-btn', { hasText: '別として保存' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(count(page, 'inbox')).toHaveText('2')
  await expect.poll(async () => (await serverCards(page)).length).toBe(2)
})

test('search filters by name, company and memo instantly', async ({ page }, info) => {
  await devLogin(page, info)
  await ready(page)
  await addMemo(page, '田中さん 株式会社アルファ')
  await addMemo(page, '鈴木さん 合同会社ベータ')
  await addMemo(page, 'カフェで名刺交換')
  const search = page.locator('.search input')
  await search.fill('アルファ')
  await expect(page.locator('.row')).toHaveCount(1)
  await expect(row(page, '田中さん')).toBeVisible()
  await expect(page.locator('.search-meta')).toHaveText('1件')
  await expect(page.locator('.tabs')).toHaveCount(0)
  // Katakana and hiragana match each other.
  await search.fill('かふぇ')
  await expect(page.locator('.row')).toHaveCount(1)
  await expect(row(page, 'カフェで名刺交換')).toBeVisible()
  await search.fill('該当しない語')
  await expect(page.locator('.row')).toHaveCount(0)
  await expect(page.locator('.search-empty')).toBeVisible()
  await page.locator('.search-clear').click()
  await expect(page.locator('.row')).toHaveCount(3)
  await expect(page.locator('.tabs')).toBeVisible()
})

test('CSV export (UTF-8 BOM) and vCard download', async ({ page }, info) => {
  await devLogin(page, info)
  await ready(page)
  await addMemo(page, '株式会社テスト 部長 vcard@example.com 03-1111-2222')
  await expect.poll(async () => (await serverCards(page)).length).toBe(1)
  await card(page, 'vcard@example.com').click()
  await field(page, 'name').fill('山田 太郎')
  await field(page, 'nameKana').fill('ヤマダ タロウ')
  await field(page, 'email').fill('vcard@example.com')
  await page.locator('.sheet .primary-btn', { hasText: '保存' }).click()
  await expect(page.locator('.sheet')).toHaveCount(0)
  await expect.poll(async () => (await serverCards(page))[0]?.name).toBe('山田 太郎')

  const csvDl = page.waitForEvent('download')
  await page.locator('#csv-link').click()
  const csv = await csvDl
  expect(csv.suggestedFilename()).toMatch(/^meishi-\d{4}-\d{2}-\d{2}\.csv$/)
  const csvBuf = fs.readFileSync((await csv.path())!)
  expect([...csvBuf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  const text = csvBuf.toString('utf8')
  expect(text).toContain('"氏名","フリガナ","会社"')
  expect(text).toContain('"山田 太郎","ヤマダ タロウ"')
  expect(text).toContain('"vcard@example.com"')

  await card(page, '山田 太郎').click()
  const vDl = page.waitForEvent('download')
  await page.locator('.sheet .chip-btn', { hasText: 'vCard' }).click()
  const v = await vDl
  expect(v.suggestedFilename()).toBe('山田 太郎.vcf')
  const vcf = fs.readFileSync((await v.path())!, 'utf8')
  expect(vcf).toContain('BEGIN:VCARD\r\nVERSION:3.0')
  expect(vcf).toContain('N:山田;太郎;;;')
  expect(vcf).toContain('FN:山田 太郎')
  expect(vcf).toContain('EMAIL;TYPE=INTERNET,WORK:vcard@example.com')
  expect(vcf).toContain('X-PHONETIC-LAST-NAME:ヤマダ')
  expect(vcf).toContain('END:VCARD')
})

test('works without the app bundle: the memo form posts to the server', async ({ page }, info) => {
  await devLogin(page, info)
  await page.route('**/assets/*.js', (r) => r.abort())
  await page.goto('/')
  await page.locator('#memo').fill('JSなしで追加')
  await page.locator('#memo').press('Enter')
  await page.waitForURL('**/')
  await expect.poll(async () => (await serverCards(page)).map((c) => c.memo)).toContain('JSなしで追加')
  await page.unroute('**/assets/*.js')
  await page.reload()
  await ready(page)
  await expect(row(page, 'JSなしで追加')).toHaveCount(1)
})

test('signed-in flows log no console errors; sign out returns to the login button', async ({ page }, info) => {
  const errors = watchErrors(page)
  await devLogin(page, info)
  await ready(page)
  for (const t of ['展示会 株式会社アルファ 田中', 'セミナー 鈴木さん', '紹介 佐藤さん']) await addMemo(page, t)
  await flick(page, card(page, 'セミナー'), 260, { info })
  await expect(count(page, 'follow')).toHaveText('1')
  await scanFiles(page, ['card-a.jpg'])
  await expect(field(page, 'name')).toBeVisible({ timeout: 30_000 })
  await field(page, 'name').fill('山田 太郎')
  await field(page, 'company').fill('株式会社サンプル商事')
  await field(page, 'title').fill('営業部 部長')
  await scanSheet(page).locator('.primary-btn', { hasText: '保存' }).click()
  await expect(scanSheet(page)).toHaveCount(0)
  await expect(row(page, '山田 太郎').locator('.thumb img')).toBeVisible()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `test-results/screens/${info.project.name}-signed-in.png` })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)

  await page.locator('.avatar').click()
  await page.locator('.menu-item', { hasText: 'ログアウト' }).click()
  await expect(page.locator('.login-btn')).toBeVisible()
  await expect(page.locator('.row')).toHaveCount(0)
  expect((await page.request.get('/api/cards')).status()).toBe(401)
  expect(errors).toEqual([])
})

test('layout: multi-column grid at 1280, single column on phones, no overflow', async ({ page }, info) => {
  const desktop = info.project.name === 'desktop-chromium'
  await devLogin(page, info)
  await ready(page)
  for (const t of ['一', '二', '三', '四', '五', '六']) await addMemo(page, `レイアウト ${t}`)
  await page.waitForTimeout(800)
  const tops = await page.locator('.row').evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetTop))
  const firstRow = tops.filter((t) => t === tops[0]).length
  if (desktop) expect(firstRow).toBeGreaterThanOrEqual(2)
  else expect(firstRow).toBe(1)
  const vw = page.viewportSize()!.width
  const composer = (await page.locator('#composer').boundingBox())!
  expect(composer.width).toBeLessThanOrEqual(720)
  expect(Math.abs(composer.x + composer.width / 2 - vw / 2)).toBeLessThan(12)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  // Tab labels are never truncated.
  for (const l of await page.locator('.tab .label').all()) {
    if (!(await l.isVisible())) continue
    expect(await l.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  }
  await page.screenshot({ path: `test-results/screens/${info.project.name}-grid.png` })
  if (!desktop) return
  // Keyboard: arrow keys move the focused card, the context-menu key opens the menu.
  await card(page, 'レイアウト 六').focus()
  await page.keyboard.press('ArrowRight')
  await expect(count(page, 'follow')).toHaveText('1')
  await card(page, 'レイアウト 五').focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.locator('.action-menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.action-menu')).toHaveCount(0)
})
