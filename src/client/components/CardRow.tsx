import { useRef } from 'preact/hooks'
import { STATUS_LABEL, type Status } from '../../shared/fields'
import { api, cardSub, cardTitle, type Card } from '../api'
import { animate, EASE_OUT, haptic, reducedMotion, SPRING } from '../motion'
import { MemoIcon } from './icons'

export type CardAction = { kind: 'move'; to: Status } | { kind: 'archive' } | { kind: 'restore' }
type Pair = { right: CardAction | null; left: CardAction | null }

/** Right = forward (inbox -> follow -> done), left = back. The ends archive. */
export const ACTIONS: Record<Status, Pair> = {
  inbox: { right: { kind: 'move', to: 'follow' }, left: { kind: 'archive' } },
  follow: { right: { kind: 'move', to: 'done' }, left: { kind: 'move', to: 'inbox' } },
  done: { right: { kind: 'archive' }, left: { kind: 'move', to: 'follow' } },
  archived: { right: { kind: 'restore' }, left: null },
}
export const actionLabel = (a: CardAction) => (a.kind === 'archive' ? 'アーカイブ' : a.kind === 'restore' ? '復元' : `${STATUS_LABEL[a.to]}へ`)
const actionTone = (a: CardAction) => (a.kind === 'archive' ? 'archived' : a.kind === 'restore' ? 'inbox' : a.to)

const THRESHOLD = 0.32 // fraction of card width
const FLICK_VELOCITY = 0.55 // px per ms
const LONG_PRESS_MS = 480

type Props = {
  card: Card
  index: number
  showStatus: boolean
  onAction(card: Card, a: CardAction): void
  onOpen(card: Card): void
  onMenu(card: Card, rect: DOMRect): void
}

/** A small dot flies from the card into the target tab's counter. */
function flyToTab(from: DOMRect, to: Status) {
  const target = document.querySelector(`.tab[data-status="${to}"] .count`)
  if (!target || reducedMotion()) return
  const t = target.getBoundingClientRect()
  const dot = document.createElement('div')
  dot.className = `fly tone-${to}`
  const x0 = from.left + from.width / 2
  const y0 = from.top + from.height / 2
  dot.style.left = `${x0 - 7}px`
  dot.style.top = `${y0 - 7}px`
  document.body.appendChild(dot)
  const dx = t.left + t.width / 2 - x0
  const dy = t.top + t.height / 2 - y0
  animate(
    dot,
    [
      { transform: 'translate(0,0) scale(1.6)', opacity: 0.2 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(1.15)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(.5)`, opacity: 0.9 },
    ],
    { duration: 620, easing: 'cubic-bezier(.45,0,.2,1)' },
  ).finished.finally(() => dot.remove())
}

export function CardRow({ card, index, showStatus, onAction, onOpen, onMenu }: Props) {
  const row = useRef<HTMLLIElement>(null)
  const el = useRef<HTMLDivElement>(null)
  const drag = useRef({
    id: -1,
    x0: 0,
    y0: 0,
    dx: 0,
    lock: '' as '' | 'x' | 'y',
    armed: '' as '' | 'left' | 'right',
    samples: [] as { x: number; t: number }[],
    moved: false,
    busy: false,
    long: false,
    timer: 0,
    menuAt: 0,
  })
  const actions = ACTIONS[card.status]
  const title = cardTitle(card)
  const sub = cardSub(card)

  const clearTimer = () => {
    clearTimeout(drag.current.timer)
    drag.current.timer = 0
  }

  const paint = (dx: number) => {
    const c = el.current!
    const w = c.offsetWidth
    const p = Math.min(1, Math.abs(dx) / (w * THRESHOLD))
    c.style.transform = `translate3d(${dx}px,0,0) rotate(${dx * 0.01}deg)`
    const r = row.current!
    const side = dx > 0 ? 'right' : dx < 0 ? 'left' : ''
    r.dataset.dir = side && actions[side] ? side : ''
    r.style.setProperty('--p', p.toFixed(3))
    const armed = p >= 1 && side && actions[side] ? side : ''
    if (armed !== drag.current.armed) {
      drag.current.armed = armed
      r.classList.toggle('armed', !!armed)
      if (armed) haptic(12)
    }
  }

  const resetVisual = () => {
    const r = row.current
    const c = el.current
    if (!r || !c) return
    r.getAnimations().forEach((a) => a.cancel())
    c.getAnimations().forEach((a) => a.cancel())
    c.style.transform = ''
    r.style.setProperty('--p', '0')
    r.classList.remove('armed')
    r.dataset.dir = ''
    drag.current.busy = false
  }

  const commit = async (dir: 'left' | 'right') => {
    const a = actions[dir]
    if (!a) return springBack()
    const d = drag.current
    d.busy = true
    const c = el.current!
    const r = row.current!
    const w = r.offsetWidth
    const sign = dir === 'right' ? 1 : -1
    haptic(18)
    if (a.kind === 'move') flyToTab(c.getBoundingClientRect(), a.to)
    const leaving = a.kind !== 'move'
    await animate(
      c,
      [
        { transform: c.style.transform || 'none', opacity: 1, filter: 'blur(0)' },
        { transform: `translate3d(${sign * w * 1.15}px,0,0) rotate(${sign * 8}deg)`, opacity: leaving ? 0 : 0.6, filter: leaving ? 'blur(6px)' : 'blur(0)' },
      ],
      { duration: 240, easing: EASE_OUT, fill: 'forwards' },
    ).finished
    const h = r.offsetHeight
    await animate(r, [{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 200, easing: EASE_OUT, fill: 'forwards' }).finished
    onAction(card, a)
    // If the card is still listed (e.g. in search results), bring it back.
    requestAnimationFrame(resetVisual)
  }

  const springBack = () => {
    const c = el.current!
    const from = c.style.transform || 'none'
    c.style.transform = ''
    row.current!.style.setProperty('--p', '0')
    row.current!.classList.remove('armed')
    drag.current.armed = ''
    animate(c, [{ transform: from }, { transform: 'translate3d(0,0,0) rotate(0)' }], { spring: SPRING.bouncy }).finished.then(() => {
      if (row.current) row.current.dataset.dir = ''
    })
  }

  const openMenu = () => {
    clearTimer()
    const d = drag.current
    d.long = true
    d.menuAt = performance.now()
    d.id = -1
    haptic(14)
    const c = el.current!
    animate(c, [{ transform: 'scale(1)' }, { transform: 'scale(.97)' }, { transform: 'scale(1)' }], { spring: SPRING.bouncy })
    onMenu(card, c.getBoundingClientRect())
  }

  const onPointerDown = (e: PointerEvent) => {
    const d = drag.current
    if (d.busy || (e.pointerType === 'mouse' && e.button !== 0)) return
    Object.assign(d, { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, lock: '', armed: '', moved: false, long: false, samples: [{ x: e.clientX, t: e.timeStamp }] })
    el.current!.getAnimations().forEach((a) => a.cancel())
    clearTimer()
    d.timer = window.setTimeout(openMenu, LONG_PRESS_MS)
  }

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    if (e.pointerId !== d.id || d.busy) return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    if (!d.lock) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
      clearTimer()
      d.lock = Math.abs(dx) > Math.abs(dy) * 1.1 ? 'x' : 'y'
      if (d.lock === 'x') {
        el.current!.setPointerCapture(e.pointerId)
        row.current!.classList.add('dragging')
      }
    }
    if (d.lock !== 'x') return
    e.preventDefault()
    d.moved = true
    const w = el.current!.offsetWidth
    // Rubber band past 60% of the width, and stronger resistance where there is no action.
    const lim = w * 0.6
    let x = Math.abs(dx) > lim ? Math.sign(dx) * (lim + (Math.abs(dx) - lim) * 0.25) : dx
    if (!actions[x > 0 ? 'right' : 'left']) x *= 0.25
    d.dx = x
    d.samples.push({ x: e.clientX, t: e.timeStamp })
    if (d.samples.length > 5) d.samples.shift()
    paint(d.dx)
  }

  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current
    clearTimer()
    if (e.pointerId !== d.id) return
    d.id = -1
    row.current?.classList.remove('dragging')
    if (d.lock !== 'x' || d.busy) return
    const s = d.samples
    const v = s.length > 1 ? (s[s.length - 1].x - s[0].x) / Math.max(1, s[s.length - 1].t - s[0].t) : 0
    const w = el.current!.offsetWidth
    const past = Math.abs(d.dx) >= w * THRESHOLD
    const flick = Math.abs(v) > FLICK_VELOCITY && Math.abs(d.dx) > 40 && Math.sign(v) === Math.sign(d.dx)
    const side = d.dx > 0 ? 'right' : 'left'
    if (e.type === 'pointerup' && (past || flick) && actions[side]) commit(side)
    else springBack()
  }

  const onClick = () => {
    const d = drag.current
    if (d.moved || d.busy || d.long) {
      d.moved = false
      d.long = false
      return
    }
    onOpen(card)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') onOpen(card)
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault()
      onMenu(card, el.current!.getBoundingClientRect())
    } else if (e.key === 'ArrowRight' && actions.right) {
      e.preventDefault()
      commit('right')
    } else if (e.key === 'ArrowLeft' && actions.left) {
      e.preventDefault()
      commit('left')
    }
  }

  return (
    <li ref={row} class={`row status-${card.status}`} data-id={card.id} style={{ '--i': Math.min(index, 12) }}>
      {actions.right && (
        <div class={`under under-right tone-${actionTone(actions.right)}`} aria-hidden="true">
          <span class="under-label">{actionLabel(actions.right)}</span>
        </div>
      )}
      {actions.left && (
        <div class={`under under-left tone-${actionTone(actions.left)}`} aria-hidden="true">
          <span class="under-label">{actionLabel(actions.left)}</span>
        </div>
      )}
      <div
        ref={el}
        class="card glass"
        role="button"
        tabIndex={0}
        aria-label={`${title}、${STATUS_LABEL[card.status]}`}
        aria-haspopup="menu"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => {
          e.preventDefault()
          // Android fires contextmenu on the same long press that already opened the menu.
          if (performance.now() - drag.current.menuAt > 800) openMenu()
        }}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        <span class={`thumb${card.imageKey ? ' has-img' : ''}`} aria-hidden="true">
          {card.imageKey ? (
            <img src={api.imageUrl(card.imageKey)} alt="" loading="lazy" decoding="async" draggable={false} />
          ) : card.name || card.company ? (
            <span class="mono">{title.slice(0, 1)}</span>
          ) : (
            <MemoIcon size={20} />
          )}
        </span>
        <span class="meta">
          <span class="title">{title}</span>
          {sub && <span class="sub">{sub}</span>}
        </span>
        {showStatus && <span class={`pill tone-${card.status}`}>{STATUS_LABEL[card.status]}</span>}
        {card.pending && <span class="pending" title="この端末のみに保存" aria-label="この端末のみに保存" />}
      </div>
    </li>
  )
}
