import { useI18n } from '../../i18n/I18nContext'
import EmailInput from './EmailInput'
import FormField from './FormField'
import SegmentedType from './SegmentedType'

const control = 'w-full rounded-xl border bg-black/40 px-4 py-3.5 text-white outline-none transition focus:ring-2 focus:ring-emerald-400/20'

// Individual | Dual selector of the public forms (trial session and pack request). With Dual, the name and email of
// the second person appear and are required. `errors` already hold the text to show: { name, email }.
//   value: { type, name, email }      onChange(patch)
export default function SessionTypeSection({ value, onChange, errors = {}, disabled = false }) {
  const { t, language } = useI18n()
  const labels = { legend: t('st_type'), individual: t('st_individual'), dual: t('st_dual') }
  return (
    <div className="space-y-5">
      <SegmentedType value={value.type} onChange={type => onChange({ type })} labels={labels} disabled={disabled} />
      {value.type === 'dual' && (
        <>
          <p className="text-sm text-gray-400">{t('st_dual_hint')}</p>
          <div className="grid gap-6 md:grid-cols-2">
            <FormField label={t('st_second_name')} required error={errors.name}>
              {({ id, describedBy, invalid }) => (
                <input
                  id={id} type="text" autoComplete="off" maxLength={100} value={value.name} disabled={disabled}
                  onChange={event => onChange({ name: event.target.value })}
                  aria-describedby={describedBy} aria-invalid={invalid || undefined} aria-required="true"
                  className={`${control} ${errors.name ? 'border-red-400/60' : 'border-white/15 focus:border-emerald-400/70'}`}
                />
              )}
            </FormField>
            <EmailInput
              label={t('st_second_email')} required language={language} value={value.email} error={errors.email}
              name="second_person_email" autoComplete="off" disabled={disabled}
              onChange={email => onChange({ email })}
            />
          </div>
          <p className="text-xs text-gray-500">{t('st_second_note')}</p>
        </>
      )}
    </div>
  )
}

// The summary shown before confirming: a title and rows of { label, value, strong }.
export function PriceSummary({ title, rows, note }) {
  return (
    <div role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-400/5 px-5 py-4 text-sm text-emerald-50">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">{title}</p>
      <dl className="space-y-1.5">
        {rows.map(row => (
          <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-4">
            <dt className="text-gray-300">{row.label}</dt>
            <dd className={row.strong ? 'text-lg font-semibold text-white' : 'text-white'}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="mt-2 text-xs text-gray-400">{note}</p>}
    </div>
  )
}
