import { useMemo, useState } from 'react'
import { adminRequest } from '../api'
import { resolveImageUrl } from '../../api/landingPage'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { useToast } from '../toastContext'
import { dateKey, parseDateKey } from '../requests'
import { PackStatusBadge, PackSummary, RenewDrawer, TrainingCalendar } from '../PackPanel'
import AddClientDrawer from '../AddClientDrawer'
import {
  Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Icon,
  PageHeader, SelectInput, Skeleton, TextInput
} from '../ui'

function initials(name) {
  return String(name || '?').split(' ').slice(0, 2).map(part => part[0]).join('').toUpperCase()
}

function Avatar({ client, size = 'h-12 w-12 text-base' }) {
  const photo = resolveImageUrl(client.photo)
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-emerald-400/25 to-emerald-700/10 font-semibold text-emerald-200`}>
      {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : initials(client.name)}
    </span>
  )
}

function ProgressBar({ done, total }) {
  const percent = total ? Math.round((done / total) * 100) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all duration-700" style={{ width: `${percent}%` }} />
    </div>
  )
}

function ClientDrawer({ clientId, plans, trainers, onClose, onChanged }) {
  const { t, language } = useAdminText()
  const toast = useToast()
  const detail = useAdminResource(`/admin/clients/${clientId}`)
  const [planChoice, setPlanChoice] = useState('')
  const [saving, setSaving] = useState(false)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const [resending, setResending] = useState(false)

  const client = detail.data
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const today = dateKey(new Date())
  const sessions = useMemo(() => client?.sessions || [], [client])
  const active = sessions.filter(session => session.status !== 'Cancelled')
  const done = active.filter(session => session.date < today).length

  const assign = async () => {
    setSaving(true)
    try {
      await adminRequest('POST', '/admin/assign-plan', { user_id: clientId, plan_id: Number(planChoice) })
      toast.push(t('cl_plan_saved'))
      setPlanChoice('')
      detail.reload()
      onChanged()
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const resend = async () => {
    setResending(true)
    try {
      const result = await adminRequest('POST', `/admin/clients/${clientId}/resend-credentials`)
      if (result.email?.sent) toast.push(`${t('cc_resent')} ${client.email}`)
      else toast.push(t('cc_email_failed'), 'warning')
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setResending(false)
    }
  }

  const cancelSession = async () => {
    setCancelling(true)
    try {
      await adminRequest('POST', `/admin/sessions/${cancelTarget.id}/cancel`)
      toast.push(t('cl_cancelled_ok'))
      setCancelTarget(null)
      detail.reload()
      onChanged()
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <>
      <Drawer open onClose={onClose} size="lg" title={client?.name || '…'} subtitle={client?.email}>
        {detail.error ? (
          <ErrorState message={`${t('cl_detail_error')} (${detail.error})`} retryLabel={t('retry')} onRetry={detail.reload} />
        ) : !client ? (
          <div className="space-y-4"><Skeleton className="h-20" /><Skeleton className="h-32" /><Skeleton className="h-40" /></div>
        ) : (
          <div className="grid gap-10 lg:grid-cols-2">
            <div className="space-y-8">
            <div className="flex items-center gap-4">
              <Avatar client={client} size="h-16 w-16 text-xl" />
              <div className="min-w-0">
                <p className="truncate text-2xl font-semibold">{client.name}</p>
                <div className="mt-1.5">
                  {client.plan ? <Badge tone="emerald">{client.plan.name}</Badge> : <Badge>{t('cl_no_plan')}</Badge>}
                </div>
              </div>
            </div>

            <PackSummary pack={client.pack} onRenew={() => setRenewing(true)} />

            {client.must_change_password && (
              <section className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-4">
                <h3 className="mb-1 text-sm font-medium uppercase tracking-wider text-amber-200">{t('cc_temp_title')}</h3>
                <p className="mb-3 text-sm text-gray-300">{t('cc_temp_text')}</p>
                <Button variant="secondary" onClick={resend} loading={resending}>{resending ? t('cc_resending') : t('cc_resend')}</Button>
              </section>
            )}

            <section>
              <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">{t('cl_contact')}</h3>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-base">
                <div><dt className="text-sm text-gray-500">{t('cl_phone')}</dt><dd>{client.phone ? `${client.country_code || ''} ${client.phone}` : '—'}</dd></div>
                <div><dt className="text-sm text-gray-500">{t('cl_city')}</dt><dd>{client.city || '—'}</dd></div>
                <div className="col-span-2"><dt className="text-sm text-gray-500">{t('cl_address')}</dt><dd>{[client.address, client.postal_code].filter(Boolean).join(', ') || '—'}</dd></div>
              </dl>
            </section>

            <section>
              <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">{t('cl_progress')}</h3>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                <div className="mb-3 flex items-end justify-between">
                  <p className="text-5xl font-semibold tabular-nums">{done}<span className="text-2xl text-gray-500">/{active.length}</span></p>
                  <p className="text-sm text-gray-500">{done} {t('cl_completed')} · {active.length - done} {t('cl_upcoming')}</p>
                </div>
                <ProgressBar done={done} total={active.length} />
              </div>
            </section>

            <section>
              <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">{t('cl_assign')}</h3>
              <div className="flex gap-3">
                <SelectInput value={planChoice} onChange={event => setPlanChoice(event.target.value)} disabled={saving} aria-label={t('cl_assign')}>
                  <option value="">{t('cl_assign_ph')}</option>
                  {plans.map(plan => <option key={plan[0]} value={plan[0]}>{plan[1]}</option>)}
                </SelectInput>
                <Button variant="primary" onClick={assign} disabled={!planChoice} loading={saving} className="shrink-0">{t('cl_assign_save')}</Button>
              </div>
            </section>

            </div>

            <div className="space-y-8">
            <TrainingCalendar sessions={sessions} />

            <section>
              <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">{t('cl_sessions_title')} ({sessions.length})</h3>
              {sessions.length === 0 ? (
                <EmptyState icon="calendar" title={t('cl_no_sessions')} />
              ) : (
                <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.08] bg-white/[0.02]">
                  {sessions.map(session => {
                    const cancelled = session.status === 'Cancelled'
                    const past = session.date < today
                    return (
                      <li key={session.id} className={`flex items-center gap-4 px-5 py-4 ${cancelled || past ? 'opacity-60' : ''}`}>
                        <span className="w-14 text-sm tabular-nums text-gray-500">{session.number || ''}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-base font-medium">{parseDateKey(session.date).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                          <span className="block text-sm text-gray-500">{session.time} · {session.trainer || '—'}</span>
                        </span>
                        <Badge tone={cancelled ? 'red' : past ? 'neutral' : 'emerald'}>{cancelled ? t('st_cancelled') : t('st_booked')}</Badge>
                        {!cancelled && !past && (
                          <button type="button" onClick={() => setCancelTarget(session)} className="rounded-lg px-3 py-1.5 text-sm text-red-300 transition hover:bg-red-500/15">{t('cl_cancel_session')}</button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
            </div>
          </div>
        )}
      </Drawer>
      {renewing && client && (
        <RenewDrawer
          client={client} pack={client.pack} plans={plans} trainers={trainers}
          onClose={() => setRenewing(false)}
          onDone={() => { setRenewing(false); detail.reload(); onChanged() }}
        />
      )}
      <ConfirmDialog
        open={!!cancelTarget} busy={cancelling}
        title={t('cl_cancel_title')} text={t('cl_cancel_text')}
        confirmLabel={t('cl_cancel_do')} cancelLabel={t('cl_cancel_keep')}
        onConfirm={cancelSession} onCancel={() => setCancelTarget(null)}
      />
    </>
  )
}

export default function Clients() {
  const { t, language } = useAdminText()
  const clientsResource = useAdminResource('/admin/clients')
  const plansResource = useAdminResource('/plans')
  const trainersResource = useAdminResource('/admin/trainer-availability')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [adding, setAdding] = useState(false)

  const clients = useMemo(() => clientsResource.data || [], [clientsResource.data])
  const plans = useMemo(() => plansResource.data || [], [plansResource.data])
  const trainers = useMemo(() => (Array.isArray(trainersResource.data) ? trainersResource.data : []), [trainersResource.data])
  const locale = language === 'es' ? 'es-ES' : 'en-GB'

  const counts = useMemo(() => ({
    all: clients.length,
    with_plan: clients.filter(client => client.plan).length,
    no_plan: clients.filter(client => !client.plan).length,
    pending: clients.filter(client => client.has_pending_request).length
  }), [clients])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return clients.filter(client => {
      if (filter === 'with_plan' && !client.plan) return false
      if (filter === 'no_plan' && client.plan) return false
      if (filter === 'pending' && !client.has_pending_request) return false
      return !needle || `${client.name} ${client.email}`.toLowerCase().includes(needle)
    })
  }, [clients, filter, query])

  const filters = [['all', t('cl_all')], ['with_plan', t('cl_with_plan')], ['no_plan', t('cl_no_plan_filter')], ['pending', t('cl_pending')]]

  return (
    <div className="admin-fade">
      <PageHeader
        title={t('clients_title')} subtitle={t('clients_sub')}
        actions={<>
          <Button variant="secondary" onClick={clientsResource.reload}><Icon name="refresh" className="h-4 w-4" />{t('refresh')}</Button>
          <Button variant="primary" onClick={() => setAdding(true)}><Icon name="plus" className="h-4 w-4" />{t('cc_add')}</Button>
        </>}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist">
          {filters.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${
                filter === key ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-gray-400 hover:border-white/25 hover:text-white'
              }`}>
              {label}
              <span className={`rounded-full px-1.5 text-xs tabular-nums ${filter === key ? 'bg-emerald-400/20' : 'bg-white/10'}`}>{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <TextInput value={query} onChange={event => setQuery(event.target.value)} placeholder={t('cl_search')} aria-label={t('cl_search')} className="!pl-10" />
        </div>
      </div>

      {clientsResource.error ? (
        <Card><ErrorState message={`${t('load_error')} (${clientsResource.error})`} retryLabel={t('retry')} onRetry={clientsResource.reload} /></Card>
      ) : clientsResource.loading && !clientsResource.data ? (
        <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
      ) : visible.length === 0 ? (
        <Card><EmptyState icon="clients" title={clients.length ? t('cl_empty') : t('cl_none')} /></Card>
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2">
          {visible.map(client => (
            <li key={client.id}>
              <button type="button" onClick={() => setSelectedId(client.id)} className="block w-full rounded-2xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400">
                <Card className="group p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400/30">
                  <div className="flex items-center gap-4">
                    <Avatar client={client} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold">{client.name}</p>
                        {client.has_pending_request && <Badge tone="amber">{t('cl_pending')}</Badge>}
                        {(client.pack_status === 'expired' || client.pack_status === 'expiring') && <PackStatusBadge status={client.pack_status} />}
                      </div>
                      <p className="truncate text-sm text-gray-500">{client.email}</p>
                    </div>
                    {client.plan ? <Badge tone="emerald">{client.plan}</Badge> : <Badge>{t('cl_no_plan')}</Badge>}
                  </div>
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                      <span>{client.completed}/{client.total} {t('cl_sessions')}</span>
                      <span>{t('cl_next')}: <span className="text-gray-300">{client.next_session ? parseDateKey(client.next_session).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : t('cl_no_next')}</span></span>
                    </div>
                    <ProgressBar done={client.completed} total={client.total} />
                  </div>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <AddClientDrawer
          plans={plans} trainers={trainers}
          onClose={() => setAdding(false)} onCreated={() => clientsResource.reload()}
        />
      )}

      {selectedId && (
        <ClientDrawer
          key={selectedId} clientId={selectedId} plans={plans} trainers={trainers}
          onClose={() => setSelectedId(null)} onChanged={clientsResource.reload}
        />
      )}
    </div>
  )
}
