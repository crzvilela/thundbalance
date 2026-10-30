import { useMemo } from 'react'
import { useI18n } from '../../i18n/I18nContext'
import { buildPendingRequests } from '../../utils/pendingRequests'
import { formatDay, formatSentAt, formatShortDate, formatShortDay, formatTime } from '../../utils/sessionDates'
import { Spinner } from './SessionParts'
import { sessionLabel } from './sessionText'

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'

function Clock() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  )
}

// "Pending requests": everything the client asked for that still waits (a change of date, the pack, the trial session), as
// yellow cards ABOVE the sessions. When the studio proposed another date the card turns into the proposal, with Accept / Decline
// (the same answer as everywhere else: `onRespond(request, accept)`). Nothing is shown when there is nothing pending.
export default function PendingRequests({ data, onRespond, answering = null }) {
  const { t, locale } = useI18n()
  const { requestInfo, sessions, trial, packRequest, statusOf } = data
  const items = useMemo(
    () => buildPendingRequests({
      requests: requestInfo.items, sessions, trial, packRequest,
      isLive: session => !['cancelled', 'completed'].includes(statusOf(session))
    }),
    [requestInfo, sessions, trial, packRequest, statusOf]
  )
  if (items.length === 0) return null

  const at = (day, time) => `${formatShortDate(day, locale)} ${formatTime(time)}`

  const summary = (item) => {
    if (item.kind === 'reschedule') {
      const { request, session } = item
      return `${sessionLabel(t, session)}: ${at(request.original_date, request.original_time)} → ${at(request.requested_date, request.requested_time)}`
    }
    if (item.kind === 'pack') return `${item.pack.package || t('dash_assigned_plan')} · ${t('dash_sessions_week', { n: item.pack.sessions_per_week })}`
    return `${formatShortDay(item.trial.session_date, locale)} · ${formatTime(item.trial.session_time)}`
  }

  return (
    <section aria-labelledby="pending-requests-title" className="mb-6">
      <h2 id="pending-requests-title" style={{ fontFamily: 'Bebas Neue' }} className="mb-3 text-3xl text-amber-300">{t('ms_pr_title')}</h2>
      <ul className="space-y-3">
        {items.map(item => {
          const sent = formatSentAt(item.sentAt, locale)
          return (
            <li key={item.key} className="min-w-0 rounded-3xl border border-amber-400/40 bg-amber-400/[0.07] p-4 sm:p-6">
              <div className="flex items-start gap-3 sm:gap-4">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/10 text-amber-300"><Clock /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-300">{t(`ms_pr_type_${item.kind}`)}</p>
                    {sent && <p className="text-xs text-gray-400">{t('ms_pr_sent', { date: sent })}</p>}
                  </div>

                  {item.counter ? (
                    <div role="alert">
                      <p className="mt-1 text-lg font-semibold text-white">{t('ms_pr_counter_title')}</p>
                      <p className="mt-1 break-words text-base text-gray-100">{t('ms_proposal_text', { date: formatDay(item.request.counter_date, locale), time: formatTime(item.request.counter_time) })}</p>
                      <p className="mt-1 break-words text-sm text-gray-300">{summary(item)}</p>
                      {item.request.counter_deadline && (
                        <p className="mt-2 text-sm font-semibold text-amber-200">{t('ms_proposal_deadline', { date: formatDay(item.request.counter_deadline.slice(0, 10), locale), time: formatTime(item.request.counter_deadline.slice(11, 16)) })}</p>
                      )}
                      {item.request.admin_note && <p className="mt-2 break-words text-sm text-gray-300">{t('ms_proposal_note', { note: item.request.admin_note })}</p>}
                      <div className="mt-4 grid gap-3 sm:flex">
                        <button type="button" disabled={!!answering} onClick={() => onRespond(item.request, true)}
                          className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-400 px-6 py-2.5 text-sm font-semibold text-black transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60 ${FOCUS}`}>
                          {answering === item.request.id && <Spinner />}{t('ms_proposal_accept')}
                        </button>
                        <button type="button" disabled={!!answering} onClick={() => onRespond(item.request, false)}
                          className={`inline-flex min-h-[44px] items-center justify-center rounded-xl border border-white/25 px-6 py-2.5 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60 ${FOCUS}`}>
                          {t('ms_proposal_decline')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="mt-1 break-words text-base font-medium text-white first-letter:uppercase">{summary(item)}</p>
                      <p className="mt-2 inline-flex items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">
                        {item.kind === 'trial' && item.trial.status === 'approved' ? t('tt_status_approved') : t('ms_pr_status_pending')}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
