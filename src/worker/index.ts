import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { cleanField, COLUMN, FIELD_KEYS, STATUSES, type CardFields, type Status } from '../shared/fields'
import { attachment, toCsv, toVcard, type ExportCard } from './export'
import { extractFromImage, parseMemo } from './extract'
import { KvImageStore, type ImageStore } from './images'

export interface Env {
  DB: D1Database
  IMAGES: KVNamespace
  AI?: Ai
  ASSETS: Fetcher
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  DEV_LOGIN?: string
}

type User = { id: string; email: string; name: string; picture: string | null }
type AppEnv = { Bindings: Env; Variables: { user: User } }
type C = Context<AppEnv>

const SESSION_COOKIE = 'meishi_sid'
// Non-secret hint readable by the client so a signed-out visit skips the /api/me round trip.
const HINT_COOKIE = 'meishi_auth'
const SESSION_DAYS = 30
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const enc = new TextEncoder()

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return b64url(a)
}

async function sha256(s: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)))
}

const isSecure = (c: C) => new URL(c.req.url).protocol === 'https:'
const isLocalHost = (c: C) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname)
const images = (c: C): ImageStore => new KvImageStore(c.env.IMAGES)

const app = new Hono<AppEnv>()

// CSRF: every state-changing request must come from this origin.
app.use('*', async (c, next) => {
  const m = c.req.method
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    const origin = c.req.header('Origin')
    if (!origin || origin !== new URL(c.req.url).origin) return c.json({ error: 'forbidden' }, 403)
  }
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store')
})

// ---------- sessions ----------

async function currentUser(c: C): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return null
  const row = await c.env.DB.prepare(
    'SELECT u.id, u.email, u.name, u.picture, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?',
  )
    .bind(await sha256(token))
    .first<User & { expires_at: number }>()
  if (!row || row.expires_at < Date.now()) return null
  return { id: row.id, email: row.email, name: row.name, picture: row.picture }
}

async function createSession(c: C, userId: string) {
  const token = randomToken()
  const now = Date.now()
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now + SESSION_DAYS * 864e5, now)
    .run()
  const base = { secure: isSecure(c), sameSite: 'Lax' as const, path: '/', maxAge: SESSION_DAYS * 86400 }
  setCookie(c, SESSION_COOKIE, token, { ...base, httpOnly: true })
  setCookie(c, HINT_COOKIE, '1', base)
}

async function upsertUser(c: C, u: User) {
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture`,
  )
    .bind(u.id, u.email, u.name, u.picture, Date.now())
    .run()
}

// ---------- Google OAuth (Authorization Code + PKCE) ----------

const oauthCookie = (c: C) => ({ httpOnly: true, secure: isSecure(c), sameSite: 'Lax' as const, path: '/auth', maxAge: 600 })
const googleConfigured = (c: C) => !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET)
const notConfigured = (c: C) => c.json({ error: 'google_not_configured' }, 503)

// Lets the UI show an inline notice instead of navigating to a 503 when no OAuth client is set.
app.get('/auth/status', (c) => c.json({ google: googleConfigured(c) }))

app.get('/auth/google', async (c) => {
  if (!googleConfigured(c)) return notConfigured(c)
  const state = randomToken(16)
  const verifier = randomToken(48)
  const challenge = b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)))
  setCookie(c, 'meishi_oauth_state', state, oauthCookie(c))
  setCookie(c, 'meishi_oauth_verifier', verifier, oauthCookie(c))
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID!,
    redirect_uri: new URL('/auth/google/callback', c.req.url).toString(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  return c.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString(), 302)
})

app.get('/auth/google/callback', async (c) => {
  const { code, state, error } = c.req.query()
  const expected = getCookie(c, 'meishi_oauth_state')
  const verifier = getCookie(c, 'meishi_oauth_verifier')
  deleteCookie(c, 'meishi_oauth_state', { path: '/auth' })
  deleteCookie(c, 'meishi_oauth_verifier', { path: '/auth' })
  if (!googleConfigured(c)) return notConfigured(c)
  if (error) return c.redirect('/', 302)
  if (!code || !state || !expected || state !== expected || !verifier) return c.json({ error: 'invalid_state' }, 400)

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID!,
      client_secret: c.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: new URL('/auth/google/callback', c.req.url).toString(),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  })
  if (!res.ok) return c.json({ error: 'token_exchange_failed' }, 400)
  const tok = (await res.json()) as { id_token?: string }
  if (!tok.id_token) return c.json({ error: 'no_id_token' }, 400)

  // The id_token came straight from Google's token endpoint over TLS, so its
  // claims can be trusted without a signature check (OIDC Core 3.1.3.7).
  const payload = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(tok.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0)),
    ),
  ) as { iss: string; aud: string; exp: number; sub: string; email: string; email_verified: boolean; name?: string; picture?: string }
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(payload.iss)) return c.json({ error: 'bad_issuer' }, 400)
  if (payload.aud !== c.env.GOOGLE_CLIENT_ID) return c.json({ error: 'bad_audience' }, 400)
  if (payload.exp * 1000 < Date.now()) return c.json({ error: 'expired' }, 400)
  if (!payload.email_verified) return c.json({ error: 'email_not_verified' }, 400)

  const user: User = { id: 'g:' + payload.sub, email: payload.email, name: payload.name ?? '', picture: payload.picture ?? null }
  await upsertUser(c, user)
  await createSession(c, user.id)
  return c.redirect('/', 302)
})

// Local-only login for automated tests. Requires DEV_LOGIN=1 (set only in .dev.vars) AND a localhost host.
app.get('/auth/dev', async (c) => {
  if (c.env.DEV_LOGIN !== '1' || !isLocalHost(c)) return c.json({ error: 'not_found' }, 404)
  const email = (c.req.query('email') ?? 'dev@example.test').slice(0, 120)
  const user: User = { id: 'dev:' + email, email, name: email.split('@')[0], picture: null }
  await upsertUser(c, user)
  await createSession(c, user.id)
  return c.redirect('/', 302)
})

app.post('/auth/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run()
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  deleteCookie(c, HINT_COOKIE, { path: '/' })
  return c.body(null, 204)
})

// ---------- cards ----------

type CardRow = {
  id: string
  status: Status
  prev_status: Status | null
  image_key: string | null
  position: number
  created_at: number
  updated_at: number
  archived_at: number | null
} & Record<string, string>

function toCard(r: CardRow) {
  const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, r[COLUMN[k]] ?? ''])) as CardFields
  return {
    id: r.id,
    ...fields,
    status: r.status,
    prevStatus: r.prev_status,
    imageKey: r.image_key,
    position: r.position,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const isStatus = (v: unknown): v is Status => typeof v === 'string' && (STATUSES as readonly string[]).includes(v)
const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v)
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** Image keys embed a hash of the owner, so ownership is checkable without a read. */
const ownerPrefix = async (userId: string) => (await sha256('img:' + userId)).slice(0, 16)
const KEY_RE = /^[A-Za-z0-9_-]{16}\.[0-9a-f-]{36}$/
async function ownsImageKey(userId: string, key: unknown): Promise<boolean> {
  return typeof key === 'string' && KEY_RE.test(key) && key.startsWith((await ownerPrefix(userId)) + '.')
}

function readFields(body: Record<string, unknown>, onlySent: boolean): Partial<CardFields> {
  const out: Partial<CardFields> = {}
  for (const k of FIELD_KEYS) {
    if (onlySent && body[k] === undefined) continue
    out[k] = cleanField(k, body[k])
  }
  return out
}

async function insertCard(c: C, userId: string, body: Record<string, unknown>) {
  const fields = readFields(body, false) as CardFields
  const imageKey = (await ownsImageKey(userId, body.imageKey)) ? (body.imageKey as string) : null
  if (!imageKey && FIELD_KEYS.every((k) => !fields[k])) return null
  const now = Date.now()
  const id = isId(body.id) ? body.id : crypto.randomUUID()
  const status: Status = isStatus(body.status) ? body.status : 'inbox'
  const cols = FIELD_KEYS.map((k) => COLUMN[k])
  await c.env.DB.prepare(
    `INSERT INTO cards (id, user_id, status, ${cols.join(', ')}, image_key, position, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')}, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
  )
    .bind(
      id,
      userId,
      status,
      ...FIELD_KEYS.map((k) => fields[k]),
      imageKey,
      num(body.position, -now),
      num(body.createdAt, now),
      now,
      status === 'archived' ? now : null,
    )
    .run()
  return id
}

const getCard = (c: C, id: string, userId: string) =>
  c.env.DB.prepare('SELECT * FROM cards WHERE id = ? AND user_id = ?').bind(id, userId).first<CardRow>()

/**
 * One atomic UPDATE touching only the sent fields, so concurrent edits (e.g. a flick while
 * the edit sheet saves) never overwrite each other. SET expressions see the old row.
 */
async function patchCard(c: C, id: string, userId: string, fields: Partial<CardFields>, status: Status | null, imageKey: string | null) {
  const now = Date.now()
  const sets = FIELD_KEYS.map((k, i) => `${COLUMN[k]} = COALESCE(?${i + 1}, ${COLUMN[k]})`)
  const n = FIELD_KEYS.length
  const S = `?${n + 2}`
  return c.env.DB.prepare(
    `UPDATE cards SET
       ${sets.join(',\n       ')},
       image_key = COALESCE(?${n + 1}, image_key),
       position = CASE WHEN ${S} IS NOT NULL AND ${S} <> status THEN ?${n + 3} ELSE position END,
       prev_status = CASE WHEN ${S} = 'archived' AND status <> 'archived' THEN status ELSE prev_status END,
       archived_at = CASE WHEN ${S} IS NULL OR ${S} = status THEN archived_at WHEN ${S} = 'archived' THEN ?${n + 4} ELSE NULL END,
       status = COALESCE(${S}, status),
       updated_at = ?${n + 4}
     WHERE id = ?${n + 5} AND user_id = ?${n + 6}
     RETURNING *`,
  )
    .bind(...FIELD_KEYS.map((k) => fields[k] ?? null), imageKey, status, -now, now, id, userId)
    .first<CardRow>()
}

const api = new Hono<AppEnv>()

api.use('*', async (c, next) => {
  const user = await currentUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  c.set('user', user)
  await next()
})

api.get('/me', (c) => c.json(c.get('user')))

api.get('/cards', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM cards WHERE user_id = ? ORDER BY position ASC')
    .bind(c.get('user').id)
    .all<CardRow>()
  return c.json(results.map(toCard))
})

api.post('/cards', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  const userId = c.get('user').id
  const id = await insertCard(c, userId, body)
  if (!id) return c.json({ error: 'empty_card' }, 400)
  const row = await getCard(c, id, userId)
  return row ? c.json(toCard(row), 201) : c.json({ error: 'not_found' }, 404)
})

/** Bulk move of cards written on this device while signed out. Idempotent by id. */
api.post('/cards/import', async (c) => {
  const body = await c.req.json<{ cards?: unknown }>().catch(() => ({}) as { cards?: unknown })
  const list = Array.isArray(body.cards) ? body.cards.slice(0, 500) : []
  const userId = c.get('user').id
  const ids: string[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const id = await insertCard(c, userId, item as Record<string, unknown>)
    if (id) ids.push(id)
  }
  return c.json({ imported: ids })
})

api.patch('/cards/:id', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>)
  const userId = c.get('user').id
  const status = isStatus(body.status) ? body.status : null
  const imageKey = body.imageKey !== undefined && (await ownsImageKey(userId, body.imageKey)) ? (body.imageKey as string) : null
  const row = await patchCard(c, c.req.param('id'), userId, readFields(body, true), status, imageKey)
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json(toCard(row))
})

/** DELETE archives (the card can be restored). */
api.delete('/cards/:id', async (c) => {
  const row = await patchCard(c, c.req.param('id'), c.get('user').id, {}, 'archived', null)
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json(toCard(row))
})

api.post('/cards/:id/restore', async (c) => {
  const now = Date.now()
  const row = await c.env.DB.prepare(
    `UPDATE cards SET
       status = CASE WHEN status = 'archived' THEN COALESCE(prev_status, 'inbox') ELSE status END,
       archived_at = NULL, position = ?, updated_at = ?
     WHERE id = ? AND user_id = ? RETURNING *`,
  )
    .bind(-now, now, c.req.param('id'), c.get('user').id)
    .first<CardRow>()
  if (!row) return c.json({ error: 'not_found' }, 404)
  return c.json(toCard(row))
})

api.get('/cards/:file{[A-Za-z0-9_-]{8,64}\\.vcf}', async (c) => {
  const id = c.req.param('file').replace(/\.vcf$/, '')
  const row = await getCard(c, id, c.get('user').id)
  if (!row) return c.json({ error: 'not_found' }, 404)
  const card = toCard(row) as ExportCard
  return c.body(toVcard(card), 200, {
    'Content-Type': 'text/vcard; charset=utf-8',
    'Content-Disposition': attachment(`${card.name || card.company || 'card'}.vcf`, 'card.vcf'),
  })
})

api.get('/export.csv', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM cards WHERE user_id = ? ORDER BY created_at ASC')
    .bind(c.get('user').id)
    .all<CardRow>()
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
  return c.body(toCsv(results.map((r) => toCard(r) as ExportCard)), 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': attachment(`meishi-${day}.csv`, `meishi-${day}.csv`),
  })
})

/** Store the image, then read it with Workers AI. No card is created here. */
api.post('/cards/scan', async (c) => {
  const userId = c.get('user').id
  const form = await c.req.parseBody().catch(() => null)
  const file = form?.image
  if (!(file instanceof File)) return c.json({ error: 'image_required' }, 400)
  if (!IMAGE_TYPES.includes(file.type)) return c.json({ error: 'unsupported_type' }, 415)
  if (file.size > MAX_IMAGE_BYTES) return c.json({ error: 'too_large' }, 413)
  const buf = await file.arrayBuffer()
  const key = `${await ownerPrefix(userId)}.${crypto.randomUUID()}`
  await images(c).put(key, buf, { owner: userId, contentType: file.type })
  const { fields, source } = await extractFromImage(c.env.AI, new Uint8Array(buf), file.type)
  return c.json({ imageKey: key, fields, source })
})

api.get('/images/:key', async (c) => {
  const userId = c.get('user').id
  const key = c.req.param('key')
  if (!(await ownsImageKey(userId, key))) return c.json({ error: 'not_found' }, 404)
  const img = await images(c).get(key)
  if (!img || img.meta.owner !== userId) return c.json({ error: 'not_found' }, 404)
  return c.body(img.body, 200, {
    'Content-Type': img.meta.contentType,
    // Keys are never reused, so the private browser cache can keep them.
    'Cache-Control': 'private, max-age=31536000, immutable',
  })
})

api.post('/ai/parse-memo', async (c) => {
  const body = await c.req.json<{ text?: unknown }>().catch(() => ({}) as { text?: unknown })
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : ''
  if (!text) return c.json({ error: 'text_required' }, 400)
  return c.json(await parseMemo(c.env.AI, text))
})

app.route('/api', api)

// No-JavaScript fallback: the memo box is a plain <form action="/memo" method="post">.
app.post('/memo', async (c) => {
  const form = await c.req.parseBody()
  const user = await currentUser(c)
  // Signed out: boot.js already kept the memo on the device; it moves to the account on sign-in.
  if (user) await insertCard(c, user.id, { id: form.id, memo: form.memo })
  return c.redirect('/', 303)
})

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
