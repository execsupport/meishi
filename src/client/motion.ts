// Real spring curves via CSS linear() easing, generated from a damped spring simulation.
const supportsLinear = typeof CSS !== 'undefined' && CSS.supports?.('animation-timing-function', 'linear(0, 1)')

export type Spring = { easing: string; duration: number }

function spring(stiffness: number, damping: number, mass = 1): Spring {
  const dt = 1 / 120
  let x = 0
  let v = 0
  let t = 0
  const pts: number[] = [0]
  while (t < 3) {
    const f = -stiffness * (x - 1) - damping * v
    v += (f / mass) * dt
    x += v * dt
    t += dt
    pts.push(x)
    if (Math.abs(x - 1) < 0.002 && Math.abs(v) < 0.02) break
  }
  const step = Math.max(1, Math.floor(pts.length / 48))
  const sampled = pts.filter((_, i) => i % step === 0)
  sampled.push(1)
  const easing = supportsLinear
    ? `linear(${sampled.map((p) => +p.toFixed(4)).join(', ')})`
    : 'cubic-bezier(.34,1.56,.64,1)'
  return { easing, duration: Math.round(t * 1000) }
}

export const SPRING = {
  bouncy: spring(320, 18),
  soft: spring(210, 24),
  snappy: spring(520, 38),
}
export const EASE_OUT = 'cubic-bezier(.2,.8,.2,1)'

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function animate(el: Element, keyframes: Keyframe[], opts: KeyframeAnimationOptions & { spring?: Spring }) {
  const { spring: s, ...rest } = opts
  const o: KeyframeAnimationOptions = s ? { easing: s.easing, duration: s.duration, ...rest } : rest
  if (reducedMotion()) o.duration = Math.min(Number(o.duration ?? 0), 120)
  return el.animate(keyframes, o)
}

export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* unsupported */
  }
}

// Specular highlight that follows the pointer on glass surfaces.
export function bindSheen(el: HTMLElement) {
  const move = (e: PointerEvent) => {
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }
  el.addEventListener('pointermove', move, { passive: true })
  el.addEventListener('pointerdown', move, { passive: true })
  return () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerdown', move)
  }
}
