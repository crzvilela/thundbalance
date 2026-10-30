import { useState } from 'react'
import { useI18n } from '../../i18n/I18nContext'
import { formatDay, formatTime } from '../../utils/sessionDates'
import SessionCalendar from './SessionCalendar'
import { SessionRow } from './SessionParts'

// The month calendar of the client's sessions with the list of the selected day under it. Used by My Sessions and by the
// dashboard (the data comes from useClientSessions). A day with ONE session opens it straight away (`onOpen`); with several
// (or the trial session) the day's list is shown and each row opens its session.
export default function SessionCalendarPanel({ data, onOpen }) {
  const { t, locale } = useI18n()
  const { byDay, statusOf, trial, today } = data
  const [month, setMonth] = useState(() => { const date = new Date(); return new Date(date.getFullYear(), date.getMonth(), 1) })
  const [selectedDay, setSelectedDay] = useState(null)
  const trialDay = trial?.session_date || null
  const dayList = selectedDay ? (byDay.get(selectedDay) || []) : []

  const clickDay = (key, fromUser) => {
    if (!fromUser) { setSelectedDay(null); return }
    const list = byDay.get(key) || []
    if (list.length === 1 && key !== trialDay) { setSelectedDay(key); onOpen(list[0]); return }
    setSelectedDay(current => (current === key ? null : key))
  }

  return (
    <>
      <SessionCalendar
        month={month} onMonth={setMonth} sessionsByDay={byDay} statusOf={statusOf} trialDay={trialDay}
        selectedDay={selectedDay} onSelectDay={clickDay} todayKey={today}
      />
      {selectedDay && (
        <div className="mt-5 border-t border-white/10 pt-5">
          <h3 className="mb-3 text-sm font-semibold capitalize text-gray-200">{formatDay(selectedDay, locale)}</h3>
          {dayList.length === 0 && selectedDay !== trialDay ? (
            <p className="text-sm text-gray-400">{t('ms_no_session_day')}</p>
          ) : (
            <ul className="space-y-3">
              {selectedDay === trialDay && (
                <li className="rounded-2xl border border-violet-400/40 bg-violet-400/[0.06] p-4 text-sm">
                  <span className="font-medium text-violet-200">{t('tt_title')}</span> · {formatTime(trial.session_time)} · {trial.trainer || t('tt_trainer_tbd')}
                </li>
              )}
              {dayList.map(session => <li key={session.id}><SessionRow session={session} status={statusOf(session)} onOpen={onOpen} /></li>)}
            </ul>
          )}
        </div>
      )}
    </>
  )
}
