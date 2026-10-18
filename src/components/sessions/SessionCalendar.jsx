import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nContext'
import { formatDay, formatMonth, formatTime, weekdayNames } from '../../utils/sessionDates'

const pad = (value) => String(value).padStart(2, '0')
const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const parseKey = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (key, amount) => { const date = parseKey(key); date.setDate(date.getDate() + amount); return keyOf(date) }

const DOT = { change_pending: 'bg-amber-400', upcoming: 'bg-emerald-400', completed: 'bg-gray-400', cancelled: 'bg-red-400', rescheduled: 'bg-amber-400', trial: 'bg-violet-400' }
const LEGEND = ['upcoming', 'rescheduled', 'completed', 'cancelled']

// Month grid (Monday first, language of the site). Arrow keys move between days,
// PageUp / PageDown change month; only one day is in the tab order at a time.
export default function SessionCalendar({ month, onMonth, sessionsByDay, statusOf, trialDay, selectedDay, onSelectDay, todayKey }) {
  const { t, locale } = useI18n()
  const [focusKey, setFocusKey] = useState(null)
  const refs = useRef(new Map())
  const pendingFocus = useRef(false)

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const offset = (first.getDay() + 6) % 7
    const total = Math.ceil((offset + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7) * 7
    return Array.from({ length: total }, (_, index) => {
      const date = new Date(month.getFullYear(), month.getMonth(), index - offset + 1)
      return { key: keyOf(date), day: date.getDate(), inMonth: date.getMonth() === month.getMonth() }
    })
  }, [month])

  const inMonth = (key) => cells.some(cell => cell.key === key && cell.inMonth)
  const tabKey = [focusKey, selectedDay, todayKey].find(key => key && inMonth(key)) || keyOf(new Date(month.getFullYear(), month.getMonth(), 1))

  useEffect(() => {
    if (pendingFocus.current && focusKey) {
      refs.current.get(focusKey)?.focus()
      pendingFocus.current = false
    }
  }, [focusKey, month])

  const move = (key) => {
    const date = parseKey(key)
    if (date.getMonth() !== month.getMonth() || date.getFullYear() !== month.getFullYear()) {
      onMonth(new Date(date.getFullYear(), date.getMonth(), 1))
    }
    pendingFocus.current = true
    setFocusKey(key)
  }

  const onKeyDown = (event, key) => {
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
    if (steps[event.key]) { event.preventDefault(); move(addDays(key, steps[event.key])) }
    else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      const date = parseKey(key)
      date.setMonth(date.getMonth() + (event.key === 'PageUp' ? -1 : 1))
      move(keyOf(date))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const weekday = (parseKey(key).getDay() + 6) % 7
      move(addDays(key, event.key === 'Home' ? -weekday : 6 - weekday))
    }
  }

  const shiftMonth = (amount) => onMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1))
  const arrow = 'min-h-[44px] min-w-[44px] rounded-lg px-3 py-2 text-gray-300 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400'

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 aria-live="polite" style={{ fontFamily: 'Bebas Neue' }} className="text-3xl capitalize sm:text-4xl">{formatMonth(month, locale)}</h2>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={t('ms_prev_month')} onClick={() => shiftMonth(-1)} className={arrow}>←</button>
          <button type="button" onClick={() => { const now = new Date(); onMonth(new Date(now.getFullYear(), now.getMonth(), 1)); onSelectDay(todayKey, false) }}
            className="min-h-[44px] rounded-lg border border-white/20 px-3 text-sm transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400">{t('ms_today')}</button>
          <button type="button" aria-label={t('ms_next_month')} onClick={() => shiftMonth(1)} className={arrow}>→</button>
        </div>
      </div>

      <div role="group" aria-label={t('ms_calendar_label')} className="grid grid-cols-7 gap-1 text-center sm:gap-1.5">
        {weekdayNames(locale).map(name => <div key={name} className="pb-2 text-[11px] uppercase tracking-wider text-gray-400">{name}</div>)}
        {cells.map(cell => {
          const list = sessionsByDay.get(cell.key) || []
          const hasTrial = cell.key === trialDay
          const isSelected = cell.key === selectedDay
          const isToday = cell.key === todayKey
          const statuses = list.map(statusOf)
          const live = statuses.filter(status => status !== 'cancelled')
          const label = `${formatDay(cell.key, locale)}${list.length ? `: ${list.map(session => `${formatTime(session.time)} ${t(`ms_status_${statusOf(session)}`)}`).join(', ')}` : ''}${hasTrial ? `, ${t('ms_legend_trial')}` : ''}`
          return (
            <button
              key={cell.key} type="button" aria-label={label} aria-current={isToday ? 'date' : undefined} aria-pressed={isSelected}
              tabIndex={cell.key === tabKey ? 0 : -1}
              ref={(node) => { if (node) refs.current.set(cell.key, node); else refs.current.delete(cell.key) }}
              onClick={() => { setFocusKey(cell.key); onSelectDay(cell.key, true) }}
              onKeyDown={(event) => onKeyDown(event, cell.key)}
              className={`relative flex aspect-square min-h-[40px] flex-col items-center justify-center rounded-xl border text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 ${
                isSelected ? 'border-emerald-400 bg-emerald-400/15'
                  : live.some(status => status === 'upcoming') ? 'border-emerald-400/25 bg-emerald-400/[0.07] hover:bg-emerald-400/15'
                    : isToday ? 'border-transparent hover:bg-white/5' : 'border-transparent hover:border-white/15 hover:bg-white/5'
              } ${isToday ? 'ring-2 ring-inset ring-emerald-400/70' : ''} ${cell.inMonth ? '' : 'opacity-30'} ${live.length === 0 && statuses.length > 0 ? 'opacity-70' : ''}`}
            >
              <span className={`tabular-nums ${statuses.length && statuses.every(status => status === 'cancelled') ? 'text-red-300/80 line-through' : ''} ${statuses.length && statuses.every(status => status === 'completed') ? 'text-gray-400' : ''}`}>{cell.day}</span>
              {(list.length > 0 || hasTrial) && (
                <span className="mt-0.5 flex gap-0.5" aria-hidden="true">
                  {hasTrial && <span className={`h-1.5 w-1.5 rounded-full ${DOT.trial}`} />}
                  {list.slice(0, 3).map(session => <span key={session.id} className={`h-1.5 w-1.5 rounded-full ${DOT[statusOf(session)]}`} />)}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-300" aria-label={t('ms_calendar_label')}>
        {LEGEND.map(key => (
          <li key={key} className="flex items-center gap-2"><span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${DOT[key]}`} />{t(`ms_status_${key}`)}</li>
        ))}
        {trialDay && <li className="flex items-center gap-2"><span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${DOT.trial}`} />{t('ms_legend_trial')}</li>}
      </ul>
    </div>
  )
}
