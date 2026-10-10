import { useMemo } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { dateKey, normalizeSessions, parseDateKey } from '../requests'
import BusinessPanel from '../BusinessPanel'
import { Badge, Button, Card, EmptyState, ErrorState, Icon, PageHeader, Skeleton, StatCard } from '../ui'

const INACTIVE = new Set(['cancelled', 'canceled', 'completed', 'rejected'])

function WeekChart({ days, t }) {
  const max = Math.max(1, ...days.map(day => day.count))
  return (
    <div className="flex h-40 items-end gap-2 sm:gap-3">
      {days.map(day => (
        <div key={day.key} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
          <span className="text-xs tabular-nums text-gray-400">{day.count || ''}</span>
          <div className="flex w-full flex-1 items-end">
            <div
              className={`w-full rounded-t-lg transition-all duration-500 ${day.isToday ? 'bg-emerald-400' : 'bg-emerald-400/35 hover:bg-emerald-400/60'}`}
              style={{ height: `${day.count ? Math.max(8, (day.count / max) * 100) : 4}%`, opacity: day.count ? 1 : 0.25 }}
              title={`${day.label}: ${day.count}`}
            />
          </div>
          <span className={`text-[11px] uppercase ${day.isToday ? 'font-semibold text-emerald-300' : 'text-gray-500'}`}>
            {day.isToday ? t('today') : day.label}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function Overview() {
  const { t, language } = useAdminText()
  const { requests, requestsResource, trials, trialsResource } = useOutletContext()
  const stats = useAdminResource('/admin/stats')
  const sessionsResource = useAdminResource('/admin/sessions')

  const sessions = useMemo(() => normalizeSessions(sessionsResource.data), [sessionsResource.data])
  const pending = requests.filter(request => request.status === 'pending')
  const pendingTrials = trials.filter(trial => trial.status === 'pending')
  const awaitingTrials = trials.filter(trial => trial.status === 'approved')
  // One square for everything that waits for the admin's approval: training
  // requests (/admin/client-requests) plus trial-session requests
  // (/admin/trial-sessions). They are different data, so they are summed
  // instead of one being dropped. The square opens the queue with more items
  // waiting (ties go to requests); both queues keep their sidebar badges.
  const totalPending = pending.length + pendingTrials.length
  const pendingTarget = pendingTrials.length > pending.length ? '/admin/trials' : '/admin/requests'
  const pendingLoading = (requestsResource.loading && !requestsResource.data) || (trialsResource.loading && !trialsResource.data)
  const pendingHint = totalPending
    ? `${t('stat_requests_short')}: ${pending.length} · ${t('stat_trials_short')}: ${pendingTrials.length}`
    : awaitingTrials.length ? `${awaitingTrials.length} ${t('tr_awaiting_hint')}` : t('pending_hint_none')
  const locale = language === 'es' ? 'es-ES' : 'en-GB'

  const { week, upcoming } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // Trial sessions count too: pending ones are shown as such, approved ones
    // wait for the client, confirmed ones are firm. Rejected, declined and
    // cancelled trials are not sessions.
    const trialSessions = trials
      .filter(trial => ['pending', 'approved', 'confirmed'].includes(trial.status) && trial.date)
      .map(trial => ({
        id: `trial-${trial.id}`, client: trial.name || '—', trainer: trial.trainer || '—',
        date: trial.date, time: String(trial.time || '').slice(0, 5), status: trial.status, isTrial: true
      }))
    const active = [...sessions.filter(session => !INACTIVE.has(session.status.toLowerCase())), ...trialSessions]
    const days = Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(today)
      date.setDate(today.getDate() + offset)
      const key = dateKey(date)
      return {
        key,
        isToday: offset === 0,
        label: date.toLocaleDateString(locale, { weekday: 'short' }),
        count: active.filter(session => session.date === key).length
      }
    })
    // Nearest first, and only sessions that have not started yet: a session
    // earlier today whose time has passed is no longer "upcoming".
    const now = new Date()
    const nowStamp = `${dateKey(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const stamp = session => `${session.date} ${session.time}`
    const next = active
      .filter(session => stamp(session) >= nowStamp)
      .sort((a, b) => stamp(a).localeCompare(stamp(b)))
      .slice(0, 6)
    return { week: days, upcoming: next }
  }, [sessions, trials, locale])

  const formatDay = (key) => parseDateKey(key).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <div className="admin-fade">
      <PageHeader
        title="THUNDBALANCE ADMIN"
        subtitle={t('overview_sub')}
        actions={<Button variant="secondary" onClick={() => { stats.reload(); sessionsResource.reload(); requestsResource.reload(); trialsResource.reload() }}>
          <Icon name="refresh" className="h-4 w-4" />{t('refresh')}
        </Button>}
      />

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label={t('stat_clients')} value={stats.data?.users ?? '—'} icon="clients" loading={stats.loading && !stats.data} to="/admin/clients" />
        <StatCard label={t('stat_sessions')} value={stats.data?.sessions ?? '—'} icon="calendar" loading={stats.loading && !stats.data} to="/admin/clients" />
        <div className="col-span-2 sm:col-span-1">
          <StatCard
            label={t('stat_pending_total')} value={totalPending} icon="requests" tone="amber" to={pendingTarget}
            hint={pendingHint} loading={pendingLoading}
          />
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="p-6 lg:col-span-3">
          <h2 className="text-lg font-semibold">{t('week_title')}</h2>
          <p className="mb-6 text-sm text-gray-500">{t('week_sub')}</p>
          {sessionsResource.error
            ? <ErrorState message={t('load_error')} retryLabel={t('retry')} onRetry={sessionsResource.reload} />
            : sessionsResource.loading && !sessionsResource.data
              ? <Skeleton className="h-40 w-full" />
              : <WeekChart days={week} t={t} />}
        </Card>

        <Card className="p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t('pending_title')}</h2>
            <Link to="/admin/requests" className="inline-flex min-h-[44px] items-center text-sm text-emerald-300 hover:text-emerald-200">{t('view_all')} →</Link>
          </div>
          {requestsResource.error
            ? <ErrorState message={t('load_error')} retryLabel={t('retry')} onRetry={requestsResource.reload} />
            : requestsResource.loading && !requestsResource.data
              ? <div className="space-y-3"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
              : pending.length === 0
                ? <EmptyState icon="check" title={t('pending_empty')} />
                : <ul className="space-y-2">
                  {pending.slice(0, 4).map(request => (
                    <li key={request.id}>
                      <Link to="/admin/requests" className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 transition hover:border-amber-400/30 hover:bg-amber-400/5">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{request.client}</span>
                          <span className="block truncate text-xs text-gray-500">{request.plan} · {request.perWeek} {t('req_per_week')}</span>
                        </span>
                        <Badge tone="amber">{t('st_pending')}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>}
        </Card>
      </section>

      <BusinessPanel sessions={sessions} trials={trials} />

      <section className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="p-6 lg:col-span-3">
          <h2 className="mb-4 text-lg font-semibold">{t('upcoming_title')}</h2>
          {sessionsResource.error
            ? <ErrorState message={t('load_error')} retryLabel={t('retry')} onRetry={sessionsResource.reload} />
            : sessionsResource.loading && !sessionsResource.data
              ? <div className="space-y-3"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
              : upcoming.length === 0
                ? <EmptyState icon="calendar" title={t('upcoming_empty')} />
                : <ul className="divide-y divide-white/[0.06]">
                  {upcoming.map(session => (
                    <li key={session.id} className="flex items-center gap-4 py-3">
                      <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300">
                        <span className="text-[10px] uppercase leading-none">{parseDateKey(session.date).toLocaleDateString(locale, { month: 'short' })}</span>
                        <span className="text-base font-semibold leading-tight">{parseDateKey(session.date).getDate()}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 font-medium">
                          <span className="truncate">{session.client}</span>
                          {session.isTrial && <Badge tone={{ pending: 'amber', approved: 'sky', confirmed: 'emerald' }[session.status]}>{t(`trial_b_${session.status}`)}</Badge>}
                        </span>
                        <span className="block truncate text-xs text-gray-500">{formatDay(session.date)} · {session.trainer}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-sm tabular-nums text-gray-300"><Icon name="clock" className="h-4 w-4 text-gray-500" />{session.time}</span>
                    </li>
                  ))}
                </ul>}
        </Card>

        <Card className="p-6 lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold">{t('quick_title')}</h2>
          <div className="space-y-2">
            {[
              { to: '/admin/landing-editor', icon: 'landing', title: t('qa_landing'), text: t('qa_landing_desc') },
              { to: '/admin/videos', icon: 'video', title: t('qa_videos'), text: t('qa_videos_desc') },
              { to: '/admin/clients', icon: 'clients', title: t('qa_clients'), text: t('qa_clients_desc') }
            ].map(action => (
              <Link key={action.to} to={action.to} className="group flex items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 transition hover:border-emerald-400/30 hover:bg-emerald-400/5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300"><Icon name={action.icon} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{action.title}</span>
                  <span className="block truncate text-xs text-gray-500">{action.text}</span>
                </span>
                <Icon name="arrow" className="h-4 w-4 text-gray-600 transition group-hover:translate-x-0.5 group-hover:text-emerald-300" />
              </Link>
            ))}
          </div>
        </Card>
      </section>
    </div>
  )
}
