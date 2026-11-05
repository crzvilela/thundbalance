import { useMemo } from 'react'
import { useAdminText } from './useAdminText'
import { dateKey, parseDateKey } from './requests'
import { Field, SelectInput, TextInput } from './ui'
import { Icon } from './ui'
import { packMinStart } from './packForm'
import PackSchedulePicker from '../components/forms/PackSchedulePicker'
import PackScheduleSummary from '../components/forms/PackScheduleSummary'
import { usePackAvailability } from '../utils/usePackAvailability'
import { PriceBox, SessionTypeFields } from './SessionKind'
import { OverlapList } from './OverlapWarning'
import { formatMoney, packQuote, packsOfType } from '../utils/pricing'

// The pack form: type, sessions per week, days, time, start date and trainer,
// with the number of sessions it will create. Used by "Nuevo pack" and by
// "Añadir cliente" (state comes from usePackForm).
export default function PackFields({ form, set, packs, pack = null, busy = false, preview = null, serverConflicts = null, serverOverlaps = null }) {
  const { t, language, dayLabel } = useAdminText()
  const today = dateKey(new Date())
  const suggestion = packMinStart(pack)
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  // Only the packs ON SALE of the chosen type (archived ones are not offered); the sessions per week are the ones the pack offers
  const typePacks = useMemo(() => packsOfType({ packs }, form.type), [packs, form.type])
  const chosenPack = typePacks.find(pack => String(pack.id) === form.plan)
  const perWeekOptions = chosenPack ? chosenPack.sessions_per_week_options : [1, 2, 3, 4, 5, 6, 7]
  const quote = packQuote(chosenPack, form.perWeek)
  const estimate = quote.sessions || null
  // The price: the server's own figure when the preview has arrived, otherwise the catalogue's (the server works it out again on save)
  const perSession = preview?.data ? preview.data.price_per_session : quote.perSession
  const total = preview?.data ? preview.data.total_price : quote.total
  const setEntries = (entries) => set({ entries })
  // the free hours of every day for THIS pack: from the start date, for as many weeks as the pack lasts
  const availability = usePackAvailability({ startDate: form.start, weeks: chosenPack?.weeks || 0 })
  const choosePack = (id) => {
    const pack = typePacks.find(item => String(item.id) === id)
    const keep = pack && pack.sessions_per_week_options.includes(Number(form.perWeek))
    set({ plan: id, ...(pack && !keep ? { perWeek: String(pack.sessions_per_week_options[0]) } : {}) })
  }

  return (
    <>
      <SessionTypeFields
        value={{ type: form.type, name: form.secondName, email: form.secondEmail }} disabled={busy}
        onChange={patch => set({
          ...(patch.type !== undefined ? { type: patch.type, plan: '' } : {}),          // each type has its own packs
          ...(patch.name !== undefined ? { secondName: patch.name } : {}),
          ...(patch.email !== undefined ? { secondEmail: patch.email } : {})
        })}
      />
      <div className="grid gap-x-8 md:grid-cols-2">
        <Field label={t('pk_type')}>
          <SelectInput value={chosenPack ? form.plan : ''} onChange={event => choosePack(event.target.value)} disabled={busy}>
            <option value="">{t('pk_plan_ph')}</option>
            {typePacks.map(pack => <option key={pack.id} value={pack.id}>{pack.name}</option>)}
          </SelectInput>
        </Field>
        <Field label={t('pk_per_week')}>
          <SelectInput value={form.perWeek} onChange={event => set({ perWeek: event.target.value })} disabled={busy || perWeekOptions.length === 1}>
            {perWeekOptions.map(value => <option key={value} value={value}>{value}</option>)}
          </SelectInput>
        </Field>
      </div>

      <div className="mb-5">
        <PackSchedulePicker
          value={form.entries} onChange={setEntries} perWeek={Number(form.perWeek)} availability={availability}
          text={t} dayLabel={dayLabel} variant="admin" trainerRequired disabled={busy} legacy={form.legacy}
        />
      </div>

      <Field
        label={t('pk_start')}
        hint={pack?.end_date && pack.end_date >= today
          ? `${t('pk_start_hint')} ${parseDateKey(pack.end_date).toLocaleDateString(locale)} (${parseDateKey(suggestion).toLocaleDateString(locale)})`
          : undefined}
      >
        {/* any day is allowed: today, inside the current pack, or in the past */}
        <TextInput type="date" value={form.start} onChange={event => set({ start: event.target.value })} disabled={busy} />
      </Field>

      <PackScheduleSummary
        className="mb-5 rounded-xl border border-white/10 p-4" value={form.entries} availability={availability.data}
        start={form.start} total={quote.sessions} text={t} dayLabel={dayLabel} locale={locale}
      />

      {chosenPack && (
        <div className="mb-4">
          <PriceBox
            title={t('ty_summary')}
            rows={[
              { label: t('ty_type_row'), value: form.type === 'dual' ? t('ty_dual') : t('ty_individual') },
              { label: t('ty_price_session'), value: formatMoney(perSession) },
              { label: t('ty_price_total'), value: formatMoney(total), strong: true }
            ]}
          />
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
      <OverlapList overlaps={serverOverlaps || preview?.data?.overlaps || []} />
    </>
  )
}
