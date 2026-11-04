import { useMemo, useState } from 'react'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useToast } from './toastContext'
import { dateKey, parseDateKey } from './requests'
import { WEEKDAYS } from './availability'
import { Badge, Button, ConfirmDialog, Drawer } from './ui'
import PackFields from './PackFields'
import { TypeBadge } from './SessionKind'
import { formatMoney } from '../utils/pricing'
import { packIsComplete, packPayload, startIsInThePast, usePackForm, usePackPreview } from './packForm'
import RecipientsBox, { SendsTo } from './RecipientsBox'
import { extraBody } from './recipients'
import { reportEmailResult } from './recipientsState'
import { reportCalendarResult } from './calendarSync'
import { OverlapAsk } from './OverlapWarning'

const STATUS_TONE = { active: 'emerald', expiring: 'amber', expired: 'red', none: 'neutral' }

export function PackStatusBadge({ status }) {
  const { t } = useAdminText()
  if (!status || status === 'none') return null
  return <Badge tone={STATUS_TONE[status]}>{t(`pk_status_${status}`)}</Badge>
}

// The client's packs: every ACTIVE pack (period, schedule, trainer and done / left). A client can have several at once:
// a new pack never touches the others, each one runs and counts on its own.
export function PackSummary({ packs = [], onNewPack }) {
  const { t, language, dayLabel } = useAdminText()
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const fmt = (key) => (key ? parseDateKey(key).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
  const urgent = packs.length > 0 && packs.every(pack => pack.status === 'expired' || pack.status === 'expiring')

  return (
    <section>
      <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">
        {t('pk_title')}{packs.length > 1 ? ` (${packs.length})` : ''}
      </h3>
      <div className="space-y-3">
        {packs.length === 0 && (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
            <p className="text-gray-400">{t('pk_none')}</p>
          </div>
        )}
        {packs.map(pack => (
          <div key={pack.id} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-lg font-semibold">{pack.name}</p>
              <div className="flex items-center gap-2">
                <TypeBadge type={pack.session_type} secondName={pack.second_person_name} />
                {!pack.active && <Badge tone="neutral">{t('pk_previous')}</Badge>}
                <PackStatusBadge status={pack.status} />
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-base">
              <div><dt className="text-sm text-gray-500">{t('pk_period')}</dt><dd>{fmt(pack.start_date)} → {fmt(pack.end_date)}</dd></div>
              <div><dt className="text-sm text-gray-500">{t('pk_sessions')}</dt><dd>{pack.done} {t('pk_done')} · {pack.remaining} {t('pk_left')}</dd></div>
              <div><dt className="text-sm text-gray-500">{t('pk_per_week')}</dt><dd>{pack.sessions_per_week || '—'}</dd></div>
              <div><dt className="text-sm text-gray-500">{t('pk_trainer')}</dt><dd>{pack.trainer || '—'}</dd></div>
              {pack.session_type === 'dual' && (
                <div className="col-span-2"><dt className="text-sm text-gray-500">{t('ty_second_person')}</dt><dd>{pack.second_person_name} · {pack.second_person_email}</dd></div>
              )}
              {pack.price_per_session != null && (
                <>
                  <div><dt className="text-sm text-gray-500">{t('ty_price_session')}</dt><dd>{formatMoney(pack.price_per_session)}</dd></div>
                  <div><dt className="text-sm text-gray-500">{t('ty_price_total')}</dt><dd>{formatMoney(pack.total_price)}</dd></div>
                </>
              )}
              <div className="col-span-2">
                <dt className="text-sm text-gray-500">{t('pk_schedule')}</dt>
                <dd>{pack.preferred_days ? `${pack.preferred_days.split(',').map(day => dayLabel(day.trim())).join(', ')} · ${String(pack.preferred_time || '').slice(0, 5)}` : '—'}</dd>
              </div>
            </dl>
          </div>
        ))}
        <Button variant={urgent || packs.length === 0 ? 'primary' : 'secondary'} onClick={onNewPack}>
          {packs.length ? t('pk_add_pack') : t('pk_start_pack')}
        </Button>
      </div>
    </section>
  )
}

// Month grid (Monday first) marking the client's training days.
export function TrainingCalendar({ sessions }) {
  const { t, language, dayLabel } = useAdminText()
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const today = dateKey(new Date())
  const [cursor, setCursor] = useState(() => {
    const next = sessions.find(session => session.status !== 'Cancelled' && session.date >= today)
    const base = next ? parseDateKey(next.date) : new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  const byDay = useMemo(() => {
    const map = new Map()
    for (const session of sessions) {
      if (!map.has(session.date)) map.set(session.date, [])
      map.get(session.date).push(session)
    }
    return map
  }, [sessions])

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const offset = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)]

  const toneFor = (list) => {
    if (list.every(session => session.status === 'Cancelled')) return 'border border-red-400/40 text-red-300 line-through'
    return list[0].date < today ? 'bg-white/15 text-gray-200' : 'bg-emerald-400 font-semibold text-black'
  }

  return (
    <section>
      <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">{t('pk_calendar')}</h3>
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
        <div className="mb-3 flex items-center justify-between">
          <button type="button" aria-label={t('pk_prev')} onClick={() => setCursor(new Date(year, month - 1, 1))} className="min-h-[44px] min-w-[44px] rounded-lg px-3 py-1.5 text-gray-300 transition hover:bg-white/10">‹</button>
          <p className="font-medium capitalize">{cursor.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</p>
          <button type="button" aria-label={t('pk_next')} onClick={() => setCursor(new Date(year, month + 1, 1))} className="min-h-[44px] min-w-[44px] rounded-lg px-3 py-1.5 text-gray-300 transition hover:bg-white/10">›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500">
          {WEEKDAYS.map(day => <span key={day} className="py-1">{dayLabel(day)}</span>)}
          {cells.map((day, index) => {
            if (!day) return <span key={`blank-${index}`} />
            const key = dateKey(new Date(year, month, day))
            const list = byDay.get(key)
            const title = list ? list.map(session => `${session.time} · ${session.trainer || '—'}`).join('\n') : undefined
            return (
              <span key={key} title={title} className={`flex h-9 items-center justify-center rounded-lg text-sm ${list ? toneFor(list) : key === today ? 'border border-white/30 text-white' : 'text-gray-400'}`}>
                {day}
              </span>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded bg-emerald-400" />{t('pk_legend_upcoming')}</span>
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded bg-white/30" />{t('pk_legend_done')}</span>
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded border border-red-400/60" />{t('pk_legend_cancelled')}</span>
        </div>
      </div>
    </section>
  )
}

export function NewPackDrawer({ client, pack, packs, trainers, onClose, onDone }) {
  const { t } = useAdminText()
  const toast = useToast()
  const [form, set] = usePackForm(pack)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [extra, setExtra] = useState([])                           // more recipients of the pack email (BCC); the client always gets it
  const [askPast, setAskPast] = useState(false)
  const [askConflicts, setAskConflicts] = useState(false)
  const [serverConflicts, setServerConflicts] = useState(null)
  const [askOverlaps, setAskOverlaps] = useState(false)             // the client gets two sessions at the same time: a warning first
  const [serverOverlaps, setServerOverlaps] = useState(null)
  const [trainerOk, setTrainerOk] = useState(false)                   // the admin already accepted the trainer's collisions
  const preview = usePackPreview(client.id, form)
  const conflicts = serverConflicts || preview.data?.conflicts || []
  // Sessions of the client at the same time as a session of another of their packs (the preview tells before anything is sent).
  const overlaps = serverOverlaps || preview.data?.overlaps || []

  // Changing the form invalidates any list the server sent before.
  const update = (patch) => { setServerConflicts(null); setServerOverlaps(null); setAskConflicts(false); setAskOverlaps(false); setTrainerOk(false); set(patch) }

  const send = async (allowConflicts, allowOverlaps = false) => {
    setBusy(true)
    setError('')
    try {
      const result = await adminRequest('POST', `/admin/clients/${client.id}/renew-pack`, {
        ...extraBody(extra),
        ...packPayload(form),
        allow_conflicts: allowConflicts,
        allow_overlaps: allowOverlaps
      })
      toast.push(t('pk_created'))
      reportEmailResult(toast, t, result.email)
      reportCalendarResult(toast, t, result.calendar)
      onDone()
    } catch (err) {
      if (err.code === 'conflicts') {            // the server found collisions the preview had not shown yet
        setServerConflicts(err.conflicts)
        setAskConflicts(true)
      } else if (err.code === 'client_overlap') { // two sessions of the client at the same time: warn, then continue if the admin says so
        setServerOverlaps(err.detail?.overlaps || [])
        setAskOverlaps(true)
      } else {
        setError(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  // 1) a date in the past asks first, 2) the trainer's collisions are listed first, 3) the client's own sessions at the
  // same time as another pack are a warning ("Continuar igualmente"), 4) then it is created.
  const submit = (confirmedPast = false) => {
    if (!packIsComplete(form)) { setError(t('pk_fill')); return }
    if (startIsInThePast(form) && !confirmedPast) { setAskPast(true); return }
    if (conflicts.length > 0 && !trainerOk) { setAskConflicts(true); return }
    if (overlaps.length > 0) { setAskOverlaps(true); return }
    send(trainerOk, false)
  }

  return (
    <Drawer
      open onClose={onClose} busy={busy}
      title={t('pk_new_title')} subtitle={client.name}
      footer={<>
        <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button variant="primary" className="flex-[2]" onClick={() => submit()} loading={busy}>{busy ? t('pk_creating') : t('pk_confirm')}</Button>
      </>}
    >
      <p className="mb-6 text-sm text-gray-400">{t('pk_new_sub')}</p>
      <PackFields form={form} set={update} packs={packs} trainers={trainers} pack={pack} busy={busy} preview={preview} serverConflicts={serverConflicts} serverOverlaps={serverOverlaps} />
      <RecipientsBox clientEmail={client.email} value={extra} onChange={setExtra} disabled={busy} />
      <SendsTo clientEmail={client.email} extra={extra} />
      {askConflicts && conflicts.length > 0 && (
        <div role="alert" className="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-100">
          <p className="mb-3 text-sm">{t('cf_question')}</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setAskConflicts(false)} disabled={busy}>{t('cf_change')}</Button>
            <Button variant="primary" onClick={() => { setAskConflicts(false); setTrainerOk(true); if (overlaps.length > 0) setAskOverlaps(true); else send(true, false) }} loading={busy}>{t('cf_create_anyway')}</Button>
          </div>
        </div>
      )}
      {askOverlaps && !askConflicts && (
        <OverlapAsk overlaps={overlaps} busy={busy} onChange={() => setAskOverlaps(false)} onContinue={() => { setAskOverlaps(false); send(trainerOk, true) }} />
      )}
      {busy && <p className="mt-4 text-sm text-amber-300">{t('approving_hint')}</p>}
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
      <ConfirmDialog
        open={askPast} tone="neutral" icon="calendar"
        title={t('pk_past_title')} text={t('pk_past_text')}
        confirmLabel={t('pk_past_ok')} cancelLabel={t('cancel')}
        onConfirm={() => { setAskPast(false); submit(true) }} onCancel={() => setAskPast(false)}
      />
    </Drawer>
  )
}
