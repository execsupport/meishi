import { createPortal } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'
import { animate, EASE_OUT, SPRING } from '../motion'
import { CloseIcon } from './icons'

/** Full-screen view of the card image. Tap anywhere or press Escape to close. */
export function ImageZoom({ src, onClosed }: { src: string; onClosed(): void }) {
  const el = useRef<HTMLDivElement>(null)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    const root = el.current!
    animate(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' })
    animate(root.querySelector('img')!, [{ transform: 'scale(.9)' }, { transform: 'scale(1)' }], { spring: SPRING.soft })
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setClosing(true)
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [])

  useEffect(() => {
    if (!closing) return
    animate(el.current!, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: EASE_OUT, fill: 'forwards' }).finished.then(onClosed)
  }, [closing])

  return createPortal(
    <div class="zoom" ref={el} role="dialog" aria-modal="true" aria-label="名刺画像" onClick={() => setClosing(true)}>
      <img src={src} alt="名刺画像" />
      <button type="button" class="zoom-close" aria-label="閉じる">
        <CloseIcon />
      </button>
    </div>,
    document.body,
  )
}
