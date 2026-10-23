import type { ComponentChildren } from 'preact'
import { createPortal } from 'preact/compat'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { STATUS_LABEL } from '../../shared/fields'
import { api, cardTitle, type Card } from '../api'
import { animate, SPRING } from '../motion'
import { ACTIONS, actionLabel, type CardAction } from './CardRow'
import { ArchiveIcon, ArrowLeftIcon, ArrowRightIcon, ContactIcon, OpenIcon, RestoreIcon } from './icons'

type Props = {
  card: Card
  rect: DOMRect
  canExport: boolean
  onAction(a: CardAction): void
  onOpen(): void
  onClose(): void
}

type Item = { key: string; label: string; icon: ComponentChildren; run?: () => void; href?: string; tone?: string }

/** Long-press (or right-click / context-menu key) menu: the non-gesture equivalent of a flick. */
export function ActionMenu({ card, rect, canExport, onAction, onOpen, onClose }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const pair = ACTIONS[card.status]
  const items: Item[] = []
  const add = (a: CardAction | null, icon: ComponentChildren) => {
    if (a) items.push({ key: actionLabel(a), label: actionLabel(a), icon, run: () => onAction(a), tone: a.kind === 'archive' ? 'archived' : undefined })
  }
  if (card.status === 'archived') add(pair.right, <RestoreIcon />)
  else {
    if (pair.right?.kind === 'move') add(pair.right, <ArrowRightIcon />)
    if (pair.left?.kind === 'move') add(pair.left, <ArrowLeftIcon />)
    add({ kind: 'archive' }, <ArchiveIcon />)
  }
  items.push({ key: 'open', label: '詳細を開く', icon: <OpenIcon />, run: onOpen })
  if (canExport && !card.pending) items.push({ key: 'vcf', label: 'vCardを書き出し', icon: <ContactIcon />, href: api.vcardUrl(card.id) })

  useLayoutEffect(() => {
    const m = el.current!
    const w = m.offsetWidth
    const h = m.offsetHeight
    const gap = 8
    const below = rect.bottom + gap + h < innerHeight - 12
    const top = below ? rect.bottom + gap : Math.max(12, rect.top - gap - h)
    const left = Math.min(Math.max(12, rect.left + 12), innerWidth - w - 12)
    m.style.top = `${top}px`
    m.style.left = `${left}px`
    m.style.transformOrigin = below ? 'top left' : 'bottom left'
    animate(m, [{ opacity: 0, transform: 'scale(.88)' }, { opacity: 1, transform: 'scale(1)' }], { spring: SPRING.bouncy })
    m.querySelector<HTMLElement>('.menu-item')?.focus({ preventScroll: true })
  }, [])

  // Layout effect: listeners must be live as soon as the menu is on screen.
  useLayoutEffect(() => {
    const off = (e: PointerEvent) => !el.current?.contains(e.target as Node) && onClose()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const list = Array.from(el.current!.querySelectorAll<HTMLElement>('.menu-item'))
        const i = list.indexOf(document.activeElement as HTMLElement)
        list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus()
      }
    }
    const t = setTimeout(() => addEventListener('pointerdown', off), 0)
    addEventListener('keydown', key)
    addEventListener('scroll', onClose, { passive: true })
    return () => {
      clearTimeout(t)
      removeEventListener('pointerdown', off)
      removeEventListener('keydown', key)
      removeEventListener('scroll', onClose)
    }
  }, [])

  return createPortal(
    <div class="action-menu menu glass" role="menu" aria-label={cardTitle(card)} ref={el}>
      <div class="menu-head">
        <span class="menu-title">{cardTitle(card)}</span>
        <span class={`pill tone-${card.status}`}>{STATUS_LABEL[card.status]}</span>
      </div>
      {items.map((it) =>
        it.href ? (
          <a key={it.key} class="menu-item" role="menuitem" href={it.href} download onClick={onClose}>
            {it.icon}
            <span>{it.label}</span>
          </a>
        ) : (
          <button
            key={it.key}
            type="button"
            role="menuitem"
            class={`menu-item${it.tone ? ` tone-text-${it.tone}` : ''}`}
            onClick={() => {
              onClose()
              it.run?.()
            }}
          >
            {it.icon}
            <span>{it.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
