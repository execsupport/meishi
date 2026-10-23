import { useLayoutEffect, useRef } from 'preact/hooks'
import { STATUS_LABEL, STATUSES, type Status } from '../../shared/fields'
import { animate, SPRING } from '../motion'
import { ArchiveIcon } from './icons'

// Short labels so four tabs fit at 390px without truncation; pills use the full label.
const TAB_LABEL: Record<Status, string> = { inbox: '未整理', follow: 'フォロー', done: '完了', archived: 'アーカイブ' }

type Props = { value: Status; counts: Record<Status, number>; onChange(s: Status): void }

export function Tabs({ value, counts, onChange }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const ind = useRef<HTMLSpanElement>(null)
  const last = useRef<{ l: number; w: number } | null>(null)

  // Underline that stretches across both tabs mid-flight, then springs into place.
  useLayoutEffect(() => {
    const place = () => {
      const btn = wrap.current?.querySelector<HTMLElement>(`.tab[data-status="${value}"]`)
      const el = ind.current
      if (!btn || !el) return
      const inset = Math.min(18, btn.offsetWidth * 0.18)
      const next = { l: btn.offsetLeft + inset, w: btn.offsetWidth - inset * 2 }
      const prev = last.current
      el.style.transform = `translateX(${next.l}px)`
      el.style.width = `${next.w}px`
      if (prev && (prev.l !== next.l || prev.w !== next.w)) {
        const l = Math.min(prev.l, next.l)
        const span = Math.max(prev.l + prev.w, next.l + next.w) - l
        animate(
          el,
          [
            { transform: `translateX(${prev.l}px)`, width: `${prev.w}px` },
            { transform: `translateX(${l}px)`, width: `${span}px`, offset: 0.35 },
            { transform: `translateX(${next.l}px)`, width: `${next.w}px` },
          ],
          { spring: SPRING.soft },
        )
      }
      last.current = next
    }
    place()
    const ro = new ResizeObserver(() => {
      last.current = null
      place()
    })
    if (wrap.current) ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [value])

  const onKey = (e: KeyboardEvent) => {
    const i = STATUSES.indexOf(value)
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const n = STATUSES[(i + (e.key === 'ArrowRight' ? 1 : STATUSES.length - 1)) % STATUSES.length]
      onChange(n)
      wrap.current?.querySelector<HTMLElement>(`.tab[data-status="${n}"]`)?.focus()
    }
  }

  return (
    <div class="tabs glass narrow" role="tablist" aria-label="ステータス" ref={wrap} onKeyDown={onKey}>
      <span class="tab-ind" ref={ind} aria-hidden="true" />
      {STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          role="tab"
          class={`tab tone-${s}`}
          data-status={s}
          aria-selected={s === value}
          aria-label={s === 'archived' ? STATUS_LABEL[s] : undefined}
          tabIndex={s === value ? 0 : -1}
          onClick={() => onChange(s)}
        >
          {s === 'archived' ? (
            <>
              <ArchiveIcon size={17} />
              <span class="label label-wide">{STATUS_LABEL[s]}</span>
            </>
          ) : (
            <span class="label">{TAB_LABEL[s]}</span>
          )}
          <span class="count" key={`${s}-${counts[s]}`}>
            {counts[s]}
          </span>
        </button>
      ))}
    </div>
  )
}
