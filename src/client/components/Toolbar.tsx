import { useRef } from 'preact/hooks'
import { store } from '../store'
import { CloseIcon, DownloadIcon, SearchIcon, StackIcon } from './icons'

type Props = { query: string; onQuery(q: string): void; signedIn: boolean; onFiles(files: File[]): void }

export function Toolbar({ query, onQuery, signedIn, onFiles }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const needLogin = (e: Event) => {
    if (signedIn) return
    e.preventDefault()
    store.toast('ログイン後に使えます', { label: 'ログイン', run: () => store.login() })
  }
  return (
    <div class="toolbar narrow">
      <label class="search glass">
        <SearchIcon size={18} />
        <input
          ref={input}
          type="search"
          placeholder="検索"
          aria-label="検索"
          enterkeyhint="search"
          value={query}
          onInput={(e) => onQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Escape' && onQuery('')}
        />
        {query && (
          <button
            type="button"
            class="search-clear"
            aria-label="検索をクリア"
            onClick={() => {
              onQuery('')
              input.current?.focus()
            }}
          >
            <CloseIcon size={16} />
          </button>
        )}
      </label>
      <label class="icon-btn glass" aria-label="画像から一括取り込み" title="画像から一括取り込み" onClick={needLogin}>
        <StackIcon size={20} />
        <input
          type="file"
          id="batch-input"
          class="vh"
          accept="image/*"
          multiple
          tabIndex={-1}
          onChange={(e) => {
            const el = e.target as HTMLInputElement
            const files = Array.from(el.files ?? [])
            el.value = ''
            if (files.length) onFiles(files)
          }}
        />
      </label>
      <a class="icon-btn glass" id="csv-link" href="/api/export.csv" download aria-label="CSVを書き出し" title="CSVを書き出し" onClick={needLogin}>
        <DownloadIcon size={20} />
      </a>
    </div>
  )
}
