import { useState } from 'react'
import { useAdminText } from './useAdminText'
import { useAdminResource } from './useAdminResource'
import { dateKey, parseDateKey } from './requests'
import { formatMoney } from '../utils/pricing'
import { TypeBadge } from './SessionKind'
import { Badge, Button, ErrorState, Skeleton } from './ui'

const STATE_TONE = { activo: 'emerald', finalizado: 'neutral', sustituido: 'amber', cancelado: 'red' }

// What a session of a pack is: cancelled, already done, or still to come.
function sessionState(session, today) {
  if (session.status === 'Cancelled') return 'cancelled'
  return session.date < today ? 'done' : 'upcoming'
}
const SESSION_TONE = { cancelled: 'red', done: 'neutral', upcoming: 'emerald' }

function PackRow({ pack, highlight }) {
  const { t, language } = useAdminText()
  const [open, setOpen] = useState(false)
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const today = dateKey(new Date())
  const fmt = (key, options = { day: 'numeric', month: 'short', year: 'numeric' }) => (key ? parseDateKey(String(key).slice(0, 10)).toLocaleDateString(locale, options) : '—')
  const percent = pack.planned ? Math.round((pack.used / pack.planned) * 100) : 0
  const panelId = `pack-history-${pack.id}`

  return (
    <li className={`rounded-2xl border p-4 sm:p-5 ${highlight ? 'border-emerald-400/40 bg-emerald-400/[0.06]' : 'border-white/[0.08] bg-white/[0.03]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="break-words text-lg font-semibold">{pack.name}</p>
          <p className="mt-0.5 text-sm text-gray-400">
            {pack.duration_months != null ? t('hh_months').replace('{n}', pack.duration_months) : '—'}
            {pack.sessions_per_week ? ` · ${pack.sessions_per_week} ${t('req_per_week')}` : ''}
            {pack.trainer ? ` · ${pack.trainer}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={pack.session_type} secondName={pack.second_person_name} />
          <Badge tone={STATE_TONE[pack.status] || 'neutral'}>{t(`hh_status_${pack.status}`)}</Badge>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
        <div><dt className="text-gray-500">{t('ty_price_session')}</dt><dd className="text-base">{pack.price_per_session != null ? formatMoney(pack.price_per_session) : '—'}</dd></div>
        <div><dt className="text-gray-500">{t('ty_price_total')}</dt><dd className="text-base">{pack.total_price != null ? formatMoney(pack.total_price) : '—'}</dd></div>
        <div className="col-span-2"><dt className="text-gray-500">{t('pk_period')}</dt><dd className="text-base">{fmt(pack.start_date)} → {fmt(pack.end_date)}</dd></div>
        {pack.created_at && <div><dt className="text-gray-500">{t('hh_created')}</dt><dd>{fmt(pack.created_at)}</dd></div>}
        {pack.replaced_at && <div><dt className="text-gray-500">{t('hh_replaced_on')}</dt><dd>{fmt(pack.replaced_at)}</dd></div>}
      </dl>

      <div className="mt-4">
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-medium tabular-nums">{pack.used}/{pack.planned} {t('hh_sessions')}</span>
          <span className="text-gray-500">
            {pack.remaining > 0 && `${pack.remaining} ${t('pk_left')}`}
            {pack.cancelled > 0 && `${pack.remaining > 0 ? ' · ' : ''}${pack.cancelled} ${t('hh_cancelled')}`}
          </span>
        </div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={pack.planned} aria-valuenow={pack.used} aria-label={`${pack.used}/${pack.planned} ${t('hh_sessions')}`} className="h-2 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full ${pack.status === 'activo' ? 'bg-emerald-400' : 'bg-gray-400'}`} style={{ width: `${percent}%` }} />
        </div>
      </div>

      <Button variant="secondary" className="mt-4 w-full sm:w-auto" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={panelId}>
        {open ? t('hh_hide') : t('hh_show')}
      </Button>
      {open && (
        <div id={panelId} className="mt-3">
          {pack.sessions.length === 0 ? (
            <p className="text-sm text-gray-500">{t('hh_no_sessions')}</p>
          ) : (
            <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06]">
              {pack.sessions.map(session => {
                const state = sessionState(session, today)
                return (
                  <li key={session.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                    <span className="flex items-center gap-3">
                      <span className="w-12 shrink-0 tabular-nums text-gray-500">{session.number || '—'}</span>
                      <span className={state === 'cancelled' ? 'text-gray-500 line-through' : ''}>
                        {fmt(session.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · {session.time}
                      </span>
                    </span>
                    <Badge tone={SESSION_TONE[state]}>{t(`hh_s_${state}`)}</Badge>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

// "Historial de packs": every pack the client has had, the active one first and highlighted. Admin only (the
// endpoint is); the client has no such page. `version` changes when a pack is created, so the list reloads.
export default function PackHistory({ clientId, version = '' }) {
  const { t } = useAdminText()
  const resource = useAdminResource(`/admin/clients/${clientId}/packs?v=${version}`)

  if (resource.error) {
    return <ErrorState message={`${t('hh_error')} (${resource.error})`} retryLabel={t('retry')} onRetry={resource.reload} />
  }
  if (resource.loading && !resource.data) {
    return <div className="space-y-3" aria-busy="true"><Skeleton className="h-44" /><Skeleton className="h-44" /></div>
  }
  const list = Array.isArray(resource.data) ? resource.data : []
  if (list.length === 0) {
    return <p className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 text-gray-400">{t('hh_empty')}</p>
  }
  const current = list.find(pack => pack.status === 'activo')
  const others = list.filter(pack => pack !== current)
  return (
    <div className="max-w-3xl space-y-6">
      {current && (
        <section aria-label={t('hh_current')}>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-emerald-300">{t('hh_current')}</h3>
          <ul><PackRow pack={current} highlight /></ul>
        </section>
      )}
      {others.length > 0 && (
        <section aria-label={t('hh_previous')}>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-400">{t('hh_previous')} ({others.length})</h3>
          <ul className="space-y-3">{others.map(pack => <PackRow key={pack.id} pack={pack} />)}</ul>
        </section>
      )}
    </div>
  )
}
