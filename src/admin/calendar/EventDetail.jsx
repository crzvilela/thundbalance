import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_URL } from '../../config'
import { adminRequest } from '../api'
import { useAdminText } from '../useAdminText'
import { useToast } from '../toastContext'
import { useFocusTrap } from '../useFocusTrap'
import { Badge, Button, ConfirmDialog, Icon } from '../ui'
import { NEUTRAL_COLOR, dayKey, describeWhen, madridWallClock } from './calendarConfig'

const STATUS_TONE = { booked: 'emerald', completed: 'neutral', cancelled: 'red', rescheduled: 'amber', pending: 'amber', approved: 'sky', confirmed: 'emerald', declined: 'red', rejected: 'red' }

function Row({ label, children }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <dt className="text-xs uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="mt-1 break-words text-base text-white">{children || <span className="text-gray-500">—</span>}</dd>
    </div>
  )
}

// What the admin sees when an event is clicked. Reschedule / cancel use the very same
// endpoint as the client's page (DELETE /sessions/{id}); the studio moves a session DIRECTLY with
// POST /admin/sessions/{id}/reschedule: no request, no limit, same conflict checks.
export default function EventDetail({ event, onClose, onChanged }) {
  const { t, language } = useAdminText()
  const toast = useToast()
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const [mode, setMode] = useState('view')              // view | reschedule
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')
  const [times, setTimes] = useState([])
  const [loadingTimes, setLoadingTimes] = useState(false)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const panel = useRef(null)

  const props = event.extendedProps
  const isTrial = props.kind === 'trial'
  const color = props.color || NEUTRAL_COLOR
  const start = event.startStr.slice(0, 19)
  const end = event.endStr.slice(0, 19)
  const changeable = !isTrial && (props.status === 'booked' || props.status === 'rescheduled')
  const statusLabel = isTrial ? t(`ac_tr_${props.status}`) : t(`ac_st_${props.status}`)
  // the studio's Google Calendar follows the app; this button makes it match when it does not
  const canSync = !isTrial || props.status === 'confirmed'
  const syncFailed = props.syncStatus === 'failed'

  useFocusTrap(panel, true)
  useEffect(() => {
    const onKey = (keyEvent) => { if (keyEvent.key === 'Escape' && !saving && !confirmCancel) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, saving, confirmCancel])

  const pickDate = async (value) => {
    setNewDate(value); setNewTime(''); setTimes([]); setMessage('')
    if (!value) return
    setLoadingTimes(true)
    try {
      // free hours of this trainer, straight from the database
      const response = await fetch(`${API_URL}/trainer/${props.trainerId}/available-times/${value}`)
      const list = response.ok ? await response.json() : []
      const today = dayKey(madridWallClock())
      const nowTime = madridWallClock().toISOString().slice(11, 16)
      const free = list.map(item => String(item).slice(0, 5)).filter(time => value !== today || time > nowTime)
      setTimes(free)
      if (!free.length) setMessage(t('ac_no_times'))
    } catch {
      setMessage(t('ac_times_error'))
    } finally {
      setLoadingTimes(false)
    }
  }

  const syncGoogle = async () => {
    setSyncing(true); setMessage('')
    try {
      const result = isTrial
        ? await adminRequest('POST', `/admin/trial-sessions/${props.trialId}/calendar-event`)
        : await adminRequest('POST', `/admin/sessions/${props.sessionId}/sync-calendar`)
      const ok = isTrial ? result.calendar?.ok : result.ok
      if (ok) toast.push(t('ac_sync_ok'))
      else setMessage(t('ac_sync_failed'))
      onChanged()
      if (ok) onClose()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSyncing(false)
    }
  }

  const move = async () => {
    setSaving(true); setMessage('')
    try {
      await adminRequest('POST', `/admin/sessions/${props.sessionId}/reschedule`, { session_date: newDate, session_time: newTime })
      toast.push(t('ac_moved'))
      onChanged()
      onClose()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  const cancel = async () => {
    setSaving(true)
    try {
      await adminRequest('DELETE', `/sessions/${props.sessionId}`)
      toast.push(t('ac_cancelled_ok'))
      setConfirmCancel(false)
      onChanged()
      onClose()
    } catch (error) {
      setConfirmCancel(false)
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-8">
        <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={() => { if (!saving) onClose() }} />
        <aside ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={event.title}
          className="admin-modal relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0b0e0d] shadow-2xl shadow-black/60 outline-none">
          <div className="flex items-start justify-between gap-4 border-b border-white/10 bg-white/[0.02] px-6 py-5">
            <div className="min-w-0">
              <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-gray-400">
                <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: color }} />
                {isTrial ? t('ac_trial') : t('ac_session')}
              </p>
              <h2 className="break-words text-2xl font-semibold text-white">{event.title}</h2>
            </div>
            <button type="button" onClick={onClose} disabled={saving} aria-label={t('ac_close')} className="rounded-xl p-2.5 text-gray-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40">
              <Icon name="close" className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Row label={t('ac_when')}><span className="first-letter:uppercase">{describeWhen(start, end, locale)}</span></Row></div>
              <Row label={t('ac_trainer')}>
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
                  {props.trainer || t('ac_unassigned')}
                </span>
              </Row>
              <Row label={t('ac_status')}><Badge tone={STATUS_TONE[props.status] || 'neutral'}>{statusLabel}</Badge></Row>
              <Row label={t('ac_client')}>{props.clientName}</Row>
              <Row label={t('ac_email')}>{props.email && <a href={`mailto:${props.email}`} className="text-emerald-300 underline underline-offset-4">{props.email}</a>}</Row>
              <Row label={t('ac_phone')}>{props.phone && <a href={`tel:${props.phone.replace(/\s/g, '')}`} className="underline underline-offset-4">{props.phone}</a>}</Row>
              {isTrial
                ? <Row label={t('ac_goal')}>{props.goal}</Row>
                : <Row label={`${t('ac_session')} / ${t('ac_pack')}`}>{[props.number, props.pack].filter(Boolean).join(' · ')}</Row>}
            </dl>

            {mode === 'reschedule' && (
              <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">{t('ac_new_date')}</span>
                  <input type="date" min={dayKey(madridWallClock())} value={newDate} onChange={(inputEvent) => pickDate(inputEvent.target.value)} disabled={saving}
                    style={{ colorScheme: 'dark' }} className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-white outline-none focus:border-emerald-400/70" />
                </label>
                {newDate && (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-400">{t('ac_new_time')}{loadingTimes && ` · ${t('ac_loading_times')}`}</p>
                    <div className="flex flex-wrap gap-2">
                      {times.map(time => (
                        <button key={time} type="button" onClick={() => setNewTime(time)} aria-pressed={newTime === time}
                          className={`rounded-xl border px-4 py-2 text-sm tabular-nums transition ${newTime === time ? 'border-emerald-400 bg-emerald-400 font-semibold text-black' : 'border-white/15 text-gray-200 hover:border-white/40'}`}>{time}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {props.changeRequestId && (
              <p role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                <span className="font-semibold">{props.changeRequestStatus === 'counter_proposed' ? t('sch_open_counter') : t('sch_open_change')}</span>
                <Link to={`/admin/schedule?request=${props.changeRequestId}`} className="font-semibold underline underline-offset-4">{t('sch_view_request')}</Link>
              </p>
            )}

            {syncFailed && (
              <p role="alert" className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">{t('ac_sync_warning')}{props.syncError ? ` (${props.syncError})` : ''}</p>
            )}

            {message && <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{message}</p>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-white/[0.02] px-6 py-4">
            <div className="flex flex-wrap gap-3">
              {props.clientId && <Link to={`/admin/clients?client=${props.clientId}`} className="inline-flex min-h-[44px] items-center rounded-xl border border-white/15 px-4 text-sm font-semibold text-gray-100 transition hover:bg-white/10">{t('ac_client_file')}</Link>}
              {canSync && <Button variant="secondary" onClick={syncGoogle} loading={syncing} disabled={saving}><Icon name="refresh" className="h-4 w-4" />{syncing ? t('ac_syncing') : t('ac_sync_google')}</Button>}
              {isTrial && <Link to="/admin/trials" className="inline-flex min-h-[44px] items-center rounded-xl border border-white/15 px-4 text-sm font-semibold text-gray-100 transition hover:bg-white/10">{t('ac_trials_page')}</Link>}
            </div>
            <div className="flex flex-wrap gap-3">
              {changeable && mode === 'view' && <>
                <Button variant="secondary" onClick={() => { setMode('reschedule'); setMessage('') }}>{t('ac_reschedule')}</Button>
                <Button variant="danger" onClick={() => setConfirmCancel(true)}>{t('ac_cancel_session')}</Button>
              </>}
              {changeable && mode === 'reschedule' && <>
                <Button variant="secondary" onClick={() => { setMode('view'); setMessage('') }} disabled={saving}>{t('ac_back')}</Button>
                <Button variant="primary" onClick={move} loading={saving} disabled={!newDate || !newTime}>{t('ac_confirm_move')}</Button>
              </>}
            </div>
          </div>
        </aside>
      </div>
      <ConfirmDialog
        open={confirmCancel} busy={saving} title={t('ac_cancel_title')} text={`${event.title} — ${t('ac_cancel_text')}`}
        confirmLabel={t('ac_cancel_yes')} cancelLabel={t('ac_keep')} onConfirm={cancel} onCancel={() => setConfirmCancel(false)}
      />
    </>
  )
}
