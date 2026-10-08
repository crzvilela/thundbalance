import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAdminText } from './useAdminText'
import { useAdminResource } from './useAdminResource'
import { dateKey, parseDateKey } from './requests'
import { PackStatusBadge } from './PackPanel'
import { Badge, Card, EmptyState, ErrorState, Skeleton, StatCard } from './ui'

const INACTIVE = new Set(['cancelled', 'canceled', 'completed', 'rejected'])

// Business view for the Overview: packs that need renewing, clients without a
// pack and the month's workload per trainer. Everything comes from data the
// admin already loads (/admin/clients, sessions and trial sessions).
export default function BusinessPanel({ sessions, trials }) {
  const { t, language } = useAdminText()
  const clientsResource = useAdminResource('/admin/clients')
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const clients = useMemo(() => (Array.isArray(clientsResource.data) ? clientsResource.data : []), [clientsResource.data])
  const loading = clientsResource.loading && !clientsResource.data

  const { toRenew, withoutPack, activePacks } = useMemo(() => {
    const renew = clients
      .filter(client => client.pack_status === 'expired' || client.pack_status === 'expiring')
      .sort((a, b) => String(a.pack_end || '').localeCompare(String(b.pack_end || '')))
    return {
      toRenew: renew,
      withoutPack: clients.filter(client => client.pack_status === 'none'),
      activePacks: clients.filter(client => client.pack_status === 'active' || client.pack_status === 'expiring').length
    }
  }, [clients])

  // Sessions of the current month per trainer: booked sessions plus approved or
  // confirmed trial sessions, split into done and still to come.
  const perTrainer = useMemo(() => {
    const now = new Date()
    const monthKey = dateKey(now).slice(0, 7)
    const today = dateKey(now)
    const list = [
      ...sessions.filter(session => !INACTIVE.has(String(session.status).toLowerCase())),
      ...trials
        .filter(trial => (trial.status === 'approved' || trial.status === 'confirmed') && trial.date)
        .map(trial => ({ trainer: trial.trainer, date: trial.date }))
    ].filter(session => session.trainer && session.trainer !== '—' && String(session.date).startsWith(monthKey))
    const map = new Map()
    for (const session of list) {
      const row = map.get(session.trainer) || { trainer: session.trainer, done: 0, left: 0 }
      if (session.date < today) row.done += 1
      else row.left += 1
      map.set(session.trainer, row)
    }
    return [...map.values()].sort((a, b) => (b.done + b.left) - (a.done + a.left))
  }, [sessions, trials])

  const maxMonth = Math.max(1, ...perTrainer.map(row => row.done + row.left))
  const fmt = (key) => (key ? parseDateKey(key).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : '—')
  const monthName = new Date().toLocaleDateString(locale, { month: 'long' })

  return (
    <section className="mt-6" aria-labelledby="biz-title">
      <h2 id="biz-title" className="mb-4 text-lg font-semibold">{t('biz_title')}</h2>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label={t('biz_active_packs')} value={activePacks} icon="clients" loading={loading} to="/admin/clients" />
        <StatCard label={t('biz_to_renew')} value={toRenew.length} icon="calendar" tone="amber" loading={loading} to="/admin/clients?filter=renew" hint={t('biz_to_renew_hint')} />
        <div className="col-span-2 sm:col-span-1">
          <StatCard label={t('biz_no_pack')} value={withoutPack.length} icon="requests" tone="sky" loading={loading} to="/admin/clients?filter=no_plan" />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="p-6 lg:col-span-3">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">{t('biz_renew_title')}</h3>
              <p className="text-sm text-gray-500">{t('biz_renew_sub')}</p>
            </div>
            <Link to="/admin/clients?filter=renew" className="text-sm text-emerald-300 hover:text-emerald-200">{t('view_all')} →</Link>
          </div>
          {clientsResource.error
            ? <ErrorState message={t('load_error')} retryLabel={t('retry')} onRetry={clientsResource.reload} />
            : loading
              ? <div className="space-y-3"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
              : toRenew.length === 0
                ? <EmptyState icon="check" title={t('biz_renew_empty')} />
                : <ul className="space-y-2">
                  {toRenew.slice(0, 6).map(client => (
                    <li key={client.id}>
                      <Link to={`/admin/clients?client=${client.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 transition hover:border-amber-400/30 hover:bg-amber-400/5">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{client.name}</span>
                          <span className="block truncate text-xs text-gray-500">{client.plan} · {t('biz_ends')} {fmt(client.pack_end)}</span>
                        </span>
                        <PackStatusBadge status={client.pack_status} />
                      </Link>
                    </li>
                  ))}
                </ul>}
        </Card>

        <Card className="p-6 lg:col-span-2">
          <h3 className="text-lg font-semibold">{t('biz_trainer_title')}</h3>
          <p className="mb-5 text-sm capitalize text-gray-500">{monthName}</p>
          {loading && sessions.length === 0
            ? <Skeleton className="h-32 w-full" />
            : perTrainer.length === 0
              ? <EmptyState icon="calendar" title={t('biz_trainer_empty')} />
              : <ul className="space-y-4">
                {perTrainer.map(row => {
                  const total = row.done + row.left
                  return (
                    <li key={row.trainer}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-3">
                        <span className="truncate font-medium">{row.trainer}</span>
                        <span className="shrink-0 text-sm tabular-nums text-gray-300">{total}</span>
                      </div>
                      <div className="flex h-2 overflow-hidden rounded-full bg-white/10" role="img" aria-label={`${row.trainer}: ${total}`}>
                        <div className="bg-white/40" style={{ width: `${(row.done / maxMonth) * 100}%` }} />
                        <div className="bg-emerald-400" style={{ width: `${(row.left / maxMonth) * 100}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-gray-500">{row.done} {t('biz_done')} · {row.left} {t('biz_left')}</p>
                    </li>
                  )
                })}
              </ul>}
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{t('biz_nopack_title')}</h3>
          <Link to="/admin/clients?filter=no_plan" className="text-sm text-emerald-300 hover:text-emerald-200">{t('view_all')} →</Link>
        </div>
        {loading
          ? <Skeleton className="h-14" />
          : withoutPack.length === 0
            ? <EmptyState icon="check" title={t('biz_nopack_empty')} />
            : <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {withoutPack.slice(0, 6).map(client => (
                <li key={client.id}>
                  <Link to={`/admin/clients?client=${client.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 transition hover:border-sky-400/30 hover:bg-sky-400/5">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{client.name}</span>
                      <span className="block truncate text-xs text-gray-500">{client.email}</span>
                    </span>
                    <Badge>{t('cl_no_plan')}</Badge>
                  </Link>
                </li>
              ))}
            </ul>}
      </Card>
    </section>
  )
}
