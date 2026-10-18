import { useState } from 'react'
import { downloadSessionIcs } from '../../api/calendarFeed'
import { useModalFocus } from '../../hooks/useModalFocus'
import { useI18n } from '../../i18n/I18nContext'
import { formatDay, formatTime, googleCalendarUrl } from '../../utils/sessionDates'
import { Spinner, StatusBadge } from './SessionParts'
import { eventDetails, sessionLabel } from './sessionText'

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'
const BUTTON = `inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition sm:w-auto ${FOCUS}`

// "Session details": date, hour, trainer, status, add to calendar, reschedule (once) and cancel
// (with a confirmation). The page owns the requests; the modal only asks for them.
export default function SessionModal({ session, status, initialMode = 'view', todayKey, onClose, onLoadTimes, onReschedule, onCancel }) {
  const { t, locale } = useI18n()
  const [mode, setMode] = useState(initialMode)           // view | reschedule | cancel
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')
  const [times, setTimes] = useState([])
  const [loadingTimes, setLoadingTimes] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)

  const close = () => { if (!working) onClose() }
  const ref = useModalFocus(true, close)

  const changeable = status === 'upcoming' || status === 'rescheduled'
  const addable = changeable                               // not for cancelled (nor for finished) sessions
  const used = session.rescheduled

  const pickDate = async (value) => {
    setNewDate(value); setNewTime(''); setTimes([]); setError('')
    if (!value) return
    setLoadingTimes(true)
    try {
      const list = await onLoadTimes(session, value)
      setTimes(list)
      if (!list.length) setError(t('ms_err_no_times'))
    } catch (problem) {
      setError(t(problem.message))
    } finally {
      setLoadingTimes(false)
    }
  }

  const run = async (action) => {
    if (working) return                                    // no double clicks
    setWorking(true); setError('')
    try {
      await action()
    } catch (problem) {
      setError(t(problem.message))
      setWorking(false)
    }
  }

  const downloadOne = async () => {
    if (downloading) return
    setDownloading(true); setError('')
    try {
      await downloadSessionIcs(session.id)
    } catch {
      setError(t('ms_err_download'))
    } finally {
      setDownloading(false)
    }
  }

  const facts = [[t('ms_date'), formatDay(session.date, locale)], [t('ms_time'), formatTime(session.time)], [t('ms_trainer'), session.trainer || '—']]

  return (
    <div onClick={close} className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        ref={ref} role="dialog" aria-modal="true" aria-labelledby="session-modal-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0b0e0d] p-5 shadow-2xl outline-none sm:rounded-3xl sm:p-8"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">{t('ms_details')}</p>
            <h2 id="session-modal-title" style={{ fontFamily: 'Bebas Neue' }} className="text-4xl sm:text-5xl">{sessionLabel(t, session)}</h2>
          </div>
          <button type="button" onClick={close} aria-label={t('ms_close')} className={`min-h-[44px] min-w-[44px] rounded-lg p-2 text-gray-300 transition hover:bg-white/10 hover:text-white ${FOCUS}`}>✕</button>
        </div>

        <dl className="grid gap-3 sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <dt className="text-xs uppercase tracking-wider text-gray-400">{label}</dt>
              <dd className="mt-1 text-lg first-letter:uppercase">{value}</dd>
            </div>
          ))}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <dt className="text-xs uppercase tracking-wider text-gray-400">{t('ms_status')}</dt>
            <dd className="mt-2"><StatusBadge status={status} /></dd>
          </div>
        </dl>

        {mode === 'view' && addable && (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center">
              <a href={googleCalendarUrl(session, eventDetails(t, session, locale))} target="_blank" rel="noopener noreferrer"
                className={`${BUTTON} bg-emerald-400 text-black hover:bg-emerald-300`}>{t('ms_add_google')}</a>
              <button type="button" onClick={downloadOne} disabled={downloading}
                className={`${BUTTON} border border-white/25 hover:bg-white/10 disabled:cursor-wait disabled:opacity-60`}>
                {downloading && <Spinner />}{t('ms_download_ics')}
              </button>
            </div>
            <p className="mt-3 text-sm text-gray-400">{t('ms_added_warning')}</p>
          </div>
        )}

        {mode === 'reschedule' && (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <p className="mb-4 text-sm text-gray-300">{t('ms_reschedule_rule')}</p>
            <label className="block">
              <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">{t('ms_new_date')}</span>
              <input type="date" min={todayKey} value={newDate} onChange={(event) => pickDate(event.target.value)} disabled={working}
                style={{ colorScheme: 'dark' }} className={`min-h-[44px] w-full rounded-xl border border-white/20 bg-black/40 px-4 py-3 text-white outline-none transition focus:border-emerald-400/70 ${FOCUS}`} />
            </label>
            {newDate && (
              <div className="mt-5">
                <p className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-400">{t('ms_new_time')}{loadingTimes && <Spinner />}</p>
                <div className="flex flex-wrap gap-2">
                  {times.map(time => (
                    <button key={time} type="button" onClick={() => setNewTime(time)} aria-pressed={newTime === time}
                      className={`min-h-[44px] rounded-xl border px-4 py-2 text-sm tabular-nums transition ${FOCUS} ${newTime === time ? 'border-emerald-400 bg-emerald-400 font-semibold text-black' : 'border-white/20 hover:border-white/50'}`}>{time}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {mode === 'cancel' && (
          <div role="alertdialog" aria-labelledby="session-cancel-title" className="mt-5 rounded-2xl border border-red-400/30 bg-red-400/10 p-5">
            <p id="session-cancel-title" className="font-semibold text-red-100">{t('ms_cancel_ask')}</p>
            <p className="mt-2 text-sm text-red-100/90 first-letter:uppercase">{t('ms_cancel_when', { date: formatDay(session.date, locale), time: formatTime(session.time) })}</p>
            <p className="mt-1 text-sm text-red-100/80">{t('ms_cancel_irreversible')}</p>
          </div>
        )}

        {error && <p role="alert" className="mt-5 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}

        {changeable && mode === 'view' && (
          <>
            <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
              <button type="button" onClick={() => { setMode('reschedule'); setError('') }} disabled={used}
                className={`${BUTTON} border border-emerald-400/50 text-emerald-300 hover:bg-emerald-400 hover:text-black disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-emerald-300`}>{t('ms_reschedule')}</button>
              <button type="button" onClick={() => { setMode('cancel'); setError('') }}
                className={`${BUTTON} border border-red-400/50 text-red-300 hover:bg-red-500 hover:text-white`}>{t('ms_cancel_session')}</button>
            </div>
            <p className="mt-3 text-sm text-gray-400">{used ? t('ms_reschedule_used') : t('ms_reschedule_rule')}</p>
          </>
        )}

        {mode === 'reschedule' && (
          <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
            <button type="button" disabled={!newDate || !newTime || working} onClick={() => run(() => onReschedule(session, newDate, newTime))}
              className={`${BUTTON} bg-emerald-400 text-black hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50`}>
              {working && <Spinner />}{working ? t('ms_working') : t('ms_confirm_time')}
            </button>
            <button type="button" onClick={() => { setMode('view'); setError('') }} disabled={working} className={`${BUTTON} border border-white/25 hover:bg-white/10 disabled:opacity-50`}>{t('ms_back')}</button>
          </div>
        )}

        {mode === 'cancel' && (
          <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
            <button type="button" disabled={working} onClick={() => run(() => onCancel(session))}
              className={`${BUTTON} bg-red-500 text-white hover:bg-red-400 disabled:cursor-wait disabled:opacity-60`}>
              {working && <Spinner />}{working ? t('ms_working') : t('ms_yes_cancel')}
            </button>
            <button type="button" onClick={() => { setMode('view'); setError('') }} disabled={working} className={`${BUTTON} border border-white/25 hover:bg-white/10 disabled:opacity-50`}>{t('ms_keep')}</button>
          </div>
        )}

        {!changeable && mode === 'view' && (
          <div className="mt-6"><button type="button" onClick={close} className={`${BUTTON} border border-white/25 hover:bg-white/10`}>{t('ms_close')}</button></div>
        )}
      </div>
    </div>
  )
}
