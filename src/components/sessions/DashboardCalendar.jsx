import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../../i18n/I18nContext'
import { useClientSessions } from '../../hooks/useClientSessions'
import SessionCalendarPanel from './SessionCalendarPanel'
import SessionModal from './SessionModal'

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'

function Skeleton() {
  return (
    <div role="status" aria-label="…" className="animate-pulse">
      <div className="mb-4 flex items-center justify-between"><div className="h-8 w-40 rounded-lg bg-white/10" /><div className="h-8 w-28 rounded-lg bg-white/10" /></div>
      <div className="grid grid-cols-7 gap-1.5">{Array.from({ length: 35 }, (_, index) => <div key={index} className="aspect-square min-h-[40px] rounded-xl bg-white/[0.06]" />)}</div>
    </div>
  )
}

// The client's month calendar on the dashboard: read only. A day opens the details of its session (date, hour, trainer,
// x/y and state); "View all" goes to My Sessions, where they can ask for a change. Own loading, empty and error states
// (the server can take a moment to wake up).
export default function DashboardCalendar({ className = '' }) {
  const { t } = useI18n()
  const data = useClientSessions()
  const { sessions, trial, loading, error, reload, statusOf, changeOf, rules, today } = data
  const [openId, setOpenId] = useState(null)
  const opened = openId ? sessions.find(session => session.id === openId) : null

  return (
    <section aria-labelledby="dash-cal-title" className={`rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6 ${className}`}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 id="dash-cal-title" style={{ fontFamily: 'Bebas Neue' }} className="text-4xl">{t('dash_cal_title')}</h2>
        <Link to="/my-sessions" className={`inline-flex min-h-[44px] items-center rounded-lg border border-white/20 px-5 py-2.5 text-sm font-semibold transition hover:bg-white/10 ${FOCUS}`}>{t('dash_cal_view_all')} <span aria-hidden="true" className="ml-2">→</span></Link>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-amber-500/40 p-6 text-center">
          <p className="mb-4 text-gray-200">{t(error)}</p>
          <button type="button" onClick={reload} className={`min-h-[44px] rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-gray-200 ${FOCUS}`}>{t('pg_try_again')}</button>
        </div>
      ) : loading && sessions.length === 0 ? (
        <Skeleton />
      ) : sessions.length === 0 && !trial ? (
        <p className="py-6 text-center text-gray-400">{t('dash_cal_empty')}</p>
      ) : (
        <SessionCalendarPanel data={data} onOpen={(session) => setOpenId(session.id)} />
      )}

      {opened && (
        <SessionModal
          key={opened.id} readOnly session={opened} status={statusOf(opened)} todayKey={today}
          change={changeOf(opened)} hours={rules.hours} onClose={() => setOpenId(null)}
        />
      )}
    </section>
  )
}
