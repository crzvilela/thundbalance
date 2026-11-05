import { useEffect, useId } from 'react'
import { BOOKABLE_DAYS, hoursOf, setTime, setTrainer, staleDays, toggleDay, trainersAt, trimTo } from '../../utils/packSchedule'

// The ONE component that chooses the weekly schedule of a pack, for the site (the client's request) and for the admin (new pack,
// new client, approving a request): one DAY per weekly session, each with ITS OWN hour (only free hours) and ITS OWN trainer
// (by default the same one on every day, with a list of the trainers free at that hour). There is no single hour for the pack.
//
//   <PackSchedulePicker
//     value={entries} onChange={setEntries} perWeek={2} availability={usePackAvailability(...)}
//     text={key => ...} dayLabel={day => ...} variant="site" | "admin" trainerRequired={false} disabled={busy}
//   />
//
// `value` is [{ weekday, time: 'HH:MM' | '', trainer_id: number | '' }] (utils/packSchedule.js). `text` gives the labels (ps_* keys,
// in the language of the site or of the admin). `availability` is the usePackAvailability() result.

const STYLES = {
  site: {
    label: 'block mb-2 text-gray-400',
    select: 'w-full bg-black border border-white/20 p-3 text-white disabled:opacity-50',
    chipOn: 'bg-green-600 border-green-600',
    chipOff: 'border-white/20',
    chip: 'min-h-[44px] px-4 py-2 rounded-lg border disabled:opacity-40',
    row: 'rounded-xl border border-white/10 p-4',
    hint: 'mt-2 text-sm text-gray-500',
    warn: 'mt-2 text-sm text-amber-300',
    day: 'mb-3 font-medium text-white'
  },
  admin: {
    label: 'mb-2.5 block text-sm font-medium uppercase tracking-wider text-gray-400',
    select: 'w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-base text-white outline-none transition focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-400/15 disabled:opacity-50',
    chipOn: 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200',
    chipOff: 'border-white/10 text-gray-400 hover:border-white/25 hover:text-white',
    chip: 'min-h-[44px] rounded-full border px-4 py-2 text-sm transition disabled:opacity-40',
    row: 'rounded-xl border border-white/10 bg-white/[0.02] p-4',
    hint: 'mt-1.5 text-sm text-gray-500',
    warn: 'mt-1.5 text-sm text-amber-300',
    day: 'mb-3 font-medium text-white'
  }
}

export default function PackSchedulePicker({
  value, onChange, perWeek, availability, text, dayLabel, variant = 'site', trainerRequired = true, disabled = false, legacy = false
}) {
  const style = STYLES[variant] || STYLES.site
  const id = useId()
  const data = availability?.data
  const optional = !trainerRequired

  // fewer sessions per week than days chosen: keep the first ones
  useEffect(() => {
    const trimmed = trimTo(value, perWeek)
    if (trimmed !== value) onChange(trimmed)
  }, [value, perWeek, onChange])

  const stale = new Set(staleDays(value, data))
  const left = Number(perWeek) - value.length

  return (
    <div>
      <span className={style.label}>{text('ps_days')}</span>
      <div className="flex flex-wrap gap-3" role="group" aria-label={text('ps_days')}>
        {BOOKABLE_DAYS.map(day => {
          const on = value.some(entry => entry.weekday === day)
          const offered = hoursOf(data, day).length > 0 || !data
          return (
            <button
              key={day} type="button" aria-pressed={on} disabled={disabled || !offered || (!on && left <= 0)}
              onClick={() => onChange(toggleDay(value, day, perWeek))}
              className={`${style.chip} ${on ? style.chipOn : style.chipOff}`}
            >
              {dayLabel(day)}
            </button>
          )
        })}
      </div>
      <p className={style.hint}>
        {left > 0 ? text('ps_pick').replace('{n}', String(left)) : text('ps_each_day')}
      </p>
      {legacy && <p className={style.warn}>{text('ps_old')}</p>}
      {availability?.error && (
        <p role="alert" className={style.warn}>
          {text('ps_error')}{' '}
          <button type="button" className="underline" onClick={availability.reload}>{text('ps_retry')}</button>
        </p>
      )}
      {availability?.loading && !data && <p role="status" className={style.hint}>{text('ps_loading')}</p>}

      {value.length > 0 && (
        <div className="mt-5 space-y-3">
          {value.map(entry => {
            const hours = hoursOf(data, entry.weekday)
            const free = entry.time ? trainersAt(data, entry.weekday, entry.time) : []
            const timeId = `${id}-${entry.weekday}-time`
            const trainerId = `${id}-${entry.weekday}-trainer`
            return (
              <div key={entry.weekday} className={style.row}>
                <p className={style.day}>{dayLabel(entry.weekday)}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor={timeId} className={style.label}>{text('ps_hour')}</label>
                    <select
                      id={timeId} value={entry.time} disabled={disabled || !hours.length}
                      onChange={event => onChange(setTime(value, entry.weekday, event.target.value, data, { optional }))}
                      className={style.select}
                    >
                      <option value="">{hours.length ? text('ps_choose_hour') : text('ps_no_hours')}</option>
                      {hours.map(item => <option key={item.time} value={item.time}>{item.time}</option>)}
                      {/* an hour that stopped being free stays visible (marked) until another is chosen */}
                      {entry.time && !hours.some(item => item.time === entry.time) && <option value={entry.time}>{entry.time} ({text('ps_taken')})</option>}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={trainerId} className={style.label}>{text('ps_trainer')}</label>
                    <select
                      id={trainerId} value={entry.trainer_id === '' ? '' : String(entry.trainer_id)} disabled={disabled || !entry.time}
                      onChange={event => onChange(setTrainer(value, entry.weekday, event.target.value))}
                      className={style.select}
                    >
                      <option value="">{optional ? text('ps_no_preference') : text('ps_choose_trainer')}</option>
                      {free.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                      {entry.trainer_id !== '' && !free.some(item => item.id === Number(entry.trainer_id)) && entry.time && (
                        <option value={entry.trainer_id}>{text('ps_taken')}</option>
                      )}
                    </select>
                  </div>
                </div>
                {stale.has(entry.weekday) && <p role="alert" className={style.warn}>{text('ps_stale')}</p>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
