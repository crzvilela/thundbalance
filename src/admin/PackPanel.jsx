import { useMemo, useState } from 'react'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useToast } from './toastContext'
import { dateKey, parseDateKey } from './requests'
import { WEEKDAYS, firstMismatch, hoursSummary } from './availability'
import { Badge, Button, Drawer, Field, SelectInput, TextInput } from './ui'

const TIMES = Array.from({ length: 14 }, (_, index) => `${String(index + 7).padStart(2, '0')}:00`)
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
          <button type="button" aria-label={t('pk_prev')} onClick={() => setCursor(new Date(year, month - 1, 1))} className="rounded-lg px-3 py-1.5 text-gray-300 transition hover:bg-white/10">‹</button>
          <p className="font-medium capitalize">{cursor.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</p>
          <button type="button" aria-label={t('pk_next')} onClick={() => setCursor(new Date(year, month + 1, 1))} className="rounded-lg px-3 py-1.5 text-gray-300 transition hover:bg-white/10">›</button>
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

function addDays(key, amount) {
  const date = parseDateKey(key)
  date.setDate(date.getDate() + amount)
  return dateKey(date)
}

// Renewal form: pack type, sessions per week, days, time, trainer and start
// date. The server creates the sessions and calendar events.
export function RenewDrawer({ client, pack, plans, trainers, onClose, onDone }) {
  const { t, language, dayFull, dayLabel } = useAdminText()
  const toast = useToast()
  const today = dateKey(new Date())
  const minStart = pack?.end_date && pack.end_date >= today ? addDays(pack.end_date, 1) : today
  const [form, setForm] = useState({
    plan: pack?.plan_id ? String(pack.plan_id) : '',
    perWeek: String(pack?.sessions_per_week || 1),
    days: pack?.preferred_days ? pack.preferred_days.split(',').map(day => day.trim()).filter(Boolean) : [],
    time: pack?.preferred_time ? String(pack.preferred_time).slice(0, 5) : '',
    trainer: pack?.trainer_id ? String(pack.trainer_id) : '',
    start: minStart
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locale = language === 'es' ? 'es-ES' : 'en-GB'

  const set = (patch) => setForm(current => ({ ...current, ...patch }))
  const toggleDay = (day) => set({ days: form.days.includes(day) ? form.days.filter(item => item !== day) : [...form.days, day] })

  const chosenPlan = plans.find(plan => String(plan[0]) === form.plan)
  const estimate = chosenPlan?.[4] && form.perWeek ? chosenPlan[4] * Number(form.perWeek) : null
  const ready = form.days.length > 0 && !!form.time

  const trainerOptions = useMemo(() => trainers.map(trainer => ({
    trainer,
    badDay: ready ? firstMismatch(trainer, form.days, form.time) : null,
    summary: hoursSummary(trainer, form.days.length ? form.days : WEEKDAYS)
  })), [trainers, form.days, form.time, ready])

  const submit = async () => {
    if (!form.plan || !form.trainer || !form.start || !ready) { setError(t('pk_fill')); return }
    setBusy(true)
    setError('')
    try {
      await adminRequest('POST', `/admin/clients/${client.id}/renew-pack`, {
        plan_id: Number(form.plan),
        sessions_per_week: Number(form.perWeek),
        preferred_days: form.days.join(','),
        preferred_time: form.time,
        trainer_id: Number(form.trainer),
        start_date: form.start
      })
      toast.push(t('pk_renewed'))
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
      <div className="grid gap-x-8 md:grid-cols-2">
        <Field label={t('pk_type')}>
          <SelectInput value={form.plan} onChange={event => set({ plan: event.target.value })} disabled={busy}>
            <option value="">{t('cl_assign_ph')}</option>
            {plans.map(plan => <option key={plan[0]} value={plan[0]}>{plan[1]}</option>)}
          </SelectInput>
        </Field>
        <Field label={t('pk_per_week')}>
          <SelectInput value={form.perWeek} onChange={event => set({ perWeek: event.target.value })} disabled={busy}>
            {[1, 2, 3, 4, 5, 6, 7].map(value => <option key={value} value={value}>{value}</option>)}
          </SelectInput>
        </Field>
      </div>

      <Field label={t('pk_days')}>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map(day => {
            const on = form.days.includes(day)
            return (
              <button key={day} type="button" aria-pressed={on} onClick={() => toggleDay(day)} disabled={busy}
                className={`rounded-full border px-4 py-2 text-sm transition ${on ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200' : 'border-white/10 text-gray-400 hover:border-white/25 hover:text-white'}`}>
                {dayLabel(day)}
              </button>
            )
          })}
        </div>
      </Field>

      <div className="grid gap-x-8 md:grid-cols-2">
        <Field label={t('pk_time')}>
          <SelectInput value={form.time} onChange={event => set({ time: event.target.value })} disabled={busy}>
            <option value="">—</option>
            {TIMES.map(time => <option key={time} value={time}>{time}</option>)}
          </SelectInput>
        </Field>
        <Field label={t('pk_start')} hint={pack?.end_date && pack.end_date >= today ? `${t('pk_start_hint')} ${parseDateKey(pack.end_date).toLocaleDateString(locale)}` : undefined}>
          <TextInput type="date" min={minStart} value={form.start} onChange={event => set({ start: event.target.value })} disabled={busy} />
        </Field>
      </div>

      <Field label={t('pk_trainer_f')} hint={ready ? undefined : t('pk_pick_days')}>
        <SelectInput value={form.trainer} onChange={event => set({ trainer: event.target.value })} disabled={busy}>
          <option value="">{t('select_trainer')}</option>
          {trainerOptions.map(({ trainer, badDay, summary }) => (
            <option key={trainer.id} value={trainer.id} disabled={!!badDay}>
              {trainer.name}{badDay ? ` — ${t('av_unavailable')} ${dayFull(badDay)} ${form.time}` : summary ? ` — ${summary}` : ''}
            </option>
          ))}
        </SelectInput>
      </Field>

      {estimate && (
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">
          {t('will_create')} <strong className="text-base">{estimate}</strong> {t('sessions_label')}
        </div>
      )}
      {busy && <p className="mt-4 text-sm text-amber-300">{t('approving_hint')}</p>}
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
    </Drawer>
  )
}
