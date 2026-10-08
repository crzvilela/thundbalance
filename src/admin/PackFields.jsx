import { useMemo } from 'react'
import { useAdminText } from './useAdminText'
import { dateKey, parseDateKey } from './requests'
import { WEEKDAYS, firstMismatch, hoursSummary } from './availability'
import { Field, SelectInput, TextInput } from './ui'
import { PACK_TIMES as TIMES, packHasDaysAndTime, packMinStart } from './packForm'

// The pack form: type, sessions per week, days, time, start date and trainer,
// with the number of sessions it will create. Used by "Renovar pack" and by
// "Añadir cliente" (state comes from usePackForm).
export default function PackFields({ form, set, plans, trainers, pack = null, busy = false }) {
  const { t, language, dayFull, dayLabel } = useAdminText()
  const today = dateKey(new Date())
  const minStart = packMinStart(pack)
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const ready = packHasDaysAndTime(form)

  const toggleDay = (day) => set({ days: form.days.includes(day) ? form.days.filter(item => item !== day) : [...form.days, day] })
  const chosenPlan = plans.find(plan => String(plan[0]) === form.plan)
  const estimate = chosenPlan?.[4] && form.perWeek ? chosenPlan[4] * Number(form.perWeek) : null

  const trainerOptions = useMemo(() => trainers.map(trainer => ({
    trainer,
    badDay: ready ? firstMismatch(trainer, form.days, form.time) : null,
    summary: hoursSummary(trainer, form.days.length ? form.days : WEEKDAYS)
  })), [trainers, form.days, form.time, ready])

  return (
    <>
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
    </>
  )
}
