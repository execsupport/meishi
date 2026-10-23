import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { matchesQuery, STATUSES, type Status } from '../shared/fields'
import type { Card } from './api'
import { bindComposer, clearComposer, dropFromComposer } from './composer'
import { ActionMenu } from './components/ActionMenu'
import { CardRow, type CardAction } from './components/CardRow'
import { HeaderSlot, Skeleton, Toasts } from './components/Chrome'
import { DetailSheet } from './components/DetailSheet'
import { ScanSheet } from './components/ScanSheet'
import { Tabs } from './components/Tabs'
import { Toolbar } from './components/Toolbar'
import { animate, SPRING } from './motion'
import { store, useStore, type ScanState } from './store'

/** One list per tab. FLIP-animates reorders and inserts. */
function List(props: {
  cards: Card[]
  dir: number
  showStatus: boolean
  onOpen(c: Card): void
  onMenu(c: Card, r: DOMRect): void
  onAction(c: Card, a: CardAction): void
  empty: 'none' | 'search'
}) {
  const ref = useRef<HTMLUListElement>(null)
  const prev = useRef<Map<string, { x: number; y: number }> | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const next = new Map<string, { x: number; y: number }>()
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const id = child.dataset.id
      if (!id) continue
      const pos = { x: child.offsetLeft, y: child.offsetTop }
      next.set(id, pos)
      if (!prev.current) continue
      const p = prev.current.get(id)
      if (p === undefined) {
        animate(child, [{ opacity: 0, transform: 'translateY(-14px) scale(.96)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], {
          spring: SPRING.soft,
        })
      } else if (p.x !== pos.x || p.y !== pos.y) {
        animate(child, [{ transform: `translate(${p.x - pos.x}px, ${p.y - pos.y}px)` }, { transform: 'none' }], { spring: SPRING.soft })
      }
    }
    prev.current = next
  })

  if (!props.cards.length)
    return props.empty === 'search' ? (
      <div class="empty search-empty">該当なし</div>
    ) : (
      <div class="empty" aria-label="名刺はありません">
        <svg viewBox="0 0 80 64" width="72" height="58" aria-hidden="true">
          <rect x="6" y="12" width="56" height="36" rx="8" opacity=".45" />
          <rect x="18" y="20" width="56" height="36" rx="8" />
          <circle cx="32" cy="34" r="5" fill="#fff" />
          <rect x="42" y="30" width="22" height="4" rx="2" fill="#fff" />
          <rect x="42" y="38" width="14" height="4" rx="2" fill="#fff" opacity=".8" />
        </svg>
      </div>
    )

  return (
    <ul class="list enter" ref={ref} style={{ '--dir': props.dir }}>
      {props.cards.map((c, i) => (
        <CardRow key={c.id} card={c} index={i} showStatus={props.showStatus} onAction={props.onAction} onOpen={props.onOpen} onMenu={props.onMenu} />
      ))}
    </ul>
  )
}

export function App() {
  const s = useStore()
  const [tab, setTab] = useState<Status>('inbox')
  const [dir, setDir] = useState(0)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ card: Card; rect: DOMRect } | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [skeleton, setSkeleton] = useState<'on' | 'leaving' | 'off'>('on')
  const tabRef = useRef(tab)
  tabRef.current = tab
  const userRef = useRef(s.user)
  userRef.current = s.user
  const lastScan = useRef<ScanState>({ items: [], total: 1 })
  if (s.scan) lastScan.current = s.scan

  const startScan = (files: File[]) => {
    if (!userRef.current) {
      store.toast('スキャンはログイン後に使えます', { label: 'ログイン', run: () => store.login() })
      return
    }
    store.startScan(files)
    setScanOpen(true)
  }

  useEffect(() => {
    store.init()
    return bindComposer({
      onSubmit(text) {
        setQuery('')
        if (tabRef.current !== 'inbox') {
          setDir(-1)
          setTab('inbox')
        }
        dropFromComposer(text, document.querySelector('.list, .empty'))
        store.addMemo(text)
        clearComposer()
      },
      onFiles: (files) => startScan(files),
    })
  }, [])

  useEffect(() => {
    if (s.phase !== 'ready' || skeleton !== 'on') return
    setSkeleton('leaving')
    const t = setTimeout(() => setSkeleton('off'), 260)
    document.getElementById('app')?.setAttribute('aria-busy', 'false')
    return () => clearTimeout(t)
  }, [s.phase])

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUSES.map((k) => [k, 0])) as Record<Status, number>
    s.cards.forEach((x) => c[x.status]++)
    return c
  }, [s.cards])
  const searching = query.trim().length > 0
  const visible = useMemo(
    () => (searching ? s.cards.filter((c) => matchesQuery(c, query)) : s.cards.filter((c) => c.status === tab)),
    [s.cards, tab, query, searching],
  )
  const openCard = openId ? s.cards.find((c) => c.id === openId) : undefined

  const changeTab = (n: Status) => {
    if (n === tab) return
    setDir(STATUSES.indexOf(n) > STATUSES.indexOf(tab) ? 1 : -1)
    setTab(n)
  }

  const act = (c: Card, a: CardAction) => {
    if (a.kind === 'archive') store.archive(c.id)
    else if (a.kind === 'restore') store.restore(c.id)
    else store.move(c.id, a.to)
  }

  return (
    <>
      <HeaderSlot user={s.user} ready={s.phase === 'ready'} />
      {s.googleMissing && (
        <div class="notice narrow" role="alert">
          <span>Googleログインは未設定です</span>
          <button type="button" class="notice-close" aria-label="閉じる" onClick={() => store.hideGoogleNotice()}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      )}
      {skeleton !== 'off' ? (
        <Skeleton leaving={skeleton === 'leaving'} />
      ) : (
        <div class="board">
          <Toolbar query={query} onQuery={setQuery} signedIn={!!s.user} onFiles={startScan} />
          {searching ? (
            <div class="search-meta narrow" aria-live="polite">
              {visible.length}件
            </div>
          ) : (
            <Tabs value={tab} counts={counts} onChange={changeTab} />
          )}
          {s.offline && <div class="offline-pill">オフライン</div>}
          <List
            key={searching ? 'search' : tab}
            cards={visible}
            dir={searching ? 0 : dir}
            showStatus={searching}
            empty={searching ? 'search' : 'none'}
            onOpen={(c) => setOpenId(c.id)}
            onMenu={(c, rect) => setMenu({ card: c, rect })}
            onAction={act}
          />
        </div>
      )}
      {menu && (
        <ActionMenu
          key={menu.card.id}
          card={menu.card}
          rect={menu.rect}
          canExport={!!s.user}
          onAction={(a) => act(menu.card, a)}
          onOpen={() => setOpenId(menu.card.id)}
          onClose={() => setMenu(null)}
        />
      )}
      {openCard && (
        <DetailSheet
          key={openCard.id}
          card={openCard}
          signedIn={!!s.user}
          onSave={(p) => store.update(openCard.id, p)}
          onArchive={() => store.archive(openCard.id)}
          onRestore={() => store.restore(openCard.id)}
          onClosed={() => setOpenId(null)}
        />
      )}
      {scanOpen && <ScanSheet scan={s.scan ?? { ...lastScan.current, items: [] }} cards={s.cards} onClosed={() => setScanOpen(false)} />}
      <Toasts toasts={s.toasts} />
    </>
  )
}
