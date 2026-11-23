import { useCallback, useEffect, useMemo, useState } from 'react'
import { signOut } from 'firebase/auth'
import { Link, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import TempPasswordNotice from '../components/TempPasswordNotice'
import CalendarSubscribe from '../components/CalendarSubscribe'
import DashboardCalendar from '../components/sessions/DashboardCalendar'
import NextSessionCard from '../components/sessions/NextSessionCard'
import { MyPacks } from '../components/sessions/PackProgress'
import SessionModal from '../components/sessions/SessionModal'
import { PackLabel, SessionToast } from '../components/sessions/SessionParts'
import { Button, Card, EmptyState, PageHeader, Skeleton, SkeletonCard } from '../components/ui'
import { useFeatures } from '../api/features'
import { auth } from '../firebase/auth'
import { API_URL } from '../config'
import { groupSessions, useClientSessions } from '../hooks/useClientSessions'
import { useSessionActions } from '../hooks/useSessionActions'
import { useI18n } from '../i18n/I18nContext'
import { countdownOf, countdownText } from '../utils/sessionCountdown'
import { formatDayTime } from '../utils/sessionDates'

const MAX_UPCOMING = 5         // "Upcoming sessions": the first one is the big card above, then these

// The client's home: what to do next (the next session, or the one clear action when there is none), how the pack is going, the next sessions and the
// calendar. The rules of a session (change of date up to N hours before, cancel) are the ones of My Sessions: the same card and the same actions.
function Dashboard() {
  const navigate = useNavigate()
  const { t, locale } = useI18n()
  const { clientCalendar } = useFeatures()      // CLIENT_CALENDAR_ENABLED
  const [workflow, setWorkflow] = useState(null)
  const [error, setError] = useState('')
  const [calendarOpen, setCalendarOpen] = useState(false)      // a phone shows the calendar closed: the list above already says what is next
  const data = useClientSessions()
  const actions = useSessionActions(data)
  const { sessions, trial, trainerIds, requestInfo, today, now, rules, changeOf, statusOf } = data

  const loadWorkflow = useCallback(async () => {
    const user = auth.currentUser
    if (!user) { navigate('/login'); return }
    try {
      const token = await user.getIdToken()
      const response = await fetch(`${API_URL}/client/workflow`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error(response.status === 404 ? 'dash_err_profile' : 'dash_err_status')
      setWorkflow(await response.json())
      setError('')
    } catch (err) { setError(err.message || 'dash_err_generic') }
  }, [navigate])

  useEffect(() => {
    const refresh = () => loadWorkflow()
    // first load on the next tick, so the effect itself does not set state synchronously
    const first = window.setTimeout(refresh, 0)
    const timer = window.setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [loadWorkflow])

  const logout = async () => { await signOut(auth); navigate('/login') }
  const state = workflow?.state
  const packs = workflow?.plans || []

  // the sessions that have not happened yet, soonest first: the first one is the big card, the next ones the short list
  const groups = useMemo(() => groupSessions(sessions, statusOf), [sessions, statusOf])
  const next = groups.upcoming[0]
  const others = groups.upcoming.slice(1, 1 + MAX_UPCOMING)
  const nextPack = next ? packs.find(pack => String(pack.id) === String(next.packId)) : null
  const countdown = (() => { const text = countdownText(countdownOf(next, now)); return text ? t(text.key, text.values) : '' })()
  const opened = actions.open ? sessions.find(session => session.id === actions.open.id) : null

  const user = auth.currentUser
  const name = (user?.displayName || '').trim().split(/\s+/)[0] || String(user?.email || '').split('@')[0]
  const sessionsLoading = data.loading && sessions.length === 0

  // the zone "Your next session": the card, or ONE clear action
  const nextZone = (() => {
    if (data.error) {
      return <EmptyState role="alert" text={t(data.error)} action={<Button variant="light" onClick={data.reload}>{t('pg_try_again')}</Button>} />
    }
    if (sessionsLoading) return <div role="status" aria-label={t('dash_loading')}><SkeletonCard className="h-64" /></div>
    if (next) {
      return (
        <NextSessionCard
          session={next} status={statusOf(next)} showCalendar={clientCalendar} change={changeOf(next)} hours={rules.hours}
          heading={t('dash_next_title')} countdown={countdown} allLink="/my-sessions"
          typeLabel={nextPack ? t(nextPack.session_type === 'dual' ? 'ns_type_dual' : 'ns_type_individual') : ''}
          onOpen={(session) => actions.setOpen({ id: session.id, mode: 'view' })}
          onRequest={(session) => actions.setOpen({ id: session.id, mode: 'request' })}
          onCancel={(session) => actions.setOpen({ id: session.id, mode: 'cancel' })}
        />
      )
    }
    return (
      <EmptyState
        icon={<span className="text-4xl">◷</span>} title={t('dash_none_title')} text={t('dash_none_text')}
        action={<Button as={Link} to="/training-request" variant="primary" size="lg" fullOnMobile className="mt-6">{t('ms_book_cta')}</Button>}
      />
    )
  })()

  return <div className="min-h-dvh bg-black text-white"><Navbar />
    <main id="main" className="max-w-7xl mx-auto px-4 sm:px-6 pt-28 sm:pt-36 pb-20">
      <TempPasswordNotice />
      <PageHeader
        eyebrow={t('dash_client_space')} title={t('dash_hello', { name })} subtitle={t('dash_sub')}
        actions={<Button variant="secondary" onClick={logout}>{t('dash_logout')}</Button>}
      />
      <SessionToast toast={actions.toast} onClose={() => actions.setToast(null)} />

      {!workflow && !error && (
        <div role="status" aria-label={t('dash_loading')} className="space-y-6">
          <SkeletonCard className="h-64" />
          <Card plain className="space-y-4 p-6"><Skeleton className="h-6 w-40" /><Skeleton className="h-3 w-full" /><Skeleton className="h-4 w-2/3" /></Card>
          <Card plain className="space-y-3 p-6"><Skeleton className="h-6 w-48" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></Card>
        </div>
      )}
      {error && (
        <EmptyState role="alert" className="border-amber-500/40" title={t('dash_unavailable')} text={t(error)}
          action={<Button variant="light" className="mt-5" onClick={loadWorkflow}>{t('pg_try_again')}</Button>} />
      )}

      {workflow && state === 'new' && (
        <section aria-label={t('dash_next_title')} className="mb-8">
          <EmptyState
            icon={<span className="text-4xl">◷</span>} title={t('dash_nopack_title')} text={t('dash_nopack_text')}
            action={
              <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button as={Link} to="/training-request" variant="primary" size="lg" fullOnMobile>{t('dash_request_pack')}</Button>
                {!trial && <Button as={Link} to="/trial-session" variant="secondary" size="lg" fullOnMobile>{t('dash_try_trial')}</Button>}
              </div>
            }
          />
        </section>
      )}

      {workflow && state === 'pending' && <Card as="section" radius="sm" className="p-6! sm:p-10! md:p-14!">
        <p className="text-amber-300 uppercase tracking-[3px] text-sm mb-3">{t('dash_request_no', { id: workflow.request?.id })}</p><h2 style={{ fontFamily: 'Bebas Neue' }} className="text-4xl sm:text-5xl md:text-6xl mb-4">{t('dash_req_status')}</h2>
        <div className="inline-flex items-center gap-3 rounded-full border border-amber-300/30 bg-amber-300/10 px-5 py-3 mb-5"><span className="w-2.5 h-2.5 bg-amber-300 rounded-full"/><strong>{t('dash_pending')}</strong></div>
        <p className="text-gray-300 max-w-2xl">{t('dash_pending_text')}</p>
        <div className="mt-8 text-gray-400">{workflow.request?.package} · {t('dash_sessions_week', { n: workflow.request?.sessions_per_week })}</div>
      </Card>}

      {workflow && state === 'rejected' && <Card as="section" radius="sm" className="p-6! sm:p-10! md:p-14!">
        <p className="text-gray-400 uppercase tracking-[3px] text-sm mb-3">{t('dash_update')}</p><h2 style={{ fontFamily: 'Bebas Neue' }} className="text-4xl sm:text-5xl md:text-6xl mb-4">{t('dash_declined')}</h2>
        <p className="text-gray-300 max-w-2xl">{workflow.request?.reason || t('dash_declined_default')}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button as={Link} to="/training-request" variant="light" size="lg">{t('dash_submit_new')}</Button>
          {!trial && <Button as={Link} to="/trial-session" variant="secondary" size="lg" fullOnMobile>{t('dash_try_trial')}</Button>}
        </div>
      </Card>}

      {workflow && (state === 'active' || state === 'approved') && <>
        <section aria-label={t('dash_next_title')} className="mb-8">
          {nextZone}
        </section>

        <MyPacks plans={packs} today={today} />

        <div className="mb-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <Card as="section" radius="sm" className="p-6" aria-labelledby="dash-upcoming-title">
            <h2 id="dash-upcoming-title" style={{ fontFamily: 'Bebas Neue' }} className="text-4xl mb-5">{t('dash_upcoming')}</h2>
            {sessionsLoading ? (
              <div role="status" aria-label={t('dash_loading')} className="space-y-3"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
            ) : others.length ? (
              <ul className="divide-y divide-white/10">
                {others.map(session => (
                  <li key={session.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3.5">
                    <span className="font-medium tabular-nums">{formatDayTime(session.date, session.time, locale)}</span>
                    <span className="flex min-w-0 items-center gap-2 text-gray-400">
                      <span className="truncate">{session.trainer || t('dash_trainer_word')}</span>
                      {packs.length > 1 && <PackLabel name={session.packName} />}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-gray-400">{next ? t('dash_upcoming_empty') : t('dash_preparing')}</p>}
            <Button as={Link} to="/my-sessions" variant="secondary" className="mt-5">{t('dash_view_all')}</Button>
          </Card>

          <div>
            <Button className="mb-3 w-full lg:hidden" variant="secondary" aria-expanded={calendarOpen} aria-controls="dash-calendar" onClick={() => setCalendarOpen(!calendarOpen)}>
              {calendarOpen ? t('dash_cal_hide') : t('dash_cal_show')}
            </Button>
            <div id="dash-calendar" className={calendarOpen ? 'block' : 'hidden lg:block'}>
              <DashboardCalendar data={data} />
            </div>
          </div>
        </div>
        {clientCalendar && <CalendarSubscribe className="mt-8" />}
      </>}
    </main>

    {opened && (
      <SessionModal
        key={`${opened.id}-${actions.open.mode}`}
        session={opened} status={statusOf(opened)} initialMode={actions.open.mode} todayKey={today} showCalendar={clientCalendar}
        change={changeOf(opened)} hours={rules.hours} noteMax={requestInfo.note_max} answering={actions.answering} trainerId={trainerIds[opened.trainer] || ''}
        onClose={() => actions.setOpen(null)} onLoadTimes={actions.loadTimes} onRequest={actions.requestChange} onCancel={actions.cancel} onRespond={actions.respondTo}
      />
    )}
  </div>
}

export default Dashboard
