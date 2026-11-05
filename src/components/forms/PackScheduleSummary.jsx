import { plannedSessions, trainerNames } from '../../utils/packSchedule'

// What the chosen schedule means: one line per training day (day, hour, trainer) and, when the start date is known, the dates of
// the sessions as x/y (the first ones; the server works the same list out when saving). Shared by the site and the admin.
//
//   <PackScheduleSummary value={entries} availability={data} start="2026-01-12" total={12} text={...} dayLabel={...} locale="es-ES" />

export default function PackScheduleSummary({ value, availability, start = '', total = 0, text, dayLabel, locale = 'en-GB', limit = 12, className = '' }) {
  const complete = value.filter(entry => entry.time)
  if (!complete.length) return null
  const names = trainerNames(availability)
  const nameOf = (trainer) => (trainer === '' || trainer == null ? text('ps_no_preference') : names.get(Number(trainer)) || '')
  const sessions = start ? plannedSessions(start, complete, total) : []
  return (
    <div className={className}>
      <p className="mb-2 text-sm font-medium uppercase tracking-wider text-gray-400">{text('ps_summary')}</p>
      <ul className="space-y-1 text-sm">
        {complete.map(entry => (
          <li key={entry.weekday}>
            <strong>{dayLabel(entry.weekday)}</strong> · {entry.time} · {nameOf(entry.trainer_id)}
          </li>
        ))}
      </ul>
      {sessions.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-gray-400" aria-label={text('ps_dates')}>
          {sessions.slice(0, limit).map(item => (
            <li key={item.number}>
              {item.number} · {new Date(`${item.date}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · {item.time} · {nameOf(item.trainer_id)}
            </li>
          ))}
          {sessions.length > limit && <li>+{sessions.length - limit} …</li>}
        </ul>
      )}
    </div>
  )
}
