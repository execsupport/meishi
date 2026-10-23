import { useRef, useState } from 'preact/hooks'
import { FIELD_KEYS, FLOW, STATUS_LABEL, type CardFields, type FieldKey, type FlowStatus } from '../../shared/fields'
import { api, AuthError, type Card } from '../api'
import type { CardPatch } from '../store'
import { store } from '../store'
import { Fields } from './Fields'
import { ArchiveIcon, ContactIcon, RestoreIcon, SparkIcon } from './icons'
import { ImageZoom } from './ImageZoom'
import { Sheet } from './Sheet'

type Props = {
  card: Card
  signedIn: boolean
  onSave(p: CardPatch): void
  onArchive(): void
  onRestore(): void
  onClosed(): void
}

const pick = (c: Card) => Object.fromEntries(FIELD_KEYS.map((k) => [k, c[k]])) as CardFields

export function DetailSheet({ card, signedIn, onSave, onArchive, onRestore, onClosed }: Props) {
  const [fields, setFields] = useState<CardFields>(() => pick(card))
  const [status, setStatus] = useState(card.status)
  const [closing, setClosing] = useState(false)
  const [zoom, setZoom] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [filled, setFilled] = useState<Set<FieldKey>>(new Set())
  const after = useRef<'save' | 'archive' | 'restore' | 'none'>('none')

  const close = (a: 'save' | 'archive' | 'restore' | 'none') => {
    if (closing) return
    after.current = a
    setClosing(true)
  }
  const closed = () => {
    if (after.current === 'save' || after.current === 'archive') onSave({ ...fields, status: status === card.status ? undefined : status })
    if (after.current === 'archive') onArchive()
    if (after.current === 'restore') onRestore()
    onClosed()
  }

  const parse = async () => {
    const text = fields.memo.trim()
    if (!text) {
      store.toast('メモが空です')
      return
    }
    if (!signedIn) {
      store.toast('AIはログイン後に使えます', { label: 'ログイン', run: () => store.login() })
      return
    }
    setParsing(true)
    try {
      const r = await api.parseMemo(text)
      const next = { ...fields }
      const got = new Set<FieldKey>()
      for (const k of FIELD_KEYS) {
        const v = r.fields[k]
        if (v && !next[k] && k !== 'memo') {
          next[k] = v
          got.add(k)
        }
      }
      setFields(next)
      setFilled(got)
      store.toast(got.size ? `${got.size}項目を入力しました` : '追加できる項目はありません')
    } catch (e) {
      store.toast(e instanceof AuthError ? 'ログインが必要です' : '解析できませんでした')
    } finally {
      setParsing(false)
    }
  }

  return (
    <Sheet label="名刺の詳細" closing={closing} onClose={() => close('save')} onClosed={closed}>
      <div class="detail">
        {card.imageKey && (
          <button type="button" class="card-image" aria-label="画像を拡大" onClick={() => setZoom(true)}>
            <img src={api.imageUrl(card.imageKey)} alt="" />
          </button>
        )}
        {card.status === 'archived' ? (
          <div class="detail-status">
            <span class="pill tone-archived">{STATUS_LABEL.archived}</span>
          </div>
        ) : (
          <div class="seg" role="radiogroup" aria-label="ステータス">
            {FLOW.map((s: FlowStatus) => (
              <button key={s} type="button" role="radio" aria-checked={status === s} class={`seg-btn tone-${s}`} onClick={() => setStatus(s)}>
                <span class="dot" aria-hidden="true" />
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        )}
        <Fields value={fields} highlight={filled} onChange={(k, v) => setFields((f) => ({ ...f, [k]: v }))} />
        <div class="tools">
          <button type="button" class="chip-btn" onClick={parse} disabled={parsing} aria-busy={parsing}>
            <SparkIcon size={17} />
            <span>{parsing ? '解析中' : 'メモをAI解析'}</span>
          </button>
          {signedIn && !card.pending && (
            <a class="chip-btn" href={api.vcardUrl(card.id)} download>
              <ContactIcon size={17} />
              <span>vCard</span>
            </a>
          )}
          {card.status === 'archived' ? (
            <button type="button" class="chip-btn" onClick={() => close('restore')}>
              <RestoreIcon size={17} />
              <span>復元</span>
            </button>
          ) : (
            <button type="button" class="chip-btn tone-text-archived" onClick={() => close('archive')}>
              <ArchiveIcon size={17} />
              <span>アーカイブ</span>
            </button>
          )}
        </div>
      </div>
      <div class="sheet-actions">
        <button type="button" class="ghost-btn" onClick={() => close('none')}>
          閉じる
        </button>
        <button type="button" class="primary-btn" onClick={() => close('save')}>
          保存
        </button>
      </div>
      {zoom && card.imageKey && <ImageZoom src={api.imageUrl(card.imageKey)} onClosed={() => setZoom(false)} />}
    </Sheet>
  )
}
