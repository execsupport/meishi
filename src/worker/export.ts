import { STATUS_LABEL, type CardFields, type Status } from '../shared/fields'

export type ExportCard = CardFields & { id: string; status: Status; createdAt: number }

const CSV_COLUMNS: [string, (c: ExportCard) => string][] = [
  ['氏名', (c) => c.name],
  ['フリガナ', (c) => c.nameKana],
  ['会社', (c) => c.company],
  ['部署', (c) => c.department],
  ['役職', (c) => c.title],
  ['メール', (c) => c.email],
  ['電話', (c) => c.phone],
  ['携帯', (c) => c.mobile],
  ['住所', (c) => c.address],
  ['Web', (c) => c.website],
  ['メモ', (c) => c.memo],
  ['ステータス', (c) => STATUS_LABEL[c.status]],
  ['登録日', (c) => new Date(c.createdAt + 9 * 3600e3).toISOString().slice(0, 10)],
]

const csvCell = (v: string) => {
  // Neutralize spreadsheet formulas, then quote.
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return `"${s.replace(/"/g, '""')}"`
}

/** UTF-8 with BOM and CRLF so Excel (including Japanese Excel) opens it correctly. */
export function toCsv(cards: ExportCard[]): string {
  const lines = [CSV_COLUMNS.map(([h]) => csvCell(h)).join(',')]
  for (const c of cards) lines.push(CSV_COLUMNS.map(([, f]) => csvCell(f(c) ?? '')).join(','))
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;')

function splitName(full: string): [string, string] {
  const parts = full.trim().split(/[\s\u3000]+/)
  if (parts.length < 2) return [full.trim(), '']
  // Japanese order is family name first; Latin "Given Family" is reversed.
  if (/^[\x00-\x7F]+$/.test(full)) return [parts[parts.length - 1], parts.slice(0, -1).join(' ')]
  return [parts[0], parts.slice(1).join(' ')]
}

/** vCard 3.0, which iPhone Contacts and Google Contacts both import. */
export function toVcard(c: ExportCard): string {
  const [family, given] = splitName(c.name)
  const [kFamily, kGiven] = splitName(c.nameKana)
  const fn = c.name || c.company || 'Meishi'
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${esc(family)};${esc(given)};;;`, `FN:${esc(fn)}`]
  if (c.nameKana) {
    lines.push(`X-PHONETIC-LAST-NAME:${esc(kFamily)}`)
    if (kGiven) lines.push(`X-PHONETIC-FIRST-NAME:${esc(kGiven)}`)
    lines.push(`SORT-STRING:${esc(c.nameKana)}`)
  }
  if (c.company || c.department) lines.push(`ORG:${esc(c.company)}${c.department ? ';' + esc(c.department) : ''}`)
  if (c.title) lines.push(`TITLE:${esc(c.title)}`)
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${esc(c.email)}`)
  if (c.phone) lines.push(`TEL;TYPE=WORK,VOICE:${esc(c.phone)}`)
  if (c.mobile) lines.push(`TEL;TYPE=CELL:${esc(c.mobile)}`)
  if (c.address) lines.push(`ADR;TYPE=WORK:;;${esc(c.address)};;;;`)
  if (c.website) lines.push(`URL:${esc(/^https?:\/\//i.test(c.website) ? c.website : 'https://' + c.website)}`)
  if (c.memo) lines.push(`NOTE:${esc(c.memo)}`)
  lines.push(`UID:meishi-${c.id}`, 'END:VCARD')
  return lines.join('\r\n') + '\r\n'
}

/** Content-Disposition with an ASCII fallback and an RFC 5987 UTF-8 name. */
export function attachment(name: string, fallback: string) {
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}
