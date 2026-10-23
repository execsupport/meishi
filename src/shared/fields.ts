// Card field definitions, duplicate matching and search normalization.
// Shared by the Worker and the client so both sides agree on the data shape.

export const FIELD_KEYS = [
  'name',
  'nameKana',
  'company',
  'department',
  'title',
  'email',
  'phone',
  'mobile',
  'address',
  'website',
  'memo',
] as const
export type FieldKey = (typeof FIELD_KEYS)[number]
export type CardFields = Record<FieldKey, string>

/** camelCase (API) -> snake_case (D1 column) */
export const COLUMN: Record<FieldKey, string> = {
  name: 'name',
  nameKana: 'name_kana',
  company: 'company',
  department: 'department',
  title: 'title',
  email: 'email',
  phone: 'phone',
  mobile: 'mobile',
  address: 'address',
  website: 'website',
  memo: 'memo',
}

export const FIELD_LABEL: Record<FieldKey, string> = {
  name: '氏名',
  nameKana: 'フリガナ',
  company: '会社',
  department: '部署',
  title: '役職',
  email: 'メール',
  phone: '電話',
  mobile: '携帯',
  address: '住所',
  website: 'Web',
  memo: 'メモ',
}

export const FIELD_MAX: Record<FieldKey, number> = {
  name: 120,
  nameKana: 120,
  company: 200,
  department: 200,
  title: 200,
  email: 254,
  phone: 40,
  mobile: 40,
  address: 400,
  website: 400,
  memo: 4000,
}

export const STATUSES = ['inbox', 'follow', 'done', 'archived'] as const
export type Status = (typeof STATUSES)[number]
export const FLOW = ['inbox', 'follow', 'done'] as const
export type FlowStatus = (typeof FLOW)[number]

export const STATUS_LABEL: Record<Status, string> = {
  inbox: '未整理',
  follow: 'フォロー中',
  done: '完了',
  archived: 'アーカイブ',
}

export const emptyFields = (): CardFields =>
  Object.fromEntries(FIELD_KEYS.map((k) => [k, ''])) as CardFields

export function cleanField(k: FieldKey, v: unknown): string {
  if (typeof v !== 'string') return ''
  const s = k === 'memo' || k === 'address' ? v.replace(/\r\n?/g, '\n').trim() : v.replace(/\s+/g, ' ').trim()
  return s.slice(0, FIELD_MAX[k])
}

// ---------- duplicate detection ----------

export const normEmail = (s: string) => s.trim().toLowerCase()

/** Digits only, +81 folded to a leading 0. Too-short numbers never match. */
export function normPhone(s: string): string {
  let d = s.replace(/[^\d+]/g, '')
  if (d.startsWith('+81')) d = '0' + d.slice(3)
  else if (d.startsWith('81') && d.length >= 11) d = '0' + d.slice(2)
  d = d.replace(/\D/g, '')
  return d.length >= 8 ? d : ''
}

export const normText = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    // katakana -> hiragana so either reading matches
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))

export type DupeReason = 'email' | 'phone' | 'name'
export const DUPE_LABEL: Record<DupeReason, string> = { email: 'メール一致', phone: '電話一致', name: '氏名と会社が一致' }

export function dupeReason(a: Partial<CardFields>, b: Partial<CardFields>): DupeReason | null {
  const ea = normEmail(a.email ?? '')
  if (ea && ea === normEmail(b.email ?? '')) return 'email'
  const pa = [a.phone, a.mobile].map((p) => normPhone(p ?? '')).filter(Boolean)
  const pb = new Set([b.phone, b.mobile].map((p) => normPhone(p ?? '')).filter(Boolean))
  if (pa.some((p) => pb.has(p))) return 'phone'
  const na = normText(a.name ?? '')
  const ca = normText(a.company ?? '')
  if (na && ca && na === normText(b.name ?? '') && ca === normText(b.company ?? '')) return 'name'
  return null
}

export function findDupes<T extends Partial<CardFields> & { id: string }>(
  candidate: Partial<CardFields>,
  cards: T[],
  excludeId?: string,
): { card: T; reason: DupeReason }[] {
  const out: { card: T; reason: DupeReason }[] = []
  for (const c of cards) {
    if (c.id === excludeId) continue
    const reason = dupeReason(candidate, c)
    if (reason) out.push({ card: c, reason })
  }
  return out
}

/** Fill the existing card's empty fields from the incoming one; memos are appended. */
export function mergeFields(existing: CardFields, incoming: Partial<CardFields>): Partial<CardFields> {
  const patch: Partial<CardFields> = {}
  for (const k of FIELD_KEYS) {
    const v = (incoming[k] ?? '').trim()
    if (!v) continue
    if (k === 'memo') {
      if (!existing.memo) patch.memo = v
      else if (!existing.memo.includes(v)) patch.memo = `${existing.memo}\n${v}`.slice(0, FIELD_MAX.memo)
    } else if (!existing[k]) patch[k] = v
  }
  return patch
}

export function matchesQuery(c: Partial<CardFields>, q: string): boolean {
  const n = normText(q)
  if (!n) return true
  const hay = normText(
    [c.name, c.nameKana, c.company, c.department, c.title, c.email, c.memo].filter(Boolean).join('\n'),
  )
  return hay.includes(n)
}
