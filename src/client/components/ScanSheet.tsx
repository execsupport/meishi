import { useEffect, useState } from 'preact/hooks'
import { DUPE_LABEL, emptyFields, FIELD_KEYS, findDupes, STATUS_LABEL, type CardFields, type DupeReason, type FieldKey } from '../../shared/fields'
import { api, cardSub, cardTitle, type Card } from '../api'
import { store, type ScanState } from '../store'
import { Fields } from './Fields'
import { Sheet } from './Sheet'

type Props = { scan: ScanState; cards: Card[]; onClosed(): void }
type Dupes = { list: { card: Card; reason: DupeReason }[]; pick: string }

/** Review queue for scanned cards: progress, editable result, duplicate check, save. */
export function ScanSheet({ scan, cards, onClosed }: Props) {
  const [closing, setClosing] = useState(false)
  const item = scan.items[0]
  const [fields, setFields] = useState<CardFields>(emptyFields)
  const [dupes, setDupes] = useState<Dupes | null>(null)
  const [loadedFor, setLoadedFor] = useState('')

  // Load the AI result into the form once per item.
  useEffect(() => {
    if (!item || item.state !== 'ready' || loadedFor === item.id) return
    const f = emptyFields()
    for (const k of FIELD_KEYS) f[k] = item.result?.fields[k] ?? ''
    setFields(f)
    setDupes(null)
    setLoadedFor(item.id)
  }, [item?.id, item?.state])

  const pending = scan.items.filter((i) => i.state === 'waiting' || i.state === 'working').length
  const processed = scan.total - pending
  const position = scan.total - scan.items.length + 1
  const filled = new Set(FIELD_KEYS.filter((k) => item?.result?.fields[k]) as FieldKey[])

  const finish = () => {
    setDupes(null)
    store.finishScanItem(item.id)
  }
  const create = () => {
    store.create(fields, item.result?.imageKey ?? null)
    finish()
  }
  const save = () => {
    const list = findDupes(fields, cards)
    if (list.length) setDupes({ list, pick: list[0].card.id })
    else create()
  }
  const merge = () => {
    if (!dupes) return
    store.merge(dupes.pick, fields, item.result?.imageKey ?? null)
    finish()
  }

  useEffect(() => {
    if (!item) setClosing(true)
  }, [item])

  return (
    <Sheet
      label="スキャン"
      closing={closing}
      onClose={() => setClosing(true)}
      onClosed={() => {
        store.cancelScan()
        onClosed()
      }}
    >
      <div class="scan-head">
        <span class="scan-title">スキャン</span>
        {item?.state === 'ready' && (
          <span class={`pill source ${item.result?.source === 'ai' ? 'tone-follow' : 'tone-inbox'}`}>{item.result?.source === 'ai' ? 'AI読み取り' : '手入力'}</span>
        )}
        <span class="scan-count" aria-label={`${scan.total}枚中${Math.min(position, scan.total)}枚目`}>
          {Math.min(position, scan.total)} / {scan.total}
        </span>
      </div>
      <div class="progress" role="progressbar" aria-label="読み取り" aria-valuemin={0} aria-valuemax={scan.total} aria-valuenow={processed}>
        <i style={{ width: `${(processed / scan.total) * 100}%` }} />
      </div>
      {item && (
        <div class="scan-body" key={item.id}>
          <div class={`scan-preview${item.state === 'ready' ? '' : ' busy'}`}>
            {item.preview ? <img src={item.preview} alt="名刺画像" /> : <span class="sk scan-sk" />}
          </div>

          {(item.state === 'waiting' || item.state === 'working') && (
            <div class="scan-wait" aria-busy="true">
              {[64, 48, 80, 56].map((w, i) => (
                <span class="sk" key={i} style={{ width: `${w}%` }} />
              ))}
              <span class="scan-wait-label">読み取り中</span>
            </div>
          )}

          {item.state === 'error' && (
            <div class="scan-error">
              <span>読み取れませんでした</span>
              <div class="sheet-actions">
                <button type="button" class="ghost-btn" onClick={finish}>
                  スキップ
                </button>
                <button type="button" class="primary-btn" onClick={() => store.retryScan(item.id)}>
                  再試行
                </button>
              </div>
            </div>
          )}

          {item.state === 'ready' && loadedFor === item.id && !dupes && (
            <>
              <Fields value={fields} highlight={filled} onChange={(k, v) => setFields((f) => ({ ...f, [k]: v }))} />
              <div class="sheet-actions">
                <button type="button" class="ghost-btn" onClick={finish}>
                  スキップ
                </button>
                <button type="button" class="primary-btn" onClick={save}>
                  保存
                </button>
              </div>
            </>
          )}

          {dupes && (
            <div class="dupes" role="group" aria-label="重複の可能性">
              <div class="dupes-head">重複の可能性</div>
              <ul class="dupe-list">
                {dupes.list.map(({ card, reason }) => (
                  <li key={card.id}>
                    <label class="dupe">
                      <input type="radio" name="dupe" checked={dupes.pick === card.id} onChange={() => setDupes({ ...dupes, pick: card.id })} />
                      <span class="thumb" aria-hidden="true">
                        {card.imageKey ? <img src={api.imageUrl(card.imageKey)} alt="" /> : <span class="mono">{cardTitle(card).slice(0, 1)}</span>}
                      </span>
                      <span class="meta">
                        <span class="title">{cardTitle(card)}</span>
                        <span class="sub">{cardSub(card) || card.email}</span>
                      </span>
                      <span class="dupe-pills">
                        <span class="pill tone-follow">{DUPE_LABEL[reason]}</span>
                        <span class={`pill tone-${card.status}`}>{STATUS_LABEL[card.status]}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div class="sheet-actions">
                <button type="button" class="ghost-btn" onClick={create}>
                  別として保存
                </button>
                <button type="button" class="primary-btn" onClick={merge}>
                  統合
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}
