// Inline SVG icons (no icon font, no emoji).
import type { ComponentChildren } from 'preact'

type P = { size?: number }
const S = ({ size = 20, children }: P & { children: ComponentChildren }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    {children}
  </svg>
)

export const SearchIcon = (p: P) => (
  <S {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </S>
)
export const CloseIcon = (p: P) => (
  <S {...p}>
    <path d="M7 7l10 10M17 7 7 17" />
  </S>
)
export const StackIcon = (p: P) => (
  <S {...p}>
    <rect x="3.5" y="8" width="13" height="10" rx="2.5" />
    <path d="M7.5 5h10A2.5 2.5 0 0 1 20 7.5V14" />
    <circle cx="8" cy="12.3" r="1.6" />
    <path d="m4 17 4-3 3 2.2 2.5-1.7 3 2.5" />
  </S>
)
export const DownloadIcon = (p: P) => (
  <S {...p}>
    <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5" />
    <path d="M5 19h14" />
  </S>
)
export const ArchiveIcon = (p: P) => (
  <S {...p}>
    <rect x="3.5" y="4.5" width="17" height="4.5" rx="1.5" />
    <path d="M5 9v8.5A2 2 0 0 0 7 19.5h10a2 2 0 0 0 2-2V9" />
    <path d="M10 13h4" />
  </S>
)
export const RestoreIcon = (p: P) => (
  <S {...p}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v4h4" />
  </S>
)
export const ArrowRightIcon = (p: P) => (
  <S {...p}>
    <path d="M5 12h14m0 0-5-5m5 5-5 5" />
  </S>
)
export const ArrowLeftIcon = (p: P) => (
  <S {...p}>
    <path d="M19 12H5m0 0 5-5m-5 5 5 5" />
  </S>
)
export const OpenIcon = (p: P) => (
  <S {...p}>
    <rect x="4" y="5" width="16" height="14" rx="3" />
    <path d="M8 10h8M8 14h5" />
  </S>
)
export const ContactIcon = (p: P) => (
  <S {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="3" />
    <circle cx="9" cy="11" r="2.2" />
    <path d="M5.8 16.2c.6-1.6 1.8-2.4 3.2-2.4s2.6.8 3.2 2.4M14.5 10h3M14.5 13.5h2.5" />
  </S>
)
export const SparkIcon = (p: P) => (
  <svg viewBox="0 0 24 24" width={p.size ?? 20} height={p.size ?? 20} aria-hidden="true">
    <path
      fill="currentColor"
      d="M11 2.5c.3 0 .5.2.6.5l1 3.3a4 4 0 0 0 2.6 2.6l3.3 1c.6.2.6 1 0 1.2l-3.3 1a4 4 0 0 0-2.6 2.6l-1 3.3c-.2.6-1 .6-1.2 0l-1-3.3a4 4 0 0 0-2.6-2.6l-3.3-1c-.6-.2-.6-1 0-1.2l3.3-1A4 4 0 0 0 9.4 6.3l1-3.3c.1-.3.3-.5.6-.5Zm7 12c.2 0 .3.1.4.3l.4 1.3c.2.6.6 1 1.2 1.2l1.3.4c.4.1.4.6 0 .8l-1.3.4c-.6.2-1 .6-1.2 1.2l-.4 1.3c-.1.4-.6.4-.8 0l-.4-1.3c-.2-.6-.6-1-1.2-1.2l-1.3-.4c-.4-.1-.4-.6 0-.8l1.3-.4c.6-.2 1-.6 1.2-1.2l.4-1.3c.1-.2.2-.3.4-.3Z"
    />
  </svg>
)
export const MemoIcon = (p: P) => (
  <S {...p}>
    <path d="M6 4.5h8.5L19 9v10.5H6z" />
    <path d="M14 4.5V9h5M9 13h6M9 16.5h4" />
  </S>
)
export const ImageIcon = (p: P) => (
  <S {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="3" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="m4.5 17.5 4.5-4 3.5 3 2.5-2 4.5 3.5" />
  </S>
)
export const GoogleG = () => (
  <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
)
