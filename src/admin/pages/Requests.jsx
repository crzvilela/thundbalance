import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { adminRequest } from '../api'
import RecipientsBox, { SendsTo } from '../RecipientsBox'
import { extraBody } from '../recipients'
import { reportEmailResult } from '../recipientsState'
import { reportCalendarResult } from '../calendarSync'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { useToast } from '../toastContext'
import { normalizeRequests } from '../requests'
import { BulkBar, RowCheck, SelectAllRow } from '../BulkBar'
import { useBulkSelection, SELECTING_CLASS, selectableProps } from '../bulk'
import { PriceBox, TypeBadge } from '../SessionKind'
import { formatMoney, packQuote, packsOfType } from '../../utils/pricing'
import PackSchedulePicker from '../../components/forms/PackSchedulePicker'
import PackScheduleSummary from '../../components/forms/PackScheduleSummary'
import { fromStored, isComplete, toBody } from '../../utils/packSchedule'
import { usePackAvailability } from '../../utils/usePackAvailability'
import { OverlapAsk } from '../OverlapWarning'
import {
  Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Field, Icon, PageHeader,
  SelectInput, Skeleton, TextArea, TextInput
} from '../ui'

const STATUS_TONE = { pending: 'amber', approved: 'emerald', rejected: 'red' }
const requestKey = request => request.id

export default function Requests() {
  const { t, language, dayLabel } = useAdminText()
  const toast = useToast()
  const { requests, requestsResource } = useOutletContext()
  const catalogResource = useAdminResource('/pricing')        // the catalogue: only the packs on sale
  // The layout's list leaves archived requests out; this one has only them.
  const archivedResource = useAdminResource('/admin/client-requests?archived=only')
  const archivedRequests = useMemo(() => normalizeRequests(archivedResource.data), [archivedResource.data])

  const [filter, setFilter] = useState('pending')
  const [query, setQuery] = useState('')
  const [approving, setApproving] = useState(null)
  const [declining, setDeclining] = useState(null)
  const [archiving, setArchiving] = useState(null)
  const [form, setForm] = useState({ date: '', plan: '', perWeek: '' })
  const [entries, setEntries] = useState([])              // the final schedule: one entry per day (hour and trainer), adjusted before approving
  const [legacy, setLegacy] = useState(false)             // the request is an old one with a single hour
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [share, setShare] = useState(true)                // the client is a guest of the events in their Google Calendar
  const [extra, setExtra] = useState([])                  // more recipients of the pack email (BCC); the client always gets it
  const [formError, setFormError] = useState('')
  const [conflicts, setConflicts] = useState([])
  const [overlaps, setOverlaps] = useState([])            // the client would have two sessions at the same time as another pack
  const [trainerOk, setTrainerOk] = useState(false)         // the admin already accepted the trainer's collisions

  const packs = useMemo(() => catalogResource.data?.packs || [], [catalogResource.data])

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
  const selection = useBulkSelection(visible, requestKey)

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
    // what the client asked for is already chosen, day by day; an OLD request (one hour) is shown as such and prefilled with it
    const asked = fromStored({ schedule: request.schedule, days: request.days.join(','), time: request.time, trainerId: request.trainerId })
    setEntries(asked.entries)
    setLegacy(asked.legacy)
    setForm({ date: '', plan: '', perWeek: String(request.perWeek || asked.entries.length || 1) })
    setFormError('')
    setConflicts([])
    setOverlaps([])
    setTrainerOk(false)
    setExtra([])
    setShare(true)
    setApproving(request)
  }
  const openDecline = (request) => {
    setReason('')
    setFormError('')
    setDeclining(request)
  }

  // The type is fixed by the request, so the packs offered are the ones on sale of that type. The pack that will be used is the
  // one chosen here, else the one the client asked for (a request made before the catalogue is matched by its name).
  const typePacks = useMemo(() => (approving ? packsOfType({ packs }, approving.sessionType) : []), [packs, approving])
  const chosenPack = useMemo(() => {
    if (!approving) return null
    if (form.plan) return typePacks.find(pack => String(pack.id) === form.plan) || null
    return packs.find(pack => pack.id === approving.catalogPackId) || typePacks.find(pack => pack.name === approving.plan) || null
  }, [approving, form.plan, packs, typePacks])
  const perWeekOptions = chosenPack ? chosenPack.sessions_per_week_options : [1, 2, 3, 4, 5, 6, 7]
  // the free hours for THIS pack from the start date (working hours only until a date is chosen)
  const availability = usePackAvailability({ startDate: form.date, weeks: chosenPack?.weeks || 0 })

  // How many sessions the approval will create (pack weeks x sessions per week) and what it costs.
  const sessionEstimate = chosenPack && form.perWeek ? chosenPack.weeks * Number(form.perWeek) : null
  const approvalPrice = useMemo(() => {
    if (!approving || !chosenPack) return { perSession: null, total: null }
    const quote = packQuote(chosenPack, form.perWeek)
    return { perSession: quote.perSession, total: quote.total }
  }, [approving, chosenPack, form.perWeek])
  const choosePack = (id) => {
    const pack = typePacks.find(item => String(item.id) === id)
    const keep = !pack || pack.sessions_per_week_options.includes(Number(form.perWeek))
    setForm({ ...form, plan: id, ...(keep ? {} : { perWeek: String(pack.sessions_per_week_options[0]) }) })
  }

  const approve = async (allowConflicts = false, allowOverlaps = false) => {
    if (!form.date) { setFormError(t('need_trainer_date')); return }
    if (!isComplete(entries, form.perWeek)) { setFormError(t('ps_choose_hours')); return }
    setBusy(true)
    setFormError('')
    try {
      const result = await adminRequest('POST', '/admin/approve-request', {
        ...extraBody(extra),
        share_calendar: share,
        request_id: approving.id,
        schedule: toBody(entries),               // one entry per day: weekday, hour and trainer
        start_date: form.date,
        allow_conflicts: allowConflicts || trainerOk,
        allow_overlaps: allowOverlaps,
        ...(form.plan ? { pack_id: Number(form.plan) } : {}),
        ...(form.perWeek ? { sessions_per_week: Number(form.perWeek) } : {})
      })
      setApproving(null)
      setConflicts([])
      toast.push(t('approved_ok'))
      reportEmailResult(toast, t, result.email)
      reportCalendarResult(toast, t, result.calendar)
      requestsResource.reload()
    } catch (error) {
      if (error.code === 'schedule_unavailable') { availability.reload(); setFormError(t('ps_race_admin')) }
      else if (error.code === 'conflicts') setConflicts(error.conflicts || [])   // listed in the modal, with "Crear igualmente"
      else if (error.code === 'client_overlap') setOverlaps(error.detail?.overlaps || [])   // a warning, with "Continuar igualmente"
      else setFormError(error.message || t('action_error'))
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
      <PageHeader pageKey="requests"
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
        <>
        <SelectAllRow selection={selection} />
        <ul className="space-y-3">
          {visible.map(request => (
            <li key={request.id}>
              <Card {...selectableProps(selection, request.id)} className={`p-5 transition hover:border-white/20 ${selection.chosen.has(request.id) ? '!border-emerald-400/40' : ''} ${selection.active ? SELECTING_CLASS : ''}`}>
                <div className="flex flex-wrap items-center gap-4">
                  <RowCheck selection={selection} id={request.id} label={t('bk_select_one').replace('{name}', request.client)} />
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400/25 to-emerald-700/10 text-base font-semibold text-emerald-200">
                    {request.client.split(' ').slice(0, 2).map(part => part[0]).join('').toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-base font-semibold">{request.client}</p>
                      <Badge tone={STATUS_TONE[request.status] || 'neutral'}>{t(`st_${request.status}`)}</Badge>
                      <TypeBadge type={request.sessionType} secondName={request.secondName} />
                    </div>
                    <p className="mt-1 text-sm text-gray-400">{request.plan} · {request.perWeek} {t('req_per_week')}</p>
                    {request.trainer && <p className="mt-1 text-sm text-sky-200">{t(request.status === 'pending' ? 'req_trainer_requested' : 'req_trainer')}: {request.trainer}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {request.schedule.length > 0 ? request.schedule.map(entry => (
                        <span key={entry.weekday} className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-gray-300">
                          {dayLabel(entry.weekday)} · {String(entry.time).slice(0, 5)}{entry.trainer ? ` · ${entry.trainer}` : ''}
                        </span>
                      )) : (<>
                        {request.days.map(day => (
                          <span key={day} className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-gray-300">{dayLabel(day)}</span>
                        ))}
                        {request.time && <span className="ml-1 flex items-center gap-1 text-xs text-gray-400"><Icon name="clock" className="h-3.5 w-3.5" />{request.time}</span>}
                        <span className="text-xs text-amber-300">{t('ps_old_label')}</span>
                      </>)}
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
        </>
      )}

      <BulkBar
        selection={selection} onDone={reloadAll}
        labelOf={id => visible.find(request => request.id === id)?.client || t('bk_deleted_item').replace('{id}', id)}
        actions={[
          filter === 'archived'
            ? { key: 'unarchive', verb: 'unarchive', tone: 'neutral', label: t('bk_a_unarchive'), effects: [t('bk_fx_requests')],
                run: ids => adminRequest('POST', '/admin/client-requests/bulk', { action: 'unarchive', ids }) }
            : { key: 'archive', verb: 'archive', tone: 'neutral', label: t('bk_a_archive'), effects: [t('bk_fx_requests')],
                run: ids => adminRequest('POST', '/admin/client-requests/bulk', { action: 'archive', ids }) }
        ]}
      />

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
          <Button variant="primary" className="flex-[2]" onClick={() => approve()} loading={busy}>{busy ? t('approving') : t('approve_confirm')}</Button>
        </>}
      >
        <p className="mb-6 text-sm text-gray-400">{t('approve_sub')}</p>
        <div className="grid gap-x-8 md:grid-cols-2">
        <Field label={t('start_date')}>
          <TextInput type="date" value={form.date} onChange={event => { setConflicts([]); setForm({ ...form, date: event.target.value }) }} disabled={busy} />
        </Field>
        <Field label={t('package')}>
          <SelectInput value={form.plan} onChange={event => choosePack(event.target.value)} disabled={busy}>
            <option value="">{t('package_keep')}{approving ? ` (${approving.plan})` : ''}</option>
            {typePacks.map(pack => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
          </SelectInput>
        </Field>
        <Field label={t('frequency')}>
          <SelectInput value={form.perWeek} onChange={event => setForm({ ...form, perWeek: event.target.value })} disabled={busy || perWeekOptions.length === 1}>
            {perWeekOptions.map(value => <option key={value} value={value}>{value}</option>)}
          </SelectInput>
        </Field>
        </div>
        {approving && (
          <div className="mb-5">
            <p className="mb-3 text-sm text-sky-100">{t('ps_adjust')}</p>
            <PackSchedulePicker
              value={entries} onChange={setEntries} perWeek={Number(form.perWeek)} availability={availability}
              text={t} dayLabel={dayLabel} variant="admin" trainerRequired disabled={busy} legacy={legacy}
            />
            <PackScheduleSummary
              className="mt-4 rounded-xl border border-white/10 p-4" value={entries} availability={availability.data}
              start={form.date} total={sessionEstimate || 0} text={t} dayLabel={dayLabel} locale={language === 'es' ? 'es-ES' : 'en-GB'}
            />
          </div>
        )}
        {approving && (
          <div className="mb-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-300">
              <span>{t('ty_type_row')}:</span>
              <strong>{approving.sessionType === 'dual' ? t('ty_dual') : t('ty_individual')}</strong>
              <span className="text-xs text-gray-500">({t('ty_fixed')})</span>
            </div>
            {approving.sessionType === 'dual' && (
              <p className="text-sm text-gray-300">{t('ty_second_person')}: <strong>{approving.secondName}</strong> · {approving.secondEmail}</p>
            )}
            <PriceBox
              title={t('ty_summary')}
              warning={catalogResource.data && approvalPrice?.perSession == null ? t('ty_no_price') : undefined}
              rows={[
                { label: t('ty_price_session'), value: formatMoney(approvalPrice?.perSession) },
                { label: t('ty_price_total'), value: formatMoney(approvalPrice?.total), strong: true }
              ]}
            />
          </div>
        )}
        {sessionEstimate && (
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
            {t('will_create')} <strong className="text-base">{sessionEstimate}</strong> {t('sessions_label')}
          </div>
        )}
        <RecipientsBox clientEmail={approving?.clientEmail || ''} value={extra} onChange={setExtra} disabled={busy} shareCalendar={share} onShareCalendar={setShare} />
        <SendsTo clientEmail={approving?.clientEmail || ''} extra={extra} />
        {busy && <p className="mt-4 text-sm text-amber-300">{t('approving_hint')}</p>}
        {conflicts.length > 0 && (
          <div role="alert" className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-100">
            <p className="mb-2 text-sm">{t('cf_question')}</p>
            <ul className="mb-3 space-y-1 text-sm">
              {conflicts.slice(0, 12).map(conflict => (
                <li key={`${conflict.date}-${conflict.kind}`}>{conflict.date} · {conflict.time} — {t(`cf_${conflict.kind}`)}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => setConflicts([])} disabled={busy}>{t('cf_change')}</Button>
              <Button variant="primary" onClick={() => { setTrainerOk(true); approve(true) }} loading={busy}>{t('cf_create_anyway')}</Button>
            </div>
          </div>
        )}
        <OverlapAsk overlaps={overlaps} busy={busy} onChange={() => setOverlaps([])} onContinue={() => { setOverlaps([]); approve(trainerOk, true) }} />
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
