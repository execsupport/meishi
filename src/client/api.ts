import { emptyFields, FIELD_KEYS, type CardFields, type FlowStatus, type Status } from '../shared/fields'

export type Card = CardFields & {
  id: string
  status: Status
  prevStatus: FlowStatus | null
  imageKey: string | null
  position: number
  createdAt: number
  updatedAt: number
  /** Saved on this device only, not yet on the server. */
  pending?: boolean
}
export type User = { id: string; email: string; name: string; picture: string | null }
export type ScanResult = { imageKey: string; fields: Partial<CardFields>; source: 'ai' | 'fallback' }

export class AuthError extends Error {}
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`${status} ${code}`)
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: isForm ? init.headers : { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
  if (res.status === 401) throw new AuthError('unauthorized')
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new HttpError(res.status, body.error ?? 'error')
  }
  return (res.status === 204 ? null : await res.json()) as T
}

/** Fill in defaults so cards from older outbox entries always have every field. */
export function normalizeCard(c: Partial<Card> & { id: string }): Card {
  const base = emptyFields()
  for (const k of FIELD_KEYS) base[k] = typeof c[k] === 'string' ? (c[k] as string) : ''
  const now = Date.now()
  return {
    ...base,
    id: c.id,
    status: c.status ?? 'inbox',
    prevStatus: c.prevStatus ?? null,
    imageKey: c.imageKey ?? null,
    position: typeof c.position === 'number' ? c.position : -now,
    createdAt: c.createdAt ?? now,
    updatedAt: c.updatedAt ?? now,
    pending: c.pending,
  }
}

const strip = ({ pending: _p, ...c }: Card) => c

export const hasSessionHint = () => /(?:^|;\s*)meishi_auth=1/.test(document.cookie)

export const api = {
  async me(): Promise<User | null> {
    if (!hasSessionHint()) return null
    try {
      return await req<User>('/api/me')
    } catch (e) {
      if (e instanceof AuthError) return null
      throw e
    }
  },
  list: () => req<Card[]>('/api/cards'),
  create: (c: Card) => req<Card>('/api/cards', { method: 'POST', body: JSON.stringify(strip(c)) }),
  import: (cards: Card[]) => req<{ imported: string[] }>('/api/cards/import', { method: 'POST', body: JSON.stringify({ cards: cards.map(strip) }) }),
  patch: (id: string, p: Partial<CardFields> & { status?: Status; imageKey?: string }) =>
    req<Card>(`/api/cards/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(p) }),
  archive: (id: string) => req<Card>(`/api/cards/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restore: (id: string) => req<Card>(`/api/cards/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  scan: (image: Blob) => {
    const fd = new FormData()
    fd.append('image', image, 'card.jpg')
    return req<ScanResult>('/api/cards/scan', { method: 'POST', body: fd })
  },
  parseMemo: (text: string) =>
    req<{ fields: Partial<CardFields>; source: 'ai' | 'fallback' }>('/api/ai/parse-memo', { method: 'POST', body: JSON.stringify({ text }) }),
  logout: () => req<null>('/auth/logout', { method: 'POST' }),
  imageUrl: (key: string) => `/api/images/${encodeURIComponent(key)}`,
  vcardUrl: (id: string) => `/api/cards/${encodeURIComponent(id)}.vcf`,
}

export function cardTitle(c: CardFields): string {
  return c.name || c.company || c.memo.split('\n')[0] || c.email || '名刺'
}

export function cardSub(c: CardFields): string {
  if (c.name) return [c.company, c.title].filter(Boolean).join(' / ')
  if (c.company) return [c.department, c.title].filter(Boolean).join(' / ')
  return ''
}
