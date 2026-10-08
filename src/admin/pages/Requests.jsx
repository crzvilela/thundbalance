import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { adminRequest } from '../api'
import EmailRecipients from '../EmailRecipients'
import { recipientsPayload, reportEmailResult, useEmailRecipients } from '../recipientsState'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { useToast } from '../toastContext'
import { dateKey, normalizeRequests } from '../requests'
import { firstMismatch, hoursSummary } from '../availability'
import {
  Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Field, Icon, PageHeader,
  SelectInput, Skeleton, TextArea, TextInput
} from '../ui'

const STATUS_TONE = { pending: 'amber', approved: 'emerald', rejected: 'red' }

export default function Requests() {
  const { t, dayLabel, dayFull } = useAdminText()
  const toast = useToast()
  const { requests, requestsResource } = useOutletContext()
  const trainersResource = useAdminResource('/admin/trainer-availability')
  const plansResource = useAdminResource('/plans')
  // The layout's list leaves archived requests out; this one has only them.
  const archivedResource = useAdminResource('/admin/client-requests?archived=only')
  const archivedRequests = useMemo(() => normalizeRequests(archivedResource.data), [archivedResource.data])

  const [filter, setFilter] = useState('pending')
  const [query, setQuery] = useState('')
  const [approving, setApproving] = useState(null)
  const [declining, setDeclining] = useState(null)
  const [archiving, setArchiving] = useState(null)
  const [form, setForm] = useState({ trainer: '', date: '', plan: '', perWeek: '' })
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [recipients, setRecipients, resetRecipients] = useEmailRecipients()
  const [formError, setFormError] = useState('')

  const trainers = useMemo(() => (Array.isArray(trainersResource.data) ? trainersResource.data : []), [trainersResource.data])

  // A trainer can only be chosen when they work every requested day at the
  // requested time (the server checks again and refuses anything else).
  const trainerOptions = useMemo(() => (approving ? trainers.map(trainer => {
    const badDay = firstMismatch(trainer, approving.days, approving.time)
    return { trainer, badDay, summary: hoursSummary(trainer, approving.days) }
  }) : []), [trainers, approving])
  const nobodyFits = approving && trainerOptions.length > 0 && trainerOptions.every(option => option.badDay)
  const plans = useMemo(() => plansResource.data || [], [plansResource.data])

  const counts = useMemo(() => ({
    all: requests.length,
    pending: requests.filter(request => request.status === 'pending').length,
    approved: requests.filter(request => request.status === 'approved').length,
    rejected: requests.filter(request => request.status === 'rejected').length,
    archived: archivedRequests.length
  }), [requests, archivedRequests])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    // Archived requests only appear in their own tab (not even in "Todas").
    const source = filter === 'archived' ? archivedRequests : requests
    return source.filter(request =>
      (filter === 'all' || filter === 'archived' || request.status === filter) &&
      (!needle || `${request.client} ${request.plan}`.toLowerCase().includes(needle))
    )
  }, [requests, archivedRequests, filter, query])
  const activeResource = filter === 'archived' ? archivedResource : requestsResource

  const reloadAll = () => { requestsResource.reload(); archivedResource.reload() }

  const archive = async () => {
    setBusy(true)
    try {
      await adminRequest('POST', '/admin/archive-request', { request_id: archiving.id })
      setArchiving(null)
      toast.push(t('req_archived_ok'))
      reloadAll()
    } catch (error) {
      toast.push(error.message || t('action_error'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const unarchive = async (request) => {
    setBusy(true)
    try {
      await adminRequest('POST', '/admin/unarchive-request', { request_id: request.id })
      toast.push(t('req_unarchived_ok'))
      reloadAll()
    } catch (error) {
      toast.push(error.message || t('action_error'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const openApprove = (request) => {
    setForm({ trainer: '', date: '', plan: '', perWeek: String(request.perWeek || 1) })
    setFormError('')
    resetRecipients()
    setApproving(request)
  }
  const openDecline = (request) => {
    setReason('')
    setFormError('')
    setDeclining(request)
  }

  // How many sessions the approval will create (plan weeks x sessions per week).
  const sessionEstimate = useMemo(() => {
    if (!approving) return null
    const chosen = form.plan
      ? plans.find(plan => String(plan[0]) === form.plan)
      : plans.find(plan => plan[1] === approving.plan)
    const weeks = chosen?.[4]
    return weeks && form.perWeek ? weeks * Number(form.perWeek) : null
  }, [approving, form.plan, form.perWeek, plans])

  const approve = async () => {
    if (!form.trainer || !form.date) { setFormError(t('need_trainer_date')); return }
    setBusy(true)
    setFormError('')
    try {
      const result = await adminRequest('POST', '/admin/approve-request', {
        ...recipientsPayload(recipients),
        request_id: approving.id,
        trainer_id: Number(form.trainer),
        start_date: form.date,
        ...(form.plan ? { plan_id: Number(form.plan) } : {}),
        ...(form.perWeek ? { sessions_per_week: Number(form.perWeek) } : {})
      })
      setApproving(null)
      toast.push(t('approved_ok'))
      reportEmailResult(toast, t, result.email)
      requestsResource.reload()
    } catch (error) {
      setFormError(error.message || t('action_error'))
    } finally {
      setBusy(false)
    }
  }

  const decline = async () => {
    setBusy(true)
    setFormError('')
    try {
      await adminRequest('POST', '/admin/reject-request', { request_id: declining.id, reason: reason.trim() })
      setDeclining(null)
      toast.push(t('rejected_ok'))
      requestsResource.reload()
    } catch (error) {
      setFormError(error.message || t('action_error'))
    } finally {
      setBusy(false)
    }
  }

  const filters = [
    ['pending', t('req_pending')], ['approved', t('req_approved')],
    ['rejected', t('req_rejected')], ['all', t('req_all')], ['archived', t('req_archived')]
  ]

  return (
    <div className="admin-fade">
      <PageHeader
        title={t('req_title')}
        subtitle={t('req_sub')}
        actions={<Button variant="secondary" onClick={reloadAll}><Icon name="refresh" className="h-4 w-4" />{t('refresh')}</Button>}
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
          <TextInput value={query} onChange={event => setQuery(event.target.value)} placeholder={t('req_search')} aria-label={t('req_search')} className="!pl-10" />
        </div>
      </div>

      {activeResource.error ? (
        <Card><ErrorState message={`${t('load_error')} (${activeResource.error})`} retryLabel={t('retry')} onRetry={activeResource.reload} /></Card>
      ) : activeResource.loading && !activeResource.data ? (
        <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
      ) : visible.length === 0 ? (
        <Card><EmptyState icon="inbox" title={t(filter === 'archived' ? 'req_empty_archived' : 'req_empty')} /></Card>
      ) : (
        <ul className="space-y-3">
          {visible.map(request => (
            <li key={request.id}>
              <Card className="p-5 transition hover:border-white/20">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400/25 to-emerald-700/10 text-base font-semibold text-emerald-200">
                    {request.client.split(' ').slice(0, 2).map(part => part[0]).join('').toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-base font-semibold">{request.client}</p>
                      <Badge tone={STATUS_TONE[request.status] || 'neutral'}>{t(`st_${request.status}`)}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-gray-400">{request.plan} · {request.perWeek} {t('req_per_week')}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {request.days.map(day => (
                        <span key={day} className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-gray-300">{dayLabel(day)}</span>
                      ))}
                      {request.time && <span className="ml-1 flex items-center gap-1 text-xs text-gray-400"><Icon name="clock" className="h-3.5 w-3.5" />{request.time}</span>}
                    </div>
                    {request.reason && <p className="mt-2 text-sm text-red-300/90">{t('req_reason')}: {request.reason}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {request.status === 'pending' && !request.archived && <>
                      <Button variant="primary" onClick={() => openApprove(request)}><Icon name="check" className="h-4 w-4" />{t('req_approve')}</Button>
                      <Button variant="danger" onClick={() => openDecline(request)}>{t('req_reject')}</Button>
                    </>}
                    {request.archived
                      ? <Button variant="secondary" onClick={() => unarchive(request)} disabled={busy}><Icon name="archive" className="h-4 w-4" />{t('req_unarchive')}</Button>
                      : <Button variant="secondary" onClick={() => setArchiving(request)}><Icon name="archive" className="h-4 w-4" />{t('req_archive')}</Button>}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!archiving} busy={busy} tone="neutral" icon="archive"
        title={t('req_archive_title')} text={t('req_archive_text')}
        confirmLabel={t('req_archive_do')} cancelLabel={t('req_archive_keep')}
        onConfirm={archive} onCancel={() => setArchiving(null)}
      />

      <Drawer
        open={!!approving} onClose={() => setApproving(null)} busy={busy}
        title={t('approve_title')} subtitle={approving ? `${approving.client} · ${approving.plan}` : ''}
        footer={<>
          <Button variant="secondary" className="flex-1" onClick={() => setApproving(null)} disabled={busy}>{t('cancel')}</Button>
          <Button variant="primary" className="flex-[2]" onClick={approve} loading={busy}>{busy ? t('approving') : t('approve_confirm')}</Button>
        </>}
      >
        <p className="mb-6 text-sm text-gray-400">{t('approve_sub')}</p>
        <div className="grid gap-x-8 md:grid-cols-2">
        <Field label={t('trainer')}>
          <SelectInput value={form.trainer} onChange={event => setForm({ ...form, trainer: event.target.value })} disabled={busy}>
            <option value="">{t('select_trainer')}</option>
            {trainerOptions.map(({ trainer, badDay, summary }) => (
              <option key={trainer.id} value={trainer.id} disabled={!!badDay}>
                {trainer.name}{badDay ? ` — ${t('av_unavailable')} ${dayFull(badDay)} ${approving.time}${summary ? ` (${t('av_works')} ${summary})` : ''}` : ` — ${summary}`}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label={t('start_date')}>
          <TextInput type="date" min={dateKey(new Date())} value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} disabled={busy} />
        </Field>
        <Field label={t('package')}>
          <SelectInput value={form.plan} onChange={event => setForm({ ...form, plan: event.target.value })} disabled={busy}>
            <option value="">{t('package_keep')}{approving ? ` (${approving.plan})` : ''}</option>
            {plans.map(plan => <option key={plan[0]} value={plan[0]}>{plan[1]}</option>)}
          </SelectInput>
        </Field>
        <Field label={t('frequency')}>
          <SelectInput value={form.perWeek} onChange={event => setForm({ ...form, perWeek: event.target.value })} disabled={busy}>
            {[1, 2, 3, 4, 5, 6, 7].map(value => <option key={value} value={value}>{value}</option>)}
          </SelectInput>
        </Field>
        </div>
        {approving && (
          <p className={`mb-4 rounded-xl border px-4 py-3 text-sm ${nobodyFits ? 'border-red-400/25 bg-red-400/10 text-red-200' : 'border-sky-400/20 bg-sky-400/5 text-sky-100'}`}>
            {nobodyFits ? t('av_none') : `${t('av_hint')} ${approving.days.map(day => dayFull(day)).join(', ')} · ${approving.time}`}
          </p>
        )}
        {sessionEstimate && (
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
            {t('will_create')} <strong className="text-base">{sessionEstimate}</strong> {t('sessions_label')}
          </div>
        )}
        <EmailRecipients value={recipients} onChange={setRecipients} disabled={busy} />
        {busy && <p className="mt-4 text-sm text-amber-300">{t('approving_hint')}</p>}
        {formError && <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{formError}</p>}
      </Drawer>

      <Drawer
        open={!!declining} onClose={() => setDeclining(null)} busy={busy}
        title={t('reject_title')} subtitle={declining ? `${declining.client} · ${declining.plan}` : ''}
        footer={<>
          <Button variant="secondary" className="flex-1" onClick={() => setDeclining(null)} disabled={busy}>{t('cancel')}</Button>
          <Button variant="danger" className="flex-[2]" onClick={decline} loading={busy}>{busy ? t('rejecting') : t('reject_confirm')}</Button>
        </>}
      >
        <p className="mb-6 text-sm text-gray-400">{t('reject_sub')}</p>
        <Field label={t('reject_reason')}>
          <TextArea rows={4} value={reason} onChange={event => setReason(event.target.value)} placeholder={t('reject_reason_ph')} disabled={busy} />
        </Field>
        {formError && <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{formError}</p>}
      </Drawer>
    </div>
  )
}
