import { animate, bindSheen, haptic, SPRING } from './motion'

// The composer is static HTML (see index.html + boot.js) so it is live before the app
// mounts. Here the app takes over its submit and camera input without re-rendering it.
const form = () => document.getElementById('composer') as HTMLFormElement
const area = () => document.getElementById('memo') as HTMLTextAreaElement

export function clearComposer() {
  const ta = area()
  ta.value = ''
  ta.style.height = 'auto'
  try {
    localStorage.removeItem('meishi.draft')
  } catch {
    /* blocked */
  }
  ta.focus({ preventScroll: true })
}

export function shakeComposer() {
  animate(form(), [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], {
    duration: 320,
    easing: 'ease-out',
  })
}

/** A glass copy of the memo text drops from the composer into the list. */
export function dropFromComposer(text: string, target: Element | null) {
  const ta = area()
  const from = ta.getBoundingClientRect()
  const ghost = document.createElement('div')
  ghost.className = 'drop-ghost glass'
  ghost.textContent = text
  ghost.style.left = `${from.left - 2}px`
  ghost.style.top = `${from.top}px`
  ghost.style.width = `${Math.max(120, Math.min(from.width, 420))}px`
  document.body.appendChild(ghost)
  const to = target?.getBoundingClientRect()
  const dy = to ? to.top - from.top : 90
  animate(
    ghost,
    [
      { transform: 'translateY(0) scale(1)', opacity: 1, filter: 'blur(0)' },
      { transform: `translateY(${dy * 0.55}px) scale(1.02)`, opacity: 0.9, offset: 0.6 },
      { transform: `translateY(${dy}px) scale(.98)`, opacity: 0, filter: 'blur(2px)' },
    ],
    { duration: 460, easing: 'cubic-bezier(.3,.7,.2,1)' },
  ).finished.finally(() => ghost.remove())
}

export function bindComposer(h: { onSubmit(text: string): void; onFiles(files: File[]): void }) {
  const f = form()
  const ta = area()
  const send = document.getElementById('send-btn') as HTMLButtonElement
  const input = document.getElementById('scan-input') as HTMLInputElement

  const submit = (e: SubmitEvent) => {
    e.preventDefault()
    const text = ta.value.trim()
    if (!text) {
      shakeComposer()
      return
    }
    haptic(10)
    animate(send, [{ transform: 'scale(1)' }, { transform: 'scale(.82)' }, { transform: 'scale(1)' }], { spring: SPRING.bouncy })
    h.onSubmit(text)
  }
  const change = () => {
    const files = Array.from(input.files ?? [])
    input.value = ''
    if (files.length) h.onFiles(files)
  }

  f.addEventListener('submit', submit)
  input.addEventListener('change', change)
  const unSheen = bindSheen(f)
  return () => {
    f.removeEventListener('submit', submit)
    input.removeEventListener('change', change)
    unSheen()
  }
}
