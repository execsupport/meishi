import { useLayoutEffect, useRef } from 'preact/hooks'
import { FIELD_LABEL, FIELD_MAX, type CardFields, type FieldKey } from '../../shared/fields'

type Def = { k: FieldKey; wide?: boolean; type?: string; mode?: string; auto?: string }
const DEFS: Def[] = [
  { k: 'name', auto: 'off' },
  { k: 'nameKana', auto: 'off' },
  { k: 'company', wide: true, auto: 'off' },
  { k: 'department', auto: 'off' },
  { k: 'title', auto: 'off' },
  { k: 'email', wide: true, type: 'email', mode: 'email', auto: 'off' },
  { k: 'phone', type: 'tel', mode: 'tel', auto: 'off' },
  { k: 'mobile', type: 'tel', mode: 'tel', auto: 'off' },
  { k: 'address', wide: true, auto: 'off' },
  { k: 'website', wide: true, type: 'url', mode: 'url', auto: 'off' },
]

type Props = { value: CardFields; onChange(k: FieldKey, v: string): void; highlight?: Set<FieldKey> }

function Memo({ value, onInput }: { value: string; onInput(v: string): void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const t = ref.current!
    t.style.height = 'auto'
    t.style.height = `${Math.min(t.scrollHeight + 2, 260)}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      name="memo"
      rows={2}
      value={value}
      maxLength={FIELD_MAX.memo}
      onInput={(e) => onInput((e.target as HTMLTextAreaElement).value)}
    />
  )
}

/** The editable card form shared by the detail sheet and the scan review. */
export function Fields({ value, onChange, highlight }: Props) {
  return (
    <div class="fields">
      {DEFS.map((d) => (
        <label key={d.k} class={`field${d.wide ? ' wide' : ''}${highlight?.has(d.k) ? ' filled' : ''}`}>
          <span class="field-label">{FIELD_LABEL[d.k]}</span>
          <input
            name={d.k}
            type={d.type ?? 'text'}
            inputMode={d.mode as never}
            autoComplete={d.auto}
            autoCapitalize="off"
            spellcheck={false}
            value={value[d.k]}
            maxLength={FIELD_MAX[d.k]}
            onInput={(e) => onChange(d.k, (e.target as HTMLInputElement).value)}
          />
        </label>
      ))}
      <label class={`field wide${highlight?.has('memo') ? ' filled' : ''}`}>
        <span class="field-label">{FIELD_LABEL.memo}</span>
        <Memo value={value.memo} onInput={(v) => onChange('memo', v)} />
      </label>
    </div>
  )
}
