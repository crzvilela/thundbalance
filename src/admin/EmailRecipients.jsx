import { useState } from 'react'
import { useAdminText } from './useAdminText'
import { EMAIL_PATTERN, MAX_EXTRA_RECIPIENTS } from './recipientsState'

export default function EmailRecipients({ value, onChange, disabled = false }) {
  const { t } = useAdminText()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')

  const add = (raw) => {
    const parts = raw.split(/[\s,;]+/).map(item => item.trim().toLowerCase()).filter(Boolean)
    if (!parts.length) return
    const next = [...value.extra]
    for (const part of parts) {
      if (!EMAIL_PATTERN.test(part)) { setError(`${t('em_invalid')}: ${part}`); setDraft(part); return }
      if (!next.includes(part)) next.push(part)
    }
    if (next.length > MAX_EXTRA_RECIPIENTS) { setError(t('em_max')); return }
    setError('')
    setDraft('')
    onChange({ ...value, extra: next })
  }

  const remove = (address) => onChange({ ...value, extra: value.extra.filter(item => item !== address) })

  return (
    <fieldset className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4" disabled={disabled}>
      <legend className="px-2 text-sm font-medium uppercase tracking-wider text-gray-400">{t('em_title')}</legend>
      <label className="mb-4 flex cursor-pointer items-center gap-3 text-base">
        <input type="checkbox" checked={value.toClient} onChange={event => onChange({ ...value, toClient: event.target.checked })} className="h-4 w-4 accent-emerald-400" />
        {t('em_client')}
      </label>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 focus-within:border-emerald-400/70">
        {value.extra.map(address => (
          <span key={address} className="flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 py-1 pl-3 pr-1.5 text-sm text-emerald-100">
            {address}
            <button type="button" onClick={() => remove(address)} aria-label={`${t('em_remove')} ${address}`}
              className="flex h-5 w-5 items-center justify-center rounded-full text-emerald-200/70 transition hover:bg-white/15 hover:text-white">×</button>
          </span>
        ))}
        <input
          type="email" value={draft} placeholder={value.extra.length ? '' : t('em_placeholder')} aria-label={t('em_add')}
          onChange={event => { setDraft(event.target.value); setError('') }}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ',' || event.key === ';') { event.preventDefault(); add(draft) }
            else if (event.key === 'Backspace' && !draft && value.extra.length) remove(value.extra[value.extra.length - 1])
          }}
          onBlur={() => draft.trim() && add(draft)}
          className="min-w-[10rem] flex-1 bg-transparent py-1 text-base outline-none placeholder:text-gray-600"
        />
      </div>
      <p className={`mt-2 text-sm ${error ? 'text-red-300' : 'text-gray-500'}`}>{error || t('em_hint')}</p>
    </fieldset>
  )
}
