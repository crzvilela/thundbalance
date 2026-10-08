import { useMemo, useState } from 'react'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useToast } from './toastContext'
import { dateKey, parseDateKey } from './requests'
import { WEEKDAYS } from './availability'
import { Badge, Button, Drawer } from './ui'
import PackFields from './PackFields'
import { packIsComplete, packPayload, usePackForm } from './packForm'
import EmailRecipients from './EmailRecipients'
import { recipientsPayload, reportEmailResult, useEmailRecipients } from './recipientsState'

const STATUS_TONE = { active: 'emerald', expiring: 'amber', expired: 'red', none: 'neutral' }

export function PackStatusBadge({ status }) {
  const { t } = useAdminText()
  if (!status || status === 'none') return null
  return <Badge tone={STATUS_TONE[status]}>{t(`pk_status_${status}`)}</Badge>
}

// Current pack of a client: type, period, progress and schedule, with the
// Renew button (highlighted once the pack is expiring or expired).
export function PackSummary({ pack, onRenew }) {
  const { t, language, dayLabel } = useAdminText()
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const fmt = (key) => (key ? parseDateKey(key).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
  const urgent = pack && (pack.status === 'expired' || pack.status === 'expiring')

  return (
    <section>
      <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">{t('pk_title')}</h3>
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        {pack ? (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-lg font-semibold">{pack.name}</p>
              <PackStatusBadge status={pack.status} />
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-base">
              <div><dt className="text-sm text-gray-500">{t('pk_period')}</dt><dd>{fmt(pack.start_date)} → {fmt(pack.end_date)}</dd></div>
              <div><dt className="text-sm text-gray-500">{t('pk_sessions')}</dt><dd>{pack.done} {t('pk_done')} · {pack.remaining} {t('pk_left')}</dd></div>
              <div><dt className="text-sm text-gray-500">{t('pk_trainer')}</dt><dd>{pack.trainer || '—'}</dd></div>
              <div>
                <dt className="text-sm text-gray-500">{t('pk_schedule')}</dt>
                <dd>{pack.preferred_days ? `${pack.preferred_days.split(',').map(day => dayLabel(day.trim())).join(', ')} · ${pack.preferred_time || ''}` : '—'}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="mb-1 text-gray-400">{t('pk_none')}</p>
        )}
        <Button variant={urgent || !pack ? 'primary' : 'secondary'} className="mt-4" onClick={onRenew}>
          {pack ? t('pk_renew') : t('pk_start_pack')}
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

export function RenewDrawer({ client, pack, plans, trainers, onClose, onDone }) {
  const { t } = useAdminText()
  const toast = useToast()
  const [form, set] = usePackForm(pack)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recipients, setRecipients] = useEmailRecipients()

  const submit = async () => {
    if (!packIsComplete(form)) { setError(t('pk_fill')); return }
    setBusy(true)
    setError('')
    try {
      const result = await adminRequest('POST', `/admin/clients/${client.id}/renew-pack`, {
        ...recipientsPayload(recipients),
        ...packPayload(form)
      })
      toast.push(t('pk_renewed'))
      reportEmailResult(toast, t, result.email)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open onClose={onClose} busy={busy}
      title={pack ? t('pk_renew_title') : t('pk_start_title')} subtitle={client.name}
      footer={<>
        <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button variant="primary" className="flex-[2]" onClick={submit} loading={busy}>{busy ? t('pk_renewing') : t('pk_confirm')}</Button>
      </>}
    >
      <p className="mb-6 text-sm text-gray-400">{t('pk_renew_sub')}</p>
      <PackFields form={form} set={set} plans={plans} trainers={trainers} pack={pack} busy={busy} />
      <EmailRecipients value={recipients} onChange={setRecipients} disabled={busy} />
      {busy && <p className="mt-4 text-sm text-amber-300">{t('approving_hint')}</p>}
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
    </Drawer>
  )
}
