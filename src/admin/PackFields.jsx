import { useMemo } from 'react'
import { useAdminText } from './useAdminText'
import { dateKey, parseDateKey } from './requests'
import { WEEKDAYS, firstMismatch, hoursSummary } from './availability'
import { Field, SelectInput, TextInput } from './ui'
import { Icon } from './ui'
import { PACK_TIMES as TIMES, packHasDaysAndTime, packMinStart } from './packForm'
import { PriceBox, SessionTypeFields } from './SessionKind'
import { formatMoney, packPricePerSession, totalPrice } from '../utils/pricing'
import { usePricing } from '../utils/usePricing'

// The pack form: type, sessions per week, days, time, start date and trainer,
// with the number of sessions it will create. Used by "Nuevo pack" and by
// "Añadir cliente" (state comes from usePackForm).
export default function PackFields({ form, set, plans, trainers, pack = null, busy = false, preview = null, serverConflicts = null }) {
  const { t, language, dayFull, dayLabel } = useAdminText()
  const { prices } = usePricing()
  const today = dateKey(new Date())
  const suggestion = packMinStart(pack)
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const ready = packHasDaysAndTime(form)

  const toggleDay = (day) => set({ days: form.days.includes(day) ? form.days.filter(item => item !== day) : [...form.days, day] })
  const chosenPlan = plans.find(plan => String(plan[0]) === form.plan)
  const estimate = chosenPlan?.[4] && form.perWeek ? chosenPlan[4] * Number(form.perWeek) : null
  // The price: the server's own figure when the preview has arrived, otherwise the table's (the server works it out again on save)
  const sessionsCount = preview?.data?.total_sessions ?? estimate
  const perSession = preview?.data ? preview.data.price_per_session : packPricePerSession(prices, form.type, chosenPlan?.[2])
  const total = preview?.data ? preview.data.total_price : totalPrice(perSession, sessionsCount)
  const priceMissing = !!chosenPlan && !!prices && perSession == null

  const trainerOptions = useMemo(() => trainers.map(trainer => ({
    trainer,
    badDay: ready ? firstMismatch(trainer, form.days, form.time) : null,
    summary: hoursSummary(trainer, form.days.length ? form.days : WEEKDAYS)
  })), [trainers, form.days, form.time, ready])

  return (
    <>
      <SessionTypeFields
        value={{ type: form.type, name: form.secondName, email: form.secondEmail }} disabled={busy}
        onChange={patch => set({
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.name !== undefined ? { secondName: patch.name } : {}),
          ...(patch.email !== undefined ? { secondEmail: patch.email } : {})
        })}
      />
      <div className="grid gap-x-8 md:grid-cols-2">
        <Field label={t('pk_type')}>
          <SelectInput value={form.plan} onChange={event => set({ plan: event.target.value })} disabled={busy}>
            <option value="">{t('pk_plan_ph')}</option>
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
        <Field
          label={t('pk_start')}
          hint={pack?.end_date && pack.end_date >= today
            ? `${t('pk_start_hint')} ${parseDateKey(pack.end_date).toLocaleDateString(locale)} (${parseDateKey(suggestion).toLocaleDateString(locale)})`
            : undefined}
        >
          {/* any day is allowed: today, inside the current pack, or in the past */}
          <TextInput type="date" value={form.start} onChange={event => set({ start: event.target.value })} disabled={busy} />
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

      {chosenPlan && (
        <div className="mb-4">
          <PriceBox
            title={t('ty_summary')}
            warning={priceMissing ? t('ty_no_price') : undefined}
            rows={[
              { label: t('ty_type_row'), value: form.type === 'dual' ? t('ty_dual') : t('ty_individual') },
              { label: t('ty_price_session'), value: formatMoney(perSession) },
              { label: t('ty_price_total'), value: formatMoney(total), strong: true }
            ]}
          />
        </div>
      )}

      {preview?.data?.replaces?.count > 0 && (
        <div role="status" className="mb-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-100">
          {t('pk_replace_note')} <strong className="text-base">{preview.data.replaces.count}</strong> ({preview.data.replaces.first_date} → {preview.data.replaces.last_date})
        </div>
      )}

      {(() => {
        const total = preview?.data?.total_sessions ?? estimate
        const conflicts = serverConflicts || preview?.data?.conflicts || []
        if (!total && !conflicts.length) return null
        const shown = conflicts.slice(0, 12)
        return (
          <div className="space-y-3">
            {total ? (
              <div className={`rounded-xl border px-4 py-3 text-sm ${conflicts.length ? 'border-amber-400/30 bg-amber-400/10 text-amber-100' : 'border-emerald-400/20 bg-emerald-400/5 text-emerald-200'}`}>
                {t('will_create')} <strong className="text-base">{total}</strong> {t('sessions_label')}
                {conflicts.length > 0 && <> · <strong className="text-base">{conflicts.length}</strong> {t('cf_collide')}</>}
                {preview?.loading && <span className="ml-2 text-xs opacity-70">…</span>}
              </div>
            ) : null}
            {conflicts.length > 0 && (
              <ul className="space-y-1.5 rounded-xl border border-amber-400/25 bg-amber-400/5 p-4 text-sm text-amber-100" aria-label={t('cf_title')}>
                {shown.map(conflict => (
                  <li key={`${conflict.date}-${conflict.kind}`} className="flex items-start gap-2">
                    <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                    <span>
                      <strong>{parseDateKey(conflict.date).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · {conflict.time}</strong>
                      {' — '}{t(`cf_${conflict.kind}`)}
                    </span>
                  </li>
                ))}
                {conflicts.length > shown.length && <li className="pl-6 text-amber-200/80">+{conflicts.length - shown.length} …</li>}
              </ul>
            )}
          </div>
        )
      })()}
    </>
  )
}
