import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { adminRequest } from '../api'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { useToast } from '../toastContext'
import { parseDateKey } from '../requests'
import { canStart, hoursSummary, weekdayOf } from '../availability'
import {
  Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Field, Icon,
  PageHeader, SelectInput, Skeleton, TextArea, TextInput
} from '../ui'

const STATUS_TONE = { pending: 'amber', approved: 'sky', confirmed: 'emerald', declined: 'red', rejected: 'red', cancelled: 'neutral' }

export default function TrialSessions() {
  const { t, language, dayFull } = useAdminText()
  const toast = useToast()
  const { trials, trialsResource } = useOutletContext()
  const trainersResource = useAdminResource('/admin/trainer-availability')
  const trainers = useMemo(() => (Array.isArray(trainersResource.data) ? trainersResource.data : []), [trainersResource.data])
  const locale = language === 'es' ? 'es-ES' : 'en-GB'

  const [filter, setFilter] = useState('pending')
  const [query, setQuery] = useState('')
  const [approving, setApproving] = useState(null)
  const [declining, setDeclining] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  const [trainerId, setTrainerId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [working, setWorking] = useState('')   // 'resend-12' | 'calendar-12' while a card button runs
  const [formError, setFormError] = useState('')

  // Only trainers who work on the requested weekday and hour can be chosen.
  const trainerOptions = useMemo(() => {
    if (!approving) return []
    const day = weekdayOf(approving.date)
    return trainers.map(trainer => ({ trainer, day, ok: canStart(trainer, day, approving.time), summary: hoursSummary(trainer, [day]) }))
  }, [trainers, approving])
  const nobodyFits = approving && trainerOptions.length > 0 && trainerOptions.every(option => !option.ok)

  const counts = useMemo(() => ({
    all: trials.length,
    pending: trials.filter(trial => trial.status === 'pending').length,
    approved: trials.filter(trial => trial.status === 'approved').length,
    confirmed: trials.filter(trial => trial.status === 'confirmed').length,
    declined: trials.filter(trial => trial.status === 'declined').length,
    rejected: trials.filter(trial => trial.status === 'rejected').length,
    cancelled: trials.filter(trial => trial.status === 'cancelled').length
  }), [trials])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return trials.filter(trial =>
      (filter === 'all' || trial.status === filter) &&
      (!needle || `${trial.name} ${trial.email} ${trial.phone}`.toLowerCase().includes(needle))
    )
  }, [trials, filter, query])

  const run = async (action, successKey, done) => {
    setBusy(true)
    setFormError('')
    try {
      await action()
      done()
      toast.push(t(successKey))
      trialsResource.reload()
    } catch (error) {
      setFormError(error.message)
      toast.push(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const emailProblem = (code) => {
    if (!code) return ''
    const key = `tr_err_${code}`
    if (code.startsWith('http_')) return `${t('tr_err_http')} (${code.slice(5)})`
    return t(key) === key ? code : t(key)
  }

  // The answer says how the email and the calendar went: the approval itself
  // is never undone, but a problem is shown, not hidden.
  const approve = async () => {
    if (!trainerId) { setFormError(t('select_trainer')); return }
    setBusy(true)
    setFormError('')
    try {
      const result = await adminRequest('POST', `/admin/trial-sessions/${approving.id}/approve`, { trainer_id: Number(trainerId) })
      setApproving(null)
      if (result.email && !result.email.sent) {
        toast.push(`${t('tr_approved_email_failed')} (${emailProblem(result.email.problem)}).`, 'warning')
      } else if (result.calendar && !result.calendar.ok) {
        toast.push(t('tr_approved_calendar_failed'), 'warning')
      } else {
        toast.push(t('tr_approved_ok'))
      }
      trialsResource.reload()
    } catch (error) {
      setFormError(error.message)
      toast.push(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const resend = async (trial) => {
    setWorking(`resend-${trial.id}`)
    try {
      const result = await adminRequest('POST', `/admin/trial-sessions/${trial.id}/resend-approval`)
      if (result.email?.sent) toast.push(t('tr_resend_ok'))
      else toast.push(`${t('tr_resend_failed')} (${emailProblem(result.email?.problem)}).`, 'warning')
      trialsResource.reload()
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setWorking('')
    }
  }

  const createCalendarEvent = async (trial) => {
    setWorking(`calendar-${trial.id}`)
    try {
      const result = await adminRequest('POST', `/admin/trial-sessions/${trial.id}/calendar-event`)
      toast.push(t(result.calendar?.ok ? 'tr_calendar_ok' : 'tr_calendar_error'), result.calendar?.ok ? 'success' : 'warning')
      trialsResource.reload()
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setWorking('')
    }
  }

  // "2026-10-10T10:46" -> "10/10 10:46"
  const stamp = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}` : '')
  const decline = () => run(
    () => adminRequest('POST', `/admin/trial-sessions/${declining.id}/reject`, { reason: reason.trim() }),
    'tr_rejected_ok', () => setDeclining(null))
  const cancel = () => run(
    () => adminRequest('POST', `/admin/trial-sessions/${cancelling.id}/cancel`),
    'tr_cancelled_ok', () => setCancelling(null))

  const filters = [
    ['pending', t('tr_pending')], ['approved', t('tr_approved')], ['confirmed', t('tr_confirmed')], ['declined', t('tr_declined')],
    ['rejected', t('tr_rejected')], ['cancelled', t('tr_cancelled')], ['all', t('tr_all')]
  ]

  return (
    <div className="admin-fade">
      <PageHeader
        title={t('tr_title')} subtitle={t('tr_sub')}
        actions={<Button variant="secondary" onClick={trialsResource.reload}><Icon name="refresh" className="h-4 w-4" />{t('refresh')}</Button>}
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
          <TextInput value={query} onChange={event => setQuery(event.target.value)} placeholder={t('tr_search')} aria-label={t('tr_search')} className="!pl-10" />
        </div>
      </div>

      {trialsResource.error ? (
        <Card><ErrorState message={`${t('load_error')} (${trialsResource.error})`} retryLabel={t('retry')} onRetry={trialsResource.reload} /></Card>
      ) : trialsResource.loading && !trialsResource.data ? (
        <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
      ) : visible.length === 0 ? (
        <Card><EmptyState icon="inbox" title={t('tr_empty')} /></Card>
      ) : (
        <ul className="space-y-3">
          {visible.map(trial => (
            <li key={trial.id}>
              <Card className="p-5 transition hover:border-white/20">
                <div className="flex flex-wrap items-start gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400/25 to-sky-700/10 text-base font-semibold text-sky-200">
                    {trial.name.split(' ').slice(0, 2).map(part => part[0]).join('').toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-base font-semibold">{trial.name}</p>
                      <Badge tone={STATUS_TONE[trial.status] || 'neutral'}>{t(`trs_${trial.status}`)}</Badge>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-400">
                      <a href={`mailto:${trial.email}`} className="inline-block py-1.5 hover:text-emerald-300">{trial.email}</a>
                      <a href={`tel:${trial.phone}`} className="inline-block py-1.5 hover:text-emerald-300">{trial.phone}</a>
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-200">
                        <Icon name="calendar" className="h-3.5 w-3.5" />
                        {parseDateKey(trial.date).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · {trial.time}
                      </span>
                      {trial.goal && <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-gray-300">{t('tr_goal')}: {trial.goal}</span>}
                      {trial.experience && <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-gray-300">{trial.experience}</span>}
                      {trial.age && <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-gray-300">{trial.age}</span>}
                      {trial.trainer && <span className="rounded-md border border-sky-400/20 bg-sky-400/10 px-2 py-0.5 text-xs text-sky-200">{t('tr_trainer')}: {trial.trainer}</span>}
                    </div>
                    {(trial.status === 'approved' || trial.approval_email) && (
                      <p className={`mt-3 text-sm ${trial.approval_email?.status === 'failed' ? 'text-red-300' : 'text-gray-400'}`}>
                        {t('tr_email_label')}:{' '}
                        {trial.approval_email
                          ? trial.approval_email.status === 'sent'
                            ? <span className="text-emerald-300">{t('tr_email_sent')} ✓ ({stamp(trial.approval_email.at)})</span>
                            : <span>{t('tr_email_failed')} ✗ ({emailProblem(trial.approval_email.error)}, {stamp(trial.approval_email.at)})</span>
                          : <span>{t('tr_email_none')}</span>}
                      </p>
                    )}
                    {trial.calendar_missing && (
                      <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                        <span>{trial.calendar_failed ? t('tr_calendar_failed') : t('tr_calendar_missing')}</span>
                        <Button variant="secondary" onClick={() => createCalendarEvent(trial)} loading={working === `calendar-${trial.id}`}>
                          {working === `calendar-${trial.id}` ? t('tr_calendar_creating') : t('tr_calendar_create')}
                        </Button>
                      </div>
                    )}
                    {trial.reason && <p className="mt-2 text-sm text-red-300/90">{t('req_reason')}: {trial.reason}</p>}
                  </div>
                  <div className="flex gap-2">
                    {trial.status === 'pending' && <>
                      <Button variant="primary" onClick={() => { setTrainerId(''); setFormError(''); setApproving(trial) }}><Icon name="check" className="h-4 w-4" />{t('req_approve')}</Button>
                      <Button variant="danger" onClick={() => { setReason(''); setFormError(''); setDeclining(trial) }}>{t('req_reject')}</Button>
                    </>}
                    {trial.status === 'approved' && (
                      <Button variant="secondary" onClick={() => resend(trial)} loading={working === `resend-${trial.id}`}>
                        {working === `resend-${trial.id}` ? t('tr_resending') : t('tr_resend')}
                      </Button>
                    )}
                    {(trial.status === 'approved' || trial.status === 'confirmed') && (
                      <Button variant="danger" onClick={() => { setFormError(''); setCancelling(trial) }}>{t('cl_cancel_session')}</Button>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Drawer
        open={!!approving} onClose={() => setApproving(null)} busy={busy}
        title={t('tr_approve_title')} subtitle={approving ? approving.name : ''}
        footer={<>
          <Button variant="secondary" className="flex-1" onClick={() => setApproving(null)} disabled={busy}>{t('cancel')}</Button>
          <Button variant="primary" className="flex-[2]" onClick={approve} loading={busy}>{busy ? t('tr_approving') : t('tr_approve_confirm')}</Button>
        </>}
      >
        <p className="mb-6 text-sm text-gray-400">{t('tr_approve_sub')}</p>
        {approving && (
          <div className="mb-6 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-100">
            {parseDateKey(approving.date).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })} · {approving.time}
          </div>
        )}
        {approving && (
          <p className={`mb-5 rounded-xl border px-4 py-3 text-sm ${nobodyFits ? 'border-red-400/25 bg-red-400/10 text-red-200' : 'border-sky-400/20 bg-sky-400/5 text-sky-100'}`}>
            {nobodyFits ? t('av_none') : `${t('av_hint')} ${dayFull(weekdayOf(approving.date))} · ${approving.time}`}
          </p>
        )}
        <Field label={t('trainer')}>
          <SelectInput value={trainerId} onChange={event => setTrainerId(event.target.value)} disabled={busy}>
            <option value="">{t('select_trainer')}</option>
            {trainerOptions.map(({ trainer, day, ok, summary }) => (
              <option key={trainer.id} value={trainer.id} disabled={!ok}>
                {trainer.name}{ok ? ` — ${summary}` : ` — ${t('av_unavailable')} ${dayFull(day)} ${approving.time}${summary ? ` (${t('av_works')} ${summary})` : ''}`}
              </option>
            ))}
          </SelectInput>
        </Field>
        {formError && <p role="alert" className="rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{formError}</p>}
      </Drawer>

      <Drawer
        open={!!declining} onClose={() => setDeclining(null)} busy={busy}
        title={t('tr_reject_title')} subtitle={declining ? declining.name : ''}
        footer={<>
          <Button variant="secondary" className="flex-1" onClick={() => setDeclining(null)} disabled={busy}>{t('cancel')}</Button>
          <Button variant="danger" className="flex-[2]" onClick={decline} loading={busy}>{busy ? t('rejecting') : t('reject_confirm')}</Button>
        </>}
      >
        <p className="mb-6 text-sm text-gray-400">{t('tr_reject_sub')}</p>
        <Field label={t('reject_reason')}>
          <TextArea rows={4} value={reason} onChange={event => setReason(event.target.value)} placeholder={t('reject_reason_ph')} disabled={busy} />
        </Field>
        {formError && <p role="alert" className="rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{formError}</p>}
      </Drawer>

      <ConfirmDialog
        open={!!cancelling} busy={busy}
        title={t('tr_cancel_title')} text={t('tr_cancel_text')}
        confirmLabel={t('tr_cancel_do')} cancelLabel={t('tr_cancel_keep')}
        onConfirm={cancel} onCancel={() => setCancelling(null)}
      />
    </div>
  )
}
