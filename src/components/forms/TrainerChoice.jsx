import { useEffect, useId, useState } from 'react'
import { loadAvailableForWeekdays, loadAvailableTrainers, loadTrainers } from '../../api/trainers'
import { useI18n } from '../../i18n/I18nContext'

// The trainer of a request (trial, weekly pack, change of date) and what to do when that trainer is not free.
//
//   <TrainerChoice value={id|''} onChange={setId} date="YYYY-MM-DD" | weekdays={['Monday', ...]} time="HH:MM" onStatus={...} />
//
// - showSelect (default): an optional list "No preference + every trainer". Without it (change of date) the trainer is the
//   session's own and the component only appears when that trainer is busy at the new hour.
// - When the chosen trainer is not free at that day and hour: "{Name} is not available at that time" and a list of the
//   trainers who ARE free; picking one makes it the trainer of the request. If nobody is free, say so.
// - A weekly pack (several days) is checked day by day: the trainer has to be free on every chosen day at that time.
// - The server checks again when the request is sent (409 with the alternatives); `refreshKey` makes this check run again.
// onStatus: 'idle' | 'checking' | 'ok' | 'busy' | 'none'. The page keeps its send button off while it is busy or none.

export default function TrainerChoice({
  value, onChange, date, weekdays, time, excludeSessionId, showSelect = true, refreshKey = 0, onStatus,
  disabled = false, labelClass = 'mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400',
  selectClass = 'w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3.5 text-white outline-none transition focus:border-emerald-400/70'
}) {
  const { t } = useI18n()
  const id = useId()
  const [trainers, setTrainers] = useState([])
  const [answer, setAnswer] = useState({ key: '', list: null })      // what the server said for the slot `key`
  const weekdayKey = (weekdays || []).join(',')

  useEffect(() => { loadTrainers().then(setTrainers) }, [])

  // The slot is checked only when there is a trainer and a day and hour; the answer is kept with the slot it belongs to, so an
  // old answer is never taken for the new slot ("checking" until the new one arrives).
  const ready = Boolean(value && time && (date || weekdayKey))
  const slotKey = ready ? `${value}|${date || weekdayKey}|${time}|${excludeSessionId || ''}|${refreshKey}` : ''

  useEffect(() => {
    if (!slotKey) return undefined
    let current = true
    const asked = weekdayKey ? loadAvailableForWeekdays({ weekdays: weekdayKey.split(','), time }) : loadAvailableTrainers({ date, time, excludeSessionId })
    asked
      .then(list => { if (current) setAnswer({ key: slotKey, list }) })
      .catch(() => { if (current) setAnswer({ key: slotKey, list: null }) })       // the server asleep or offline: it checks again when sending
    return () => { current = false }
  }, [slotKey, weekdayKey, date, time, excludeSessionId])

  const free = answer.key === slotKey ? answer.list : null
  let status = 'idle'
  if (ready) {
    if (answer.key !== slotKey) status = 'checking'
    else if (answer.list === null) status = 'ok'
    else if (answer.list.some(item => item.id === Number(value))) status = 'ok'
    else status = answer.list.length ? 'busy' : 'none'
  }

  useEffect(() => { onStatus?.(status) }, [status, onStatus])

  const nameOf = (trainerId) => trainers.find(item => item.id === Number(trainerId))?.name || ''

  return (
    <div>
      {showSelect && (
        <>
          <label htmlFor={id} className={labelClass}>{t('tc_label')}<span className="ml-1 normal-case tracking-normal text-gray-500">{t('tc_optional')}</span></label>
          <select id={id} value={value || ''} disabled={disabled} onChange={event => onChange(event.target.value ? Number(event.target.value) : '')} className={selectClass}>
            <option value="">{t('tc_no_preference')}</option>
            {trainers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          {!value && <p className="mt-2 text-sm text-gray-500">{t('tc_hint')}</p>}
        </>
      )}

      {status === 'checking' && value && (
        <p role="status" className="mt-2 flex items-center gap-2 text-sm text-gray-400">
          <span aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-emerald-400" />{t('tc_checking')}
        </p>
      )}

      {status === 'busy' && (
        <div role="alert" className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/[0.07] p-4">
          <p className="text-sm font-medium text-amber-100">{t('tc_unavailable', { name: nameOf(value) || t('tc_that_trainer') })}</p>
          <label htmlFor={`${id}-alt`} className="mt-3 block text-xs font-medium uppercase tracking-wider text-gray-300">{t('tc_available_label')}</label>
          <select id={`${id}-alt`} value="" disabled={disabled} onChange={event => event.target.value && onChange(Number(event.target.value))} className={`mt-2 ${selectClass}`}>
            <option value="">{t('tc_choose')}</option>
            {(free || []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
      )}

      {status === 'none' && (
        <p role="alert" className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/[0.07] px-4 py-3 text-sm text-amber-100">{t('tc_none')}</p>
      )}
    </div>
  )
}
