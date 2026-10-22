import { useI18n } from '../../i18n/I18nContext'
import { formatDay, formatShortDay, formatTime, googleCalendarUrl } from '../../utils/sessionDates'
import { changeReason, eventDetails } from './sessionText'

// Small pieces of the My Sessions page: status badge, list row, "next session" card.

const BADGE = {
  upcoming: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  completed: 'border-white/20 bg-white/5 text-gray-300',
  cancelled: 'border-red-400/40 bg-red-400/10 text-red-300',
  rescheduled: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  change_pending: 'border-amber-400/40 bg-amber-400/10 text-amber-300'
}

export function StatusBadge({ status, className = '' }) {
  const { t } = useI18n()
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold ${BADGE[status]} ${className}`}>
      {t(`ms_status_${status}`)}
    </span>
  )
}

export function Spinner() {
  return <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'

export function SessionRow({ session, status, onOpen }) {
  const { t, locale } = useI18n()
  return (
    <button
      type="button" onClick={() => onOpen(session)}
      aria-label={t('ms_open_session', { date: `${formatDay(session.date, locale)}, ${formatTime(session.time)}` })}
      className={`group flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-black/30 p-3.5 text-left transition hover:border-emerald-400/40 hover:bg-emerald-400/[0.04] sm:gap-4 sm:p-4 ${FOCUS} ${status === 'completed' || status === 'cancelled' ? 'opacity-70' : ''}`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-medium capitalize ${status === 'cancelled' ? 'line-through decoration-red-300/60' : ''}`}>
          {formatShortDay(session.date, locale)} · {formatTime(session.time)}
        </span>
        <span className="block truncate text-sm text-gray-400">
          {session.trainer || '—'}{session.number ? ` · ${session.number}` : ''}
        </span>
      </span>
      <StatusBadge status={status} className="shrink-0" />
      <span aria-hidden="true" className="text-gray-500 transition group-hover:translate-x-0.5 group-hover:text-emerald-300">→</span>
    </button>
  )
}

const BUTTON = `inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition ${FOCUS}`

export function NextSessionCard({ session, status, onOpen, onRequest, onCancel, showCalendar = false, change, hours }) {
  const { t, locale } = useI18n()
  const canRequest = change?.state === 'available'
  return (
    <section aria-labelledby="next-session-title" className="rounded-3xl border border-emerald-400/25 bg-emerald-400/[0.06] p-5 sm:p-7">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="next-session-title" className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">{t('ms_next_session')}</h2>
        <StatusBadge status={status} />
      </div>
      <p style={{ fontFamily: 'Bebas Neue' }} className="text-4xl capitalize leading-tight sm:text-5xl">{formatDay(session.date, locale, { year: false })}</p>
      <p className="mt-2 text-lg text-gray-200">
        <span className="tabular-nums">{formatTime(session.time)}</span> · {session.trainer || '—'}
        {session.number && <span className="ml-2 rounded-full border border-white/20 px-2.5 py-0.5 text-sm text-gray-300">{session.number}</span>}
      </p>
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
      <button type="button" onClick={() => onOpen(session)} className={`mt-2 rounded text-sm text-gray-300 underline underline-offset-4 hover:text-white ${FOCUS}`}>{t('ms_details')}</button>
    </section>
  )
}
