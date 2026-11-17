import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import TempPasswordNotice from '../components/TempPasswordNotice'
import AddAllMenu from '../components/sessions/AddAllMenu'
import PendingRequests from '../components/sessions/PendingRequests'
import SessionCalendarPanel from '../components/sessions/SessionCalendarPanel'
import SessionModal from '../components/sessions/SessionModal'
import NextSessionCard from '../components/sessions/NextSessionCard'
import { ProgressMeter } from '../components/sessions/PackProgress'
import { SessionRow, Spinner } from '../components/sessions/SessionParts'
import { useFeatures } from '../api/features'
import { groupSessions, useClientSessions } from '../hooks/useClientSessions'
import { useSessionActions } from '../hooks/useSessionActions'
import { useI18n } from '../i18n/I18nContext'
import { formatDay, formatTime } from '../utils/sessionDates'

// Trial goals/levels are stored in English; the index is the translation key (ts_goal_N / ts_level_N).
const TRIAL_GOALS = ['Body recomposition', 'Lose weight', 'Build muscle', 'Increase strength', 'Rehabilitation/injury recovery', 'Conditioning', 'Endurance', 'Tone/define', 'Improve mobility & flexibility', 'Increase energy']
const TRIAL_LEVELS = ['Beginner', 'Intermediate', 'Advanced']

const card = 'rounded-3xl border border-white/10 bg-white/[0.025]'
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'

function MySessions() {
  const { t, locale } = useI18n()
  const { clientCalendar } = useFeatures()      // CLIENT_CALENDAR_ENABLED: no calendar buttons or menus when off
  const data = useClientSessions()
  const { sessions, trial, workflow, trainerIds, requestInfo, loading, error, reload, today, rules, changeOf, statusOf } = data
  const { toast, setToast, showToast, open, setOpen, answering, loadTimes, cancel, requestChange, respondTo } = useSessionActions(data)

  const groups = useMemo(() => groupSessions(sessions, statusOf), [sessions, statusOf])

  const next = groups.upcoming[0]
  const others = groups.upcoming.slice(1)
  const total = groups.active.length
  const done = groups.past.length
  // the end date of the pack, when the client has one pack (with several the sessions below belong to different packs)
  const packEnd = workflow?.plans?.length === 1 ? String(workflow.plans[0].end_date || '').slice(0, 10) : ''
  const opened = open ? sessions.find(session => session.id === open.id) : null

  const trialCard = trial && (
    <section aria-label={t('tt_title')} className="mb-6 rounded-3xl border border-violet-400/30 bg-violet-400/[0.06] p-5 sm:p-7">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.3em] text-violet-300">{t('tt_title')}</p>
          <p className="max-w-xl text-sm text-gray-300">{t(`tt_text_${trial.status}`)}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${trial.status === 'confirmed' ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-amber-400/40 bg-amber-400/10 text-amber-300'}`}>{t(`tt_status_${trial.status}`)}</span>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t('tt_date'), formatDay(trial.session_date, locale)],
          [t('tt_time'), formatTime(trial.session_time)],
          [t('tt_trainer'), trial.trainer || t('tt_trainer_tbd')],
          [t('tt_experience'), TRIAL_LEVELS.includes(trial.experience) ? t('ts_level_' + TRIAL_LEVELS.indexOf(trial.experience)) : (trial.experience || '—')]
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <dt className="text-xs uppercase tracking-wider text-gray-400">{label}</dt>
            <dd className="mt-1 text-base first-letter:uppercase">{value}</dd>
          </div>
        ))}
        {trial.goal && (
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4 sm:col-span-2 lg:col-span-4">
            <dt className="text-xs uppercase tracking-wider text-gray-400">{t('tt_goal')}</dt>
            <dd className="mt-1 text-base">{trial.goal.split(',').map(goal => goal.trim()).filter(Boolean).map(goal => (TRIAL_GOALS.includes(goal) ? t('ts_goal_' + TRIAL_GOALS.indexOf(goal)) : goal)).join(', ')}</dd>
          </div>
        )}
      </dl>
    </section>
  )

  const hasAnything = sessions.length > 0 || !!trial

  return (
    <div className="min-h-screen bg-[#080a09] text-white">
      <Navbar />

      <main id="main" className="relative mx-auto max-w-6xl px-4 pb-24 pt-32 sm:px-5 md:pt-44">
        <div className="pointer-events-none absolute left-0 top-24 h-72 w-72 rounded-full bg-emerald-500/5 blur-3xl" />
        <TempPasswordNotice />

        <header className="relative mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">{t('ms_eyebrow')}</p>
            <h1 className="text-5xl md:text-6xl" style={{ fontFamily: 'Bebas Neue' }}>{t('ms_title')}</h1>
            <p className="mt-3 max-w-xl text-sm text-gray-300">{t('ms_intro')}</p>
          </div>
          <Link to="/dashboard" className={`inline-flex min-h-[44px] items-center rounded-xl border border-white/20 px-5 py-2.5 text-sm font-semibold transition hover:bg-white/10 ${FOCUS}`}>{t('ms_dashboard')}</Link>
        </header>

        {toast && (
          <div role={toast.tone === 'error' ? 'alert' : 'status'}
            className={`relative mb-6 flex items-start justify-between gap-4 rounded-2xl border px-5 py-4 text-sm ${toast.tone === 'error' ? 'border-red-400/40 bg-red-400/10 text-red-100' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'}`}>
            <span>{toast.text}</span>
            <button type="button" onClick={() => setToast(null)} aria-label={t('ms_dismiss')} className={`min-h-[32px] min-w-[32px] rounded ${FOCUS}`}>✕</button>
          </div>
        )}

        {error ? (
          <div role="alert" className={`${card} p-10 text-center`}>
            <p className="mb-5 text-gray-200">{t(error)}</p>
            <button type="button" onClick={reload} className={`min-h-[44px] rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black hover:bg-gray-200 ${FOCUS}`}>{t('pg_try_again')}</button>
          </div>
        ) : loading && sessions.length === 0 ? (
          <div role="status" className={`${card} flex items-center gap-3 p-10 text-gray-300`}><Spinner /> {t('ms_loading')}</div>
        ) : (
          <>
            {/* what still waits for an answer comes first: change requests, the pack request, the trial session */}
            <PendingRequests data={data} onRespond={respondTo} answering={answering} />

            {trialCard}

            {!hasAnything ? (
              <div className={`${card} p-8 text-center sm:p-12`}>
                <p style={{ fontFamily: 'Bebas Neue' }} className="mb-3 text-4xl">{t('ms_empty_title')}</p>
                <p className="mx-auto mb-7 max-w-md text-gray-300">{t('ms_empty_text')}</p>
                <Link to="/training-request" className={`inline-flex min-h-[44px] items-center rounded-xl bg-emerald-400 px-6 py-3 text-sm font-semibold text-black transition hover:bg-emerald-300 ${FOCUS}`}>{t('ms_book_cta')}</Link>
              </div>
            ) : (
              <div className="relative grid gap-6 lg:grid-cols-2">
                {/* list first (it is the main view on a phone), calendar below it */}
                <div className="space-y-6">
                  {next ? (
                    <NextSessionCard
                      session={next} status={statusOf(next)} showCalendar={clientCalendar} change={changeOf(next)} hours={rules.hours}
                      onOpen={(session) => setOpen({ id: session.id, mode: 'view' })}
                      onRequest={(session) => setOpen({ id: session.id, mode: 'request' })}
                      onCancel={(session) => setOpen({ id: session.id, mode: 'cancel' })}
                    />
                  ) : (
                    <section className={`${card} p-6`}>
                      <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">{t('ms_next_session')}</h2>
                      <p className="mt-3 text-gray-300">{t('ms_no_upcoming_card')}</p>
                      <Link to="/training-request" className={`mt-5 inline-flex min-h-[44px] items-center rounded-xl bg-emerald-400 px-6 py-3 text-sm font-semibold text-black transition hover:bg-emerald-300 ${FOCUS}`}>{t('ms_book_cta')}</Link>
                    </section>
                  )}

                  {others.length > 0 && (
                    <section className={`${card} p-5 sm:p-6`} aria-labelledby="upcoming-title">
                      <h2 id="upcoming-title" style={{ fontFamily: 'Bebas Neue' }} className="mb-4 text-3xl">{t('ms_upcoming_list')}</h2>
                      <ul className="space-y-3">
                        {others.map(session => <li key={session.id}><SessionRow session={session} status={statusOf(session)} onOpen={(item) => setOpen({ id: item.id, mode: 'view' })} /></li>)}
                      </ul>
                    </section>
                  )}

                  {total > 0 && (
                    <div className={`${card} p-5`}>
                      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">{t('ms_progress')}</p>
                      <ProgressMeter done={done} total={total} remaining={total - done} endDate={packEnd} label={t('ms_progress')} />
                    </div>
                  )}

                  {groups.past.length > 0 && (
                    <section className={`${card} p-5 sm:p-6`} aria-labelledby="done-title">
                      <h2 id="done-title" style={{ fontFamily: 'Bebas Neue' }} className="mb-4 text-3xl">{t('ms_completed_sessions')}</h2>
                      <ul className="space-y-3">
                        {groups.past.slice(0, 6).map(session => <li key={session.id}><SessionRow session={session} status="completed" onOpen={(item) => setOpen({ id: item.id, mode: 'view' })} /></li>)}
                      </ul>
                    </section>
                  )}
                </div>

                <div className="space-y-5 lg:sticky lg:top-28 lg:self-start">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-gray-300">{t('ms_view_calendar')}</h2>
                    {clientCalendar && <AddAllMenu onError={(text) => showToast('error', text)} />}
                  </div>
                  <div className={`${card} p-4 sm:p-6`}>
                    <SessionCalendarPanel data={data} onOpen={(session) => setOpen({ id: session.id, mode: 'view' })} />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {opened && (
        <SessionModal
          key={`${opened.id}-${open.mode}`}
          session={opened} status={statusOf(opened)} initialMode={open.mode} todayKey={today} showCalendar={clientCalendar}
          change={changeOf(opened)} hours={rules.hours} noteMax={requestInfo.note_max} answering={answering} trainerId={trainerIds[opened.trainer] || ''}
          onClose={() => setOpen(null)} onLoadTimes={loadTimes} onRequest={requestChange} onCancel={cancel} onRespond={respondTo}
        />
      )}
    </div>
  )
}

export default MySessions
