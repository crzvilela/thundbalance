import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { adminRequest } from '../api'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { useToast } from '../toastContext'
import { madridWallClock, NEUTRAL_COLOR } from '../calendar/calendarConfig'
import { TABS, readParams, shortDate, statusesOf, tabByKey, tabCount, tabOfStatus } from '../scheduleRequests'
import ScheduleCard from '../ScheduleCard'
import { CounterDrawer, LateProposalDialog, RejectDrawer } from '../ScheduleDialogs'
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, Icon, PageHeader, Skeleton, TextInput } from '../ui'

const PAGE_SIZE = 25
const CHECK = 'h-4 w-4 accent-emerald-400'

// adminRequest appends " (HTTP 409)" to the server's message; the cards do not need it
const clean = (message) => String(message || '').replace(/\s*\(HTTP \d+\)$/, '')

// Schedule: the clients' date-change requests. The studio approves (the session moves), declines or
// proposes another hour (it only moves if the client accepts). The tab, search, trainers, page and the
// highlighted request live in the URL, so a link shows the same screen.
export default function Schedule() {
  const { t } = useAdminText()
  const toast = useToast()
  const { scheduleResource } = useOutletContext()
  const [params, setParams] = useSearchParams()
  const { tab, q, trainers: trainerIds, request, page } = readParams(params)
  const hasTab = params.has('tab')
  const trainersKey = trainerIds.join(',')

  const update = useCallback((patch) => {
    setParams(current => {
      const next = new URLSearchParams(current)
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '' || value === undefined) next.delete(key)
        else next.set(key, String(value))
      }
      return next
    }, { replace: true })
  }, [setParams])

  // ---- data
  const path = useMemo(() => {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) })
    const statuses = statusesOf(tab)
    if (statuses) query.set('status', statuses)
    if (q.trim()) query.set('email', q.trim())
    if (trainersKey) query.set('trainer_ids', trainersKey)
    return `/admin/reschedule-requests?${query}`
  }, [tab, q, page, trainersKey])
  const resource = useAdminResource(path)
  const trainersResource = useAdminResource('/admin/trainer-availability')
  const trainers = useMemo(() => (Array.isArray(trainersResource.data) ? trainersResource.data : []), [trainersResource.data])
  const counts = resource.data?.counts
  const total = resource.data?.total || 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const [now, setNow] = useState(() => madridWallClock())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(madridWallClock()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  // the menu badge is refreshed when the page opens and after every action
  const reloadCount = scheduleResource.reload
  useEffect(() => { reloadCount() }, [reloadCount])

  // ---- a request opened from a link (?request=12): its tab is chosen and it is highlighted
  const [pinned, setPinned] = useState(null)
  useEffect(() => {
    if (!request) return undefined
    let active = true
    adminRequest('GET', `/admin/reschedule-requests?request_id=${request}&limit=1`).then(result => {
      if (!active) return
      const found = result.items?.[0]
      if (!found) { toast.push(t('sch_not_found'), 'warning'); return }
      setPinned(found)
      if (!hasTab) update({ tab: tabOfStatus(found.status) })
    }).catch(() => {})
    return () => { active = false }
  }, [request, hasTab, update, toast, t])

  const items = useMemo(() => {
    const list = resource.data?.items || []
    const wanted = tabByKey(tab).statuses
    const shows = pinned && pinned.id === request && (!wanted.length || wanted.includes(pinned.status)) && !list.some(item => item.id === pinned.id)
    return shows ? [pinned, ...list] : list
  }, [resource.data, pinned, request, tab])

  const scrolled = useRef(null)
  useEffect(() => {
    if (!request || scrolled.current === request || !items.some(item => item.id === request)) return
    scrolled.current = request
    document.getElementById(`request-${request}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [items, request])

  // ---- search (written to the URL after a short pause)
  const [search, setSearch] = useState(q)
  useEffect(() => {
    if (search.trim() === q.trim()) return undefined
    const timer = window.setTimeout(() => update({ q: search.trim(), page: null, request: null }), 350)
    return () => window.clearTimeout(timer)
  }, [search, q, update])

  const toggleTrainer = (id) => update({
    trainers: (trainerIds.includes(id) ? trainerIds.filter(item => item !== id) : [...trainerIds, id]).join(','), page: null, request: null
  })
  const filtered = !!(q.trim() || trainerIds.length)
  const clearFilters = () => { setSearch(''); update({ q: null, trainers: null, page: null, request: null }) }

  // ---- actions (one at a time: the buttons are disabled meanwhile)
  const [busyId, setBusyId] = useState(null)
  const busyRef = useRef(false)
  const [syncingId, setSyncingId] = useState(null)
  const [errors, setErrors] = useState({})            // request id -> message shown in its card
  const [emailFailed, setEmailFailed] = useState({})  // request id -> true when the last email did not go out
  const [dialogError, setDialogError] = useState('')
  const [approving, setApproving] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [countering, setCountering] = useState(null)
  const [late, setLate] = useState(null)                  // a proposal the server refused for lack of notice: { item, date, time, note }

  const refresh = useCallback(() => {
    setPinned(null)
    resource.reload()
    scheduleResource.reload()
  }, [resource, scheduleResource])

  const closeDialogs = () => { setApproving(null); setRejecting(null); setCountering(null); setLate(null); setDialogError('') }

  // Runs `work` for one request. A request somebody else already decided is not an error to puzzle over:
  // say so and show the list as it is now.
  const act = async (item, work, onError) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusyId(item.id)
    setErrors(current => ({ ...current, [item.id]: '' }))
    try {
      await work()
    } catch (error) {
      if (error.code === 'closed') {
        toast.push(t('sch_already'), 'warning')
        closeDialogs()
        refresh()
      } else {
        onError(clean(error.message) || t('action_error'), error)
      }
    } finally {
      busyRef.current = false
      setBusyId(null)
    }
  }

  const afterEmail = (item, result) => {
    const failed = !!result.email && !result.email.sent
    if (failed) toast.push(t('sch_email_failed'), 'warning')
    setEmailFailed(current => ({ ...current, [item.id]: failed }))
  }

  const approve = async (item) => {
    await act(item, async () => {
      const result = await adminRequest('POST', `/admin/reschedule-requests/${item.id}/approve`)
      if (result.repeated) toast.push(t('sch_already'), 'warning')
      else {
        toast.push(t('sch_moved').replace('{date}', shortDate(item.requested_date)).replace('{time}', item.requested_time))
        if (result.session?.sync_status === 'failed') toast.push(t('sch_google_warn'), 'warning')
        afterEmail(item, result)
      }
      refresh()
    }, message => setErrors(current => ({ ...current, [item.id]: message })))
    setApproving(null)
  }

  const reject = async (item, note) => {
    await act(item, async () => {
      const result = await adminRequest('POST', `/admin/reschedule-requests/${item.id}/reject`, { note })
      toast.push(result.repeated ? t('sch_already') : t('sch_rejected_ok'), result.repeated ? 'warning' : 'success')
      if (!result.repeated) afterEmail(item, result)
      setRejecting(null)
      refresh()
    }, setDialogError)
  }

  // confirmLate: the studio accepted that the client will not have the full notice (the client then answers until the session starts)
  const counter = async (item, date, time, note, confirmLate = false) => {
    await act(item, async () => {
      const result = await adminRequest('POST', `/admin/reschedule-requests/${item.id}/counter`, { date, time, note, confirm_late: confirmLate })
      toast.push(t('sch_counter_ok'))
      afterEmail(item, result)
      setCountering(null); setLate(null)
      refresh()
    }, (message, error) => {
      if (error?.code === 'too_late_for_client') setLate({ item, date, time, note })        // ask: send anyway, or move the session directly
      else { setLate(null); setDialogError(message) }
    })
  }

  // The studio moves the session directly to the hour it had chosen: no notice period, the client is told by e-mail.
  const moveDirectly = async () => {
    const { item, date, time, note } = late
    await act(item, async () => {
      await adminRequest('POST', `/admin/sessions/${item.session_id}/reschedule`, { session_date: date, session_time: time, note: note || null })
      toast.push(t('sch_moved').replace('{date}', shortDate(date)).replace('{time}', time))
      setCountering(null); setLate(null)
      refresh()
    }, (message) => { setLate(null); setDialogError(message) })
  }

  const resend = async (item) => {
    await act(item, async () => {
      const result = await adminRequest('POST', `/admin/reschedule-requests/${item.id}/resend-email`)
      const sent = !!result.email?.sent
      toast.push(sent ? t('sch_resent') : t('sch_resend_failed'), sent ? 'success' : 'warning')
      setEmailFailed(current => ({ ...current, [item.id]: !sent }))
    }, message => setErrors(current => ({ ...current, [item.id]: message })))
  }

  const syncGoogle = async (item) => {
    if (busyRef.current) return
    setSyncingId(item.id)
    try {
      const result = await adminRequest('POST', `/admin/sessions/${item.session_id}/sync-calendar`)
      toast.push(result.ok ? t('ac_sync_ok') : t('ac_sync_failed'), result.ok ? 'success' : 'warning')
      refresh()
    } catch (error) {
      setErrors(current => ({ ...current, [item.id]: clean(error.message) }))
    } finally {
      setSyncingId(null)
    }
  }

  const emptyTitle = filtered ? 'sch_empty_filtered' : tab === 'pending' ? 'sch_empty_pending' : tab === 'counter' ? 'sch_empty_counter' : 'sch_empty_other'
  const dialogBusy = !!busyId

  return (
    <div className="admin-fade">
      <PageHeader
        title={t('sch_title')}
        subtitle={t('sch_sub')}
        actions={<Button variant="secondary" onClick={refresh}><Icon name="refresh" className="h-4 w-4" />{t('refresh')}</Button>}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('sch_tabs')}>
          {TABS.map(item => {
            const selected = tab === item.key
            return (
              <button key={item.key} type="button" role="tab" aria-selected={selected} onClick={() => update({ tab: item.key, page: null, request: null })}
                className={`flex min-h-[44px] items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${
                  selected ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-gray-400 hover:border-white/25 hover:text-white'
                }`}>
                {t(`sch_tab_${item.key}`)}
                <span className={`rounded-full px-1.5 text-xs tabular-nums ${selected ? 'bg-emerald-400/20' : 'bg-white/10'}`}>{counts ? tabCount(item.key, counts) : '–'}</span>
              </button>
            )
          })}
        </div>
        <div className="relative w-full sm:w-72">
          <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <TextInput type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('sch_search')} aria-label={t('sch_search')} className="!pl-10" />
        </div>
      </div>

      <fieldset className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2">
        <legend className="sr-only">{t('sch_trainers')}</legend>
        <span aria-hidden="true" className="text-xs font-medium uppercase tracking-wider text-gray-500">{t('sch_trainers')}</span>
        <label className="flex min-h-[36px] cursor-pointer items-center gap-2 text-sm text-gray-200">
          <input type="checkbox" checked={trainerIds.length === 0} onChange={() => update({ trainers: null, page: null, request: null })} className={CHECK} />
          {t('sch_all_trainers')}
        </label>
        {trainers.map(trainer => (
          <label key={trainer.id} className="flex min-h-[36px] cursor-pointer items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" checked={trainerIds.includes(trainer.id)} onChange={() => toggleTrainer(trainer.id)} className={CHECK} />
            <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: trainer.color || NEUTRAL_COLOR }} />
            {trainer.name}
          </label>
        ))}
        {filtered && <Button variant="ghost" onClick={clearFilters}>{t('sch_clear')}</Button>}
      </fieldset>

      <div role="tabpanel">
        {resource.error ? (
          <Card><ErrorState message={`${t('load_error')} (${resource.error})`} retryLabel={t('retry')} onRetry={resource.reload} /></Card>
        ) : resource.loading && !resource.data ? (
          <div className="space-y-3" role="status" aria-label="…"><Skeleton className="h-48" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
        ) : items.length === 0 ? (
          <Card><EmptyState icon="inbox" title={t(emptyTitle)} /></Card>
        ) : (
          <ul className="space-y-3">
            {items.map(item => (
              <ScheduleCard
                key={item.id} item={item} now={now} highlight={item.id === request}
                busy={busyId === item.id} locked={!!busyId} syncing={syncingId === item.id}
                error={errors[item.id]} emailFailed={!!emailFailed[item.id]}
                onApprove={setApproving} onReject={(target) => { setDialogError(''); setRejecting(target) }}
                onCounter={(target) => { setDialogError(''); setCountering(target) }}
                onResend={resend} onSync={syncGoogle}
              />
            ))}
          </ul>
        )}
      </div>

      {pages > 1 && (
        <nav className="mt-6 flex flex-wrap items-center justify-between gap-3" aria-label="Pagination">
          <Button variant="secondary" onClick={() => update({ page: page - 1 || null, request: null })} disabled={page <= 1}>{t('sch_prev')}</Button>
          <span className="text-sm text-gray-400">{t('sch_page').replace('{page}', page).replace('{pages}', pages)} · {t('sch_requests_found').replace('{total}', total)}</span>
          <Button variant="secondary" onClick={() => update({ page: page + 1, request: null })} disabled={page >= pages}>{t('sch_next')}</Button>
        </nav>
      )}

      <ConfirmDialog
        open={!!approving} busy={dialogBusy} tone="neutral" icon="check"
        title={t('sch_approve_title')}
        text={approving ? t('sch_approve_text').replace('{client}', approving.client_email)
          .replace('{from}', `${shortDate(approving.session_date)} ${approving.session_time}`)
          .replace('{to}', `${shortDate(approving.requested_date)} ${approving.requested_time}`) : ''}
        confirmLabel={t('sch_approve_do')} cancelLabel={t('sch_keep')}
        onConfirm={() => approve(approving)} onCancel={() => setApproving(null)}
      />
      <RejectDrawer item={rejecting} busy={dialogBusy} error={dialogError} onClose={closeDialogs} onConfirm={(note) => reject(rejecting, note)} />
      <CounterDrawer item={countering} busy={dialogBusy} error={dialogError} onClose={closeDialogs} onConfirm={(date, time, note) => counter(countering, date, time, note)} />
      <LateProposalDialog info={late} busy={dialogBusy} onSend={() => counter(late.item, late.date, late.time, late.note, true)} onMove={moveDirectly} onCancel={() => setLate(null)} />
    </div>
  )
}
