import { useEffect, useRef, useState } from 'react'
import { API_URL } from '../../config'
import { adminFetch } from '../../api/admin'
import { useAdminText } from '../useAdminText'
import { Button, Icon } from '../ui'
import { KINDS, NEUTRAL_COLOR } from './calendarConfig'

const CHECK = 'h-4 w-4 accent-emerald-400'

// Client search with suggestions (e-mails from the database), written in the box above the calendar.
function ClientSearch({ value, onChange }) {
  const { t } = useAdminText()
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  const [options, setOptions] = useState([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const box = useRef(null)

  // the box follows the URL when the value is set from outside (clear filters, a shared link)
  if (seen !== value) { setSeen(value); setText(value) }

  // suggestions while typing (a short pause after the last key)
  useEffect(() => {
    const query = text.trim()
    if (!open || query.length < 2 || query === value) return undefined
    let active = true
    const timer = window.setTimeout(async () => {
      try {
        const response = await adminFetch(`${API_URL}/admin/calendar/emails?q=${encodeURIComponent(query)}`)
        const list = response.ok ? await response.json() : []
        if (active) { setOptions(Array.isArray(list) ? list : []); setHighlight(-1) }
      } catch {
        if (active) setOptions([])
      }
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [text, open, value])

  useEffect(() => {
    const close = (event) => { if (box.current && !box.current.contains(event.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const choose = (email) => { onChange(email); setText(email); setOpen(false); setOptions([]) }
  const clear = () => { onChange(''); setText(''); setOptions([]) }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' && options.length) { event.preventDefault(); setHighlight(index => (index + 1) % options.length) }
    else if (event.key === 'ArrowUp' && options.length) { event.preventDefault(); setHighlight(index => (index <= 0 ? options.length - 1 : index - 1)) }
    else if (event.key === 'Enter') {
      event.preventDefault()
      if (highlight >= 0) choose(options[highlight])
      else if (text.trim().includes('@')) choose(text.trim().toLowerCase())
    } else if (event.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={box} className="relative w-full lg:w-80">
      <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
      <input
        type="search" value={text} placeholder={t('ac_search_ph')} aria-label={t('ac_search_label')}
        role="combobox" aria-expanded={open && options.length > 0} aria-autocomplete="list" aria-controls="ac-email-options"
        onChange={(event) => { setText(event.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
        className="w-full rounded-xl border border-white/10 bg-black/40 py-3 pl-10 pr-10 text-base text-white outline-none transition focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-400/15"
      />
      {(text || value) && (
        <button type="button" onClick={clear} aria-label={t('ac_clear_search')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white">
          <Icon name="close" className="h-4 w-4" />
        </button>
      )}
      {open && options.length > 0 && (
        <ul id="ac-email-options" role="listbox" className="absolute left-0 right-0 z-30 mt-2 max-h-72 overflow-y-auto rounded-xl border border-white/15 bg-[#0d1110] p-1 shadow-2xl shadow-black/60">
          {options.map((email, index) => (
            <li key={email} role="option" aria-selected={index === highlight}>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(email)}
                className={`block w-full truncate rounded-lg px-3 py-2.5 text-left text-sm ${index === highlight ? 'bg-emerald-400/15 text-white' : 'text-gray-200 hover:bg-white/10'}`}>{email}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function CalendarFilters({ filters, setFilters, clear, active, trainers }) {
  const { t } = useAdminText()
  const allTrainers = filters.trainers.length === 0
  const toggle = (id) => setFilters({ trainers: filters.trainers.includes(id) ? filters.trainers.filter(item => item !== id) : [...filters.trainers, id] })

  return (
    <div className="mb-4 space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-3 lg:justify-between">
        <ClientSearch value={filters.email} onChange={(email) => setFilters({ email })} />

        <div role="radiogroup" aria-label={t('ac_kind')} className="flex rounded-xl border border-white/10 bg-black/30 p-0.5">
          {KINDS.map(kind => (
            <button key={kind} type="button" role="radio" aria-checked={filters.kind === kind} onClick={() => setFilters({ kind })}
              className={`min-h-[40px] rounded-lg px-4 text-sm font-medium transition ${filters.kind === kind ? 'bg-emerald-400 text-black' : 'text-gray-300 hover:text-white'}`}>
              {t(`ac_kind_${kind}`)}
            </button>
          ))}
        </div>

        <label className="flex min-h-[40px] cursor-pointer items-center gap-2.5 text-sm text-gray-300">
          <input type="checkbox" role="switch" checked={filters.cancelled} onChange={(event) => setFilters({ cancelled: event.target.checked })} className={CHECK} />
          {t('ac_show_cancelled')}
        </label>

        <Button variant="secondary" onClick={clear} disabled={!active}>{t('ac_clear_filters')}</Button>
      </div>

      <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <legend className="sr-only">{t('ac_trainers')}</legend>
        <span aria-hidden="true" className="text-xs font-medium uppercase tracking-wider text-gray-500">{t('ac_trainers')}</span>
        <label className="flex min-h-[36px] cursor-pointer items-center gap-2 text-sm text-gray-200">
          <input type="checkbox" checked={allTrainers} onChange={() => setFilters({ trainers: [] })} className={CHECK} />
          {t('ac_all')}
        </label>
        {trainers.map(trainer => (
          <label key={trainer.id} className="flex min-h-[36px] cursor-pointer items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" checked={filters.trainers.includes(trainer.id)} onChange={() => toggle(trainer.id)} className={CHECK} />
            <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: trainer.color || NEUTRAL_COLOR }} />
            {trainer.name}
          </label>
        ))}
      </fieldset>
    </div>
  )
}
