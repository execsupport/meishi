import { createPortal } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { User } from '../api'
import { animate, SPRING } from '../motion'
import { store, type Toast } from '../store'
import { GoogleG } from './icons'

export function Skeleton({ leaving }: { leaving: boolean }) {
  return (
    <div class={`skeleton${leaving ? ' out' : ''}`} data-skeleton aria-hidden="true">
      <div class="sk-bar narrow">
        <span class="sk sk-search" />
        <span class="sk sk-round" />
        <span class="sk sk-round" />
      </div>
      <div class="sk-tabs glass narrow">
        <span class="sk" />
        <span class="sk" />
        <span class="sk" />
        <span class="sk" />
      </div>
      <div class="sk-grid">
        {[
          [58, 82],
          [44, 70],
          [66, 52],
          [50, 76],
          [62, 48],
          [40, 68],
        ].map(([a, b], i) => (
          <div class="sk-card glass" key={i}>
            <span class="sk sk-thumb" />
            <span class="sk-lines">
              <span class="sk" style={{ width: `${a}%` }} />
              <span class="sk" style={{ width: `${b}%` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function LoginButton() {
  return (
    <a
      class="login-btn glass"
      href="/auth/google"
      onClick={(e) => {
        e.preventDefault()
        store.login()
      }}
    >
      <GoogleG />
      <span>Googleでログイン</span>
    </a>
  )
}

export function HeaderSlot({ user, ready }: { user: User | null; ready: boolean }) {
  const slot = document.getElementById('hdr-slot')
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    animate(menu.current!, [{ opacity: 0, transform: 'scale(.85) translateY(-6px)' }, { opacity: 1, transform: 'none' }], { spring: SPRING.bouncy })
    const off = (e: PointerEvent) => !(e.target as Element).closest('.hdr-slot') && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    addEventListener('pointerdown', off)
    addEventListener('keydown', esc)
    return () => {
      removeEventListener('pointerdown', off)
      removeEventListener('keydown', esc)
    }
  }, [open])

  if (!slot) return null
  let body
  if (!ready) body = <span class="sk sk-avatar" />
  else if (!user) body = <LoginButton />
  else
    body = (
      <>
        <button type="button" class="avatar" aria-label="アカウント" aria-expanded={open} onClick={() => setOpen(!open)}>
          {user.picture ? <img src={user.picture} alt="" referrerpolicy="no-referrer" /> : <span>{(user.name || user.email).slice(0, 1).toUpperCase()}</span>}
        </button>
        {open && (
          <div class="menu glass" ref={menu} role="menu">
            <div class="menu-email">{user.email}</div>
            <a class="menu-item" role="menuitem" href="/api/export.csv" download onClick={() => setOpen(false)}>
              CSVを書き出し
            </a>
            <button
              type="button"
              role="menuitem"
              class="menu-item"
              onClick={() => {
                setOpen(false)
                store.logout()
              }}
            >
              ログアウト
            </button>
          </div>
        )}
      </>
    )
  return createPortal(body, slot)
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div class="toast glass" key={t.id}>
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.run()
                store.dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
