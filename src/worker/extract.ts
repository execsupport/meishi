import { cleanField, type CardFields, type FieldKey } from '../shared/fields'

// Model ids confirmed with `wrangler ai models list` on 2026-10-23.
export const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct'
export const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'

export type Extracted = { fields: Partial<CardFields>; source: 'ai' | 'fallback' }

const SNAKE_TO_KEY: Record<string, FieldKey> = {
  name: 'name',
  name_kana: 'nameKana',
  nameKana: 'nameKana',
  furigana: 'nameKana',
  company: 'company',
  title: 'title',
  department: 'department',
  email: 'email',
  phone: 'phone',
  mobile: 'mobile',
  address: 'address',
  website: 'website',
  memo_hint: 'memo',
  memo: 'memo',
}

const EMPTYISH = /^(n\/?a|none|null|undefined|unknown|-|不明|なし)$/i

function normalize(obj: Record<string, unknown>): Partial<CardFields> {
  const out: Partial<CardFields> = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = SNAKE_TO_KEY[k]
    if (!key || typeof v !== 'string') continue
    const s = cleanField(key, v)
    if (s && !EMPTYISH.test(s)) out[key] = s
  }
  if (out.email) out.email = out.email.replace(/^mailto:/i, '').toLowerCase()
  // A mobile number printed without a label often lands in "phone".
  if (out.phone && !out.mobile && isMobile(out.phone)) {
    out.mobile = out.phone
    delete out.phone
  }
  return out
}

function parseJsonLoose(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw !== 'string') return null
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const v = JSON.parse(raw.slice(start, end + 1))
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// ---------- rule-based fallback ----------

const isMobile = (p: string) => /^(?:\+81[-\s]?|0)[789]0/.test(p.trim())

const RE_EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const RE_URL = /\b(?:https?:\/\/|www\.)[^\s,、。「」()（）<>]+/i
const RE_PHONE = /(?:\+81[-\s.]?\(?0?\)?|\(?0)\d{1,4}\)?[-\s.]?\d{1,4}[-\s.]?\d{3,4}/g
const CORP = '株式会社|有限会社|合同会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|学校法人|医療法人|社会福祉法人'
const RE_COMPANY = [
  new RegExp(`(?:${CORP})\\s?[^\\s,、。]+`),
  new RegExp(`[^\\s,、。]+(?:株式会社|有限会社|合同会社)`),
  /[A-Z][\w&.'-]*(?:\s[A-Z][\w&.'-]*)*,?\s(?:Inc\.?|Co\.,?\s?Ltd\.?|LLC|Ltd\.?|K\.K\.|Corporation|Corp\.?|GmbH)/,
]
const RE_TITLE =
  /代表取締役社長|代表取締役|取締役|執行役員|副社長|社長|本部長|部長|次長|課長|係長|主任|室長|マネージャー|マネジャー|ディレクター|プロデューサー|エンジニア|デザイナー|コンサルタント|CEO|CTO|COO|CFO|CMO|VP|Vice President|President|General Manager|Manager|Director|Engineer|Designer|Consultant/
const RE_DEPT = /[^\s,、。]{1,16}?(?:事業部|本部|グループ|部|課|室)(?![長])/
const RE_NAME_LINE = /^[一-鿿々]{1,4}[ 　][一-鿿々]{1,4}$/m

export function ruleExtract(text: string): Partial<CardFields> {
  const t = text.normalize('NFKC')
  const out: Partial<CardFields> = {}
  const email = t.match(RE_EMAIL)?.[0]
  if (email) out.email = email.toLowerCase()
  const url = t.replace(RE_EMAIL, ' ').match(RE_URL)?.[0]
  if (url) out.website = url.replace(/[.)]+$/, '')
  const phones = (t.replace(RE_EMAIL, ' ').match(RE_PHONE) ?? []).map((p) => p.trim()).filter((p) => p.replace(/\D/g, '').length >= 9)
  for (const p of phones) {
    if (isMobile(p)) out.mobile ??= p
    else out.phone ??= p
  }
  const company = RE_COMPANY.map((re) => t.match(re)?.[0]).find(Boolean)
  if (company) out.company = company.trim()
  const rest = company ? t.replace(company, ' ') : t
  const title = rest.match(RE_TITLE)?.[0]
  if (title) out.title = title
  const dept = rest.match(RE_DEPT)?.[0]
  if (dept && !/[@\d]/.test(dept)) out.department = dept
  const name = t.match(RE_NAME_LINE)?.[0]
  if (name) out.name = name
  return normalize(out as Record<string, unknown>)
}

// ---------- Workers AI ----------

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('ai timeout')), ms))])
}

const VISION_PROMPT = `You read a photo of a business card (often Japanese) and reply with ONLY one JSON object, no other text:
{"name":"","name_kana":"","company":"","title":"","department":"","email":"","phone":"","mobile":"","address":"","website":"","memo_hint":""}
Rules:
- Copy text exactly as printed. Keep Japanese in Japanese.
- name: the person's full name. name_kana: its printed reading (furigana or romaji) if any.
- phone: office or landline number. mobile: cell number (070/080/090 in Japan).
- memo_hint: other short useful text on the card (qualifications, second office), else "".
- Use "" for anything not printed on the card. Never guess.`

type RunFn = (model: string, input: unknown) => Promise<unknown>

export async function extractFromImage(ai: Ai | undefined, bytes: Uint8Array, contentType: string): Promise<Extracted> {
  if (!ai) return { fields: {}, source: 'fallback' }
  const run = ai.run.bind(ai) as unknown as RunFn
  const dataUrl = `data:${contentType};base64,${toBase64(bytes)}`
  const call = () =>
    run(VISION_MODEL, {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 700,
      temperature: 0.1,
    })
  let raw: unknown
  try {
    try {
      raw = await withTimeout(call(), 45_000)
    } catch (e) {
      // Llama 3.2 Vision needs a one-time license acceptance per account.
      if (!/agree/i.test(String(e))) throw e
      // The acceptance call itself answers with error 5016 "Thank you for agreeing".
      await run(VISION_MODEL, { prompt: 'agree' }).catch(() => undefined)
      raw = await withTimeout(call(), 45_000)
    }
  } catch (e) {
    console.error('vision failed', e)
    return { fields: {}, source: 'fallback' }
  }
  const text = (raw as { response?: unknown })?.response
  const parsed = parseJsonLoose(text)
  if (parsed) {
    const fields = normalize(parsed)
    if (Object.keys(fields).length) return { fields, source: 'ai' }
  }
  // The model answered in prose: salvage email / phone / URL with rules.
  if (typeof text === 'string' && text.trim()) return { fields: ruleExtract(text), source: 'fallback' }
  return { fields: {}, source: 'fallback' }
}

const MEMO_PROMPT = `You extract contact details from a short memo written after meeting someone at work.
Reply with JSON only. Copy values exactly as written in the memo; use "" when a value is not in the memo. Never invent.`

const MEMO_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(
    ['name', 'name_kana', 'company', 'department', 'title', 'email', 'phone', 'mobile', 'website'].map((k) => [k, { type: 'string' }]),
  ),
  required: ['name', 'company', 'title'],
}

export async function parseMemo(ai: Ai | undefined, text: string): Promise<Extracted> {
  const rules = ruleExtract(text)
  if (ai) {
    try {
      const run = ai.run.bind(ai) as unknown as RunFn
      const out = (await withTimeout(
        run(TEXT_MODEL, {
          messages: [
            { role: 'system', content: MEMO_PROMPT },
            { role: 'user', content: text },
          ],
          response_format: { type: 'json_schema', json_schema: MEMO_SCHEMA },
          max_tokens: 400,
          temperature: 0.1,
        }),
        25_000,
      )) as { response?: unknown }
      const parsed = parseJsonLoose(out?.response)
      if (parsed) {
        const fields = normalize(parsed)
        delete fields.memo
        // Only keep values that actually occur in the memo (guards against invention).
        const plain = text.normalize('NFKC')
        for (const k of Object.keys(fields) as FieldKey[]) {
          if (!plain.includes((fields[k] ?? '').normalize('NFKC'))) delete fields[k]
        }
        // Emails and phone numbers are more reliable from rules.
        for (const k of ['email', 'phone', 'mobile', 'website'] as const) if (rules[k]) fields[k] = rules[k]
        if (Object.keys(fields).length) return { fields, source: 'ai' }
      }
    } catch (e) {
      console.error('parse-memo failed', e)
    }
  }
  delete rules.memo
  return { fields: rules, source: 'fallback' }
}
