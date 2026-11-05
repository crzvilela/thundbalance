import { useId, useState } from 'react'
import { useAdminText } from './useAdminText'
import { MAX_EXTRA, addRecipients } from './recipients'
import { Icon } from './ui'

// "Destinatarios" of an action that sends an email. The CLIENT is a fixed chip (it can not be removed: they always get the email);
// the admin can add more addresses below: Enter or comma makes a chip, × removes it, at most 5. The extra ones get the email in
// blind copy: the client does not see them. `value` is the list of extra addresses, `onChange(list)` receives the new one.
export default function RecipientsBox({ clientEmail, value, onChange, disabled = false, shareCalendar, onShareCalendar }) {
  const { t } = useAdminText()
  const id = useId()
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState('')           // '' | 'invalid' | 'max'
  const full = value.length >= MAX_EXTRA

  const add = (typed) => {
    if (!String(typed).trim()) return
    const result = addRecipients(value, typed, clientEmail)
    if (result.error) { setProblem(result.error); return }
    setProblem('')
    setDraft('')
    onChange(result.list)
  }
  const remove = (address) => { setProblem(''); onChange(value.filter(item => item !== address)) }
  const message = problem === 'invalid' ? t('rc_invalid') : problem === 'max' ? t('rc_max') : t('rc_hint')

  return (
    <fieldset className="mt-6 rounded-2xl bg-white/[0.035] p-4" disabled={disabled}>
      <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-gray-500">{t('rc_title')}</legend>
      <div className="flex flex-wrap gap-2">
        <span className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] py-1 pl-3 pr-3 text-sm text-gray-100" title={t('rc_client_fixed')}>
          <Icon name="clients" className="h-3.5 w-3.5 text-gray-400" />
          <span className="break-all">{clientEmail || '—'}</span>
          <span className="rounded-full bg-white/10 px-2 text-[11px] uppercase tracking-wide text-gray-400">{t('rc_client')}</span>
        </span>
        {value.map(address => (
          <span key={address} className="flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 py-1 pl-3 pr-1.5 text-sm text-emerald-100">
            <span className="break-all">{address}</span>
            <button type="button" onClick={() => remove(address)} aria-label={`${t('rc_remove')} ${address}`}
              className="flex h-7 w-7 items-center justify-center rounded-full text-emerald-200/70 transition hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400">×</button>
          </span>
        ))}
      </div>
      <label htmlFor={id} className="mb-1.5 mt-4 flex items-center justify-between gap-3 text-sm text-gray-300">
        <span>{t('rc_add')}</span>
        <span className={`tabular-nums text-xs ${full ? 'text-amber-300' : 'text-gray-500'}`} aria-live="polite">{value.length}/{MAX_EXTRA}</span>
      </label>
      <input
        id={id} type="email" autoComplete="off" inputMode="email" value={draft} disabled={full}
        aria-invalid={problem === 'invalid' ? true : undefined} aria-describedby={`${id}-hint`}
        placeholder={full ? t('rc_full') : t('rc_placeholder')}
        onChange={event => { setDraft(event.target.value); if (problem) setProblem('') }}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ',' || event.key === ';') { event.preventDefault(); add(draft) }
          else if (event.key === 'Backspace' && !draft && value.length) remove(value[value.length - 1])
        }}
        onBlur={() => add(draft)}
        className={`min-h-[44px] w-full rounded-xl border bg-black/40 px-4 text-base text-white outline-none transition placeholder:text-gray-600 focus:ring-2 disabled:opacity-60 ${
          problem === 'invalid' ? 'border-red-400/70 focus:ring-red-400/20' : 'border-white/10 focus:border-emerald-400/70 focus:ring-emerald-400/15'
        }`}
      />
      <p id={`${id}-hint`} className={`mt-2 text-sm ${problem ? 'text-red-300' : 'text-gray-500'}`} role={problem ? 'alert' : undefined}>{message}</p>
      {onShareCalendar && (
        <div className="mt-4 border-t border-white/10 pt-4">
          <label className="flex cursor-pointer items-center gap-3 text-base text-gray-100">
            <input type="checkbox" checked={shareCalendar !== false} onChange={event => onShareCalendar(event.target.checked)} className="h-4 w-4 accent-emerald-400" />
            {t('gc_share')}
          </label>
          <p className="mt-1 text-sm text-gray-500">{t('gc_share_hint')}</p>
        </div>
      )}
    </fieldset>
  )
}

// "Se enviará a: client@x.com · copia oculta: a@x.com, b@x.com" for the confirmation of the action.
export function SendsTo({ clientEmail, extra }) {
  const { t } = useAdminText()
  return (
    <p className="mt-3 text-sm text-gray-300" role="status">
      <span className="text-gray-500">{t('rc_sends_to')}</span> <strong className="break-all font-medium text-white">{clientEmail || '—'}</strong>
      {extra.length > 0 && <span> · {t('rc_hidden_copy')}: <span className="break-all">{extra.join(', ')}</span></span>}
    </p>
  )
}
