import { Link } from 'react-router-dom'
import { useI18n } from '../../i18n/I18nContext'
import { formatDay, formatTime, googleCalendarUrl } from '../../utils/sessionDates'
import { PackLabel, StatusBadge, FOCUS } from './SessionParts'
import { changeReason, eventDetails } from './sessionText'

const BUTTON = `inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition ${FOCUS}`

// The card of the client's NEXT session, shared by My Sessions and the dashboard: the day in big letters, the hour and the trainer, the state, and the
// actions that exist (add to Google Calendar, ask for a change of date, cancel) with the same rules (the change is on up to N hours before: the line under
// the buttons says why it is off). Without the optional props it is exactly the card My Sessions always had.
//   countdown  "in 2 days" / "today at 10:00" / "tomorrow" (already translated): a quiet line under the hour
//   typeLabel  "Individual session" / "Dual session"
//   allLink    where "View all my sessions" leads (the dashboard shows it; My Sessions is already there)
//   heading    the small title over the card (default "Next session")
export default function NextSessionCard({ session, status, onOpen, onRequest, onCancel, showCalendar = false, change, hours, countdown, typeLabel, allLink, heading }) {
  const { t, locale } = useI18n()
  const canRequest = change?.state === 'available'
  return (
    <section aria-labelledby="next-session-title" className="rounded-3xl border border-emerald-400/25 bg-emerald-400/[0.06] p-5 sm:p-7">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="next-session-title" className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">{heading || t('ms_next_session')}</h2>
        <StatusBadge status={status} />
      </div>
      <p style={{ fontFamily: 'Bebas Neue' }} className="text-4xl capitalize leading-tight sm:text-5xl">{formatDay(session.date, locale, { year: false })}</p>
      <p className="mt-2 text-lg text-gray-200">
        <span className="tabular-nums">{formatTime(session.time)}</span> · {session.trainer || '—'}
        {session.number && <span className="ml-2 rounded-full border border-white/20 px-2.5 py-0.5 text-sm text-gray-300">{session.number}</span>}
      </p>
      {(countdown || typeLabel) && (
        <p className="mt-1 text-sm text-gray-300">
          {countdown && <span className="font-medium text-emerald-200">{countdown}</span>}
          {countdown && typeLabel && ' · '}
          {typeLabel}
        </p>
      )}
      {session.packName && <p className="mt-2"><PackLabel name={session.packName} /></p>}
      <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
        {showCalendar && (
          <a href={googleCalendarUrl(session, eventDetails(t, session, locale))} target="_blank" rel="noopener noreferrer"
            className={`${BUTTON} bg-emerald-400 text-black hover:bg-emerald-300`}>{t('ms_add_google')}</a>
        )}
        <button type="button" onClick={() => onRequest(session)} disabled={!canRequest}
          className={`${BUTTON} border border-white/25 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50`}>{t('ms_request_change')}</button>
        <button type="button" onClick={() => onCancel(session)}
          className={`${BUTTON} border border-red-400/50 text-red-300 hover:bg-red-500 hover:text-white`}>{t('ms_cancel_session')}</button>
      </div>
      <p className="mt-3 text-sm text-gray-400">{changeReason(t, change, hours)}</p>
      <div className="flex flex-wrap items-center gap-x-5">
        <button type="button" onClick={() => onOpen(session)} className={`mt-2 rounded text-sm text-gray-300 underline underline-offset-4 hover:text-white ${allLink ? 'inline-flex min-h-[44px] items-center' : ''} ${FOCUS}`}>{t('ms_details')}</button>
        {allLink && <Link to={allLink} className={`mt-2 inline-flex min-h-[44px] items-center rounded text-sm text-emerald-300 hover:text-emerald-200 ${FOCUS}`}>{t('ns_view_all')} <span aria-hidden="true" className="ml-1.5">→</span></Link>}
      </div>
    </section>
  )
}
