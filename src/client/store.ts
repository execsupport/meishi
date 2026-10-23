import { useEffect, useState } from 'preact/hooks'
import { FIELD_KEYS, mergeFields, type CardFields, type FlowStatus, type Status } from '../shared/fields'
import { api, AuthError, normalizeCard, type Card, type ScanResult, type User } from './api'
import { resizeImage } from './image'

const OUTBOX = 'meishi.outbox'
const CACHE = 'meishi.cache'

export type Toast = { id: number; text: string; action?: { label: string; run: () => void } }
export type ScanItem = {
  id: string
  file: File
  state: 'waiting' | 'working' | 'ready' | 'error'
  preview?: string
  result?: ScanResult
}
export type ScanState = { items: ScanItem[]; total: number }
type State = {
  phase: 'loading' | 'ready'
  user: User | null
  cards: Card[]
  toasts: Toast[]
  offline: boolean
  scan: ScanState | null
  googleMissing: boolean
}
export type CardPatch = Partial<CardFields> & { status?: Status; imageKey?: string }

const read = <T>(k: string, fb: T): T => {
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? '')
    return (v ?? fb) as T
  } catch {
    return fb
  }
}
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* storage full or blocked */
  }
}
const sortCards = (cs: Card[]) => [...cs].sort((a, b) => a.position - b.position)
export const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

class Store {
  state: State = { phase: 'loading', user: null, cards: [], toasts: [], offline: false, scan: null, googleMissing: false }
  private listeners = new Set<() => void>()
  private toastSeq = 0
  private scanRun = 0

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private set(p: Partial<State>) {
    this.state = { ...this.state, ...p }
    this.listeners.forEach((l) => l())
  }
  private setCards(cards: Card[]) {
    this.set({ cards: sortCards(cards) })
    write(OUTBOX, this.state.cards.filter((c) => c.pending))
    if (this.state.user) write(CACHE, this.state.cards.filter((c) => !c.pending))
  }
  private replace(c: Card) {
    this.setCards(this.state.cards.map((x) => (x.id === c.id ? c : x)))
  }
  get(id: string) {
    return this.state.cards.find((c) => c.id === id)
  }

  async init() {
    const started = performance.now()
    let user: User | null = null
    let server: Card[] = []
    let offline = false
    try {
      user = await api.me()
      if (user) {
        await this.flush()
        server = (await api.list()).map(normalizeCard)
        write(CACHE, server)
      }
    } catch {
      offline = true
      server = read<Card[]>(CACHE, []).map(normalizeCard)
    }
    const outbox = read<Card[]>(OUTBOX, [])
      .filter((c) => c && typeof c.id === 'string' && !server.some((s) => s.id === c.id))
      .map((c) => normalizeCard({ ...c, pending: true }))
    // Keep the skeleton up long enough to read as a transition, not a flash.
    const wait = 320 - (performance.now() - started)
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.state = { ...this.state, user, offline }
    this.setCards([...server, ...outbox])
    this.set({ phase: 'ready' })
    addEventListener('online', () => this.resync())
  }

  /** Move everything saved on this device into the account in one request. */
  private async flush() {
    const box = read<Card[]>(OUTBOX, []).filter((c) => c && typeof c.id === 'string')
    if (!box.length) return
    await api.import(box.map((c) => normalizeCard(c)))
    write(OUTBOX, [])
  }

  private async resync() {
    if (!this.state.user) return
    try {
      await this.flush()
      const server = (await api.list()).map(normalizeCard)
      const pending = this.state.cards.filter((c) => c.pending && !server.some((s) => s.id === c.id))
      this.set({ offline: false })
      this.setCards([...server, ...pending])
    } catch {
      /* still offline */
    }
  }

  private async createRemote(c: Card) {
    try {
      const saved = normalizeCard(await api.create(c))
      const cur = this.get(c.id)
      if (!cur) return
      this.replace({ ...saved, ...pickFields(cur), status: cur.status, prevStatus: cur.prevStatus, position: cur.position, pending: false })
      const diff = diffPatch(saved, cur)
      if (diff) await api.patch(c.id, diff)
    } catch (e) {
      if (!(e instanceof AuthError)) this.set({ offline: true })
    }
  }

  /** A memo typed in the composer becomes an inbox card (no image). */
  addMemo(text: string) {
    return this.create({ memo: text })
  }

  create(fields: Partial<CardFields>, imageKey: string | null = null) {
    const now = Date.now()
    const card = normalizeCard({ ...fields, id: uuid(), imageKey, position: -now, createdAt: now, updatedAt: now, pending: true })
    this.setCards([card, ...this.state.cards])
    if (this.state.user) this.createRemote(card)
    return card
  }

  /** Optimistic local update, then one PATCH carrying only the changed fields. */
  update(id: string, p: CardPatch) {
    const prev = this.get(id)
    if (!prev) return
    const patch = diffPatch(prev, { ...prev, ...p } as Card)
    if (!patch) return
    const now = Date.now()
    const next: Card = { ...prev, ...patch, updatedAt: now }
    if (patch.status) {
      next.position = -now
      if (patch.status === 'archived' && prev.status !== 'archived') next.prevStatus = prev.status as FlowStatus
    }
    this.replace(next)
    if (this.state.user && !prev.pending) {
      api.patch(id, patch).catch(() => {
        this.replace(prev)
        this.toast('同期できませんでした')
      })
    }
  }

  move(id: string, to: Status) {
    if (to === 'archived') this.archive(id)
    else this.update(id, { status: to })
  }

  archive(id: string) {
    const prev = this.get(id)
    if (!prev || prev.status === 'archived') return
    const now = Date.now()
    this.replace({ ...prev, status: 'archived', prevStatus: prev.status as FlowStatus, position: -now, updatedAt: now })
    if (this.state.user && !prev.pending) api.archive(id).catch(() => this.set({ offline: true }))
    this.toast('アーカイブしました', { label: '元に戻す', run: () => this.restore(id, prev.position) })
  }

  restore(id: string, position?: number) {
    const cur = this.get(id)
    if (!cur || cur.status !== 'archived') return
    const now = Date.now()
    this.replace({ ...cur, status: cur.prevStatus ?? 'inbox', position: position ?? -now, updatedAt: now })
    if (this.state.user && !cur.pending) api.restore(id).catch(() => this.set({ offline: true }))
  }

  /** Duplicate resolution: fill the existing card's blanks from the new data. */
  merge(targetId: string, incoming: Partial<CardFields>, imageKey: string | null) {
    const target = this.get(targetId)
    if (!target) return
    const patch: CardPatch = mergeFields(target, incoming)
    if (imageKey && !target.imageKey) patch.imageKey = imageKey
    this.update(targetId, patch)
    this.toast('統合しました')
  }

  async logout() {
    try {
      await api.logout()
    } catch {
      /* cookie is cleared server-side when reachable */
    }
    write(CACHE, [])
    this.set({ user: null })
    this.setCards(this.state.cards.filter((c) => c.pending))
  }

  /** Start Google sign-in, or show a notice when the server has no OAuth client yet. */
  async login() {
    try {
      const res = await fetch('/auth/status', { credentials: 'same-origin' })
      const st = (await res.json()) as { google?: boolean }
      if (st.google === false) {
        this.set({ googleMissing: true })
        return
      }
    } catch {
      /* fall through to a normal navigation */
    }
    location.assign('/auth/google')
  }

  hideGoogleNotice() {
    this.set({ googleMissing: false })
  }

  // ---------- scan queue ----------

  startScan(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith('image/') || f.type === '')
    if (!imgs.length) return
    const items: ScanItem[] = imgs.map((file) => ({ id: uuid(), file, state: 'waiting' }))
    const cur = this.state.scan
    this.set({ scan: cur ? { items: [...cur.items, ...items], total: cur.total + items.length } : { items, total: items.length } })
    if (!cur) this.runScan(++this.scanRun)
  }

  private patchItem(id: string, p: Partial<ScanItem>) {
    const s = this.state.scan
    if (!s) return
    this.set({ scan: { ...s, items: s.items.map((i) => (i.id === id ? { ...i, ...p } : i)) } })
  }

  private async runScan(run: number) {
    for (;;) {
      if (run !== this.scanRun) return
      const next = this.state.scan?.items.find((i) => i.state === 'waiting')
      if (!next) return
      this.patchItem(next.id, { state: 'working' })
      try {
        const blob = await resizeImage(next.file)
        if (run !== this.scanRun) return
        this.patchItem(next.id, { preview: URL.createObjectURL(blob) })
        const result = await api.scan(blob)
        if (run !== this.scanRun) return
        this.patchItem(next.id, { state: 'ready', result })
      } catch (e) {
        if (e instanceof AuthError) {
          this.cancelScan()
          this.toast('ログインが必要です')
          return
        }
        this.patchItem(next.id, { state: 'error' })
      }
    }
  }

  retryScan(id: string) {
    this.patchItem(id, { state: 'waiting' })
    const busy = this.state.scan?.items.some((i) => i.state === 'working')
    if (!busy) this.runScan(this.scanRun)
  }

  /** The reviewed item leaves the queue (saved or skipped). */
  finishScanItem(id: string) {
    const s = this.state.scan
    if (!s) return
    const item = s.items.find((i) => i.id === id)
    if (item?.preview) URL.revokeObjectURL(item.preview)
    const items = s.items.filter((i) => i.id !== id)
    this.set({ scan: items.length ? { ...s, items } : null })
    if (!items.length) this.scanRun++
  }

  cancelScan() {
    this.state.scan?.items.forEach((i) => i.preview && URL.revokeObjectURL(i.preview))
    this.scanRun++
    this.set({ scan: null })
  }

  toast(text: string, action?: Toast['action']) {
    const t: Toast = { id: ++this.toastSeq, text, action }
    this.set({ toasts: [...this.state.toasts.slice(-2), t] })
    setTimeout(() => this.dismiss(t.id), action ? 5000 : 2600)
  }
  dismiss(id: number) {
    this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) })
  }
}

function pickFields(c: Card): CardFields {
  return Object.fromEntries(FIELD_KEYS.map((k) => [k, c[k]])) as CardFields
}

function diffPatch(prev: Card, next: Partial<Card> & CardFields): CardPatch | null {
  const patch: CardPatch = {}
  for (const k of FIELD_KEYS) {
    const v = next[k] ?? ''
    const clean = k === 'memo' || k === 'address' ? v.trim() : v.replace(/\s+/g, ' ').trim()
    if (clean !== prev[k]) patch[k] = clean
  }
  if (next.status && next.status !== prev.status) patch.status = next.status
  if (next.imageKey && next.imageKey !== prev.imageKey) patch.imageKey = next.imageKey
  return Object.keys(patch).length ? patch : null
}

export const store = new Store()

export function useStore() {
  const [, force] = useState(0)
  useEffect(() => store.subscribe(() => force((n) => n + 1)), [])
  return store.state
}
