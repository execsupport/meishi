import type { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import { animate, EASE_OUT, SPRING } from '../motion'

type Props = { label: string; onClose(): void; children: ComponentChildren; closing: boolean; onClosed(): void }

/** Bottom sheet with spring entrance and drag-to-dismiss. */
export function Sheet({ label, onClose, children, closing, onClosed }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const back = useRef<HTMLDivElement>(null)
  const drag = useRef({ y0: 0, dy: 0, id: -1, t0: 0 })

  useLayoutEffect(() => {
    animate(el.current!, [{ transform: 'translateY(105%)' }, { transform: 'translateY(0)' }], { spring: SPRING.soft })
    animate(back.current!, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' })
    const prev = document.activeElement as HTMLElement | null
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.zoom, .action-menu') && onClose()
    addEventListener('keydown', esc)
    return () => {
      removeEventListener('keydown', esc)
      prev?.focus?.({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    if (!closing) return
    const cur = getComputedStyle(el.current!).transform
    Promise.all([
      animate(el.current!, [{ transform: cur === 'none' ? 'translateY(0)' : cur }, { transform: 'translateY(105%)' }], { duration: 260, easing: EASE_OUT, fill: 'forwards' }).finished,
      animate(back.current!, [{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-in', fill: 'forwards' }).finished,
    ]).then(onClosed)
  }, [closing])

  const down = (e: PointerEvent) => {
    drag.current = { y0: e.clientY, dy: 0, id: e.pointerId, t0: e.timeStamp }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent) => {
    if (e.pointerId !== drag.current.id) return
    const dy = e.clientY - drag.current.y0
    drag.current.dy = dy > 0 ? dy : dy * 0.2
    el.current!.style.transform = `translateY(${drag.current.dy}px)`
  }
  const up = (e: PointerEvent) => {
    if (e.pointerId !== drag.current.id) return
    drag.current.id = -1
    const { dy, t0 } = drag.current
    const v = dy / Math.max(1, e.timeStamp - t0)
    if (dy > 110 || v > 0.7) onClose()
    else {
      const from = el.current!.style.transform
      el.current!.style.transform = ''
      animate(el.current!, [{ transform: from || 'none' }, { transform: 'translateY(0)' }], { spring: SPRING.bouncy })
    }
  }

  return (
    <>
      <div class="backdrop" ref={back} onClick={onClose} />
      <div class="sheet glass" role="dialog" aria-modal="true" aria-label={label} ref={el}>
        <div class="grabber" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <span />
        </div>
        {children}
      </div>
    </>
  )
}
