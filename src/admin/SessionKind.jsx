import SegmentedType from '../components/forms/SegmentedType'
import { secondPersonProblems } from '../utils/usePricing'
import { useAdminText } from './useAdminText'
import { Badge, Field, TextInput } from './ui'

// "Dual · Ana" in a list or a card; nothing for an individual session.
export function TypeBadge({ type, secondName = '' }) {
  const { t } = useAdminText()
  if (type !== 'dual') return null
  return <Badge tone="sky">{secondName ? t('ty_dual_with').replace('{name}', secondName) : t('ty_dual')}</Badge>
}

// Individual | Dual and, for Dual, the name and email of the second person (both required).
//   value: { type, name, email }      onChange(patch)      `fixed`: shows the type but it can not be changed
export function SessionTypeFields({ value, onChange, disabled = false }) {
  const { t } = useAdminText()
  const problems = secondPersonProblems({ type: value.type, name: value.name, email: value.email })
  return (
    <div className="mb-5">
      <SegmentedType
        value={value.type} onChange={type => onChange({ type })} disabled={disabled}
        labels={{ legend: t('ty_type'), individual: t('ty_individual'), dual: t('ty_dual') }}
      />
      {value.type === 'dual' && (
        <div className="mt-4">
          <div className="grid gap-x-8 md:grid-cols-2">
            <Field label={t('ty_second_name')} error={value.name && problems.name ? t('ty_err_name') : undefined}>
              <TextInput value={value.name} onChange={event => onChange({ name: event.target.value })} maxLength={100} autoComplete="off" disabled={disabled} />
            </Field>
            <Field label={t('ty_second_email')} error={value.email && problems.email ? t('ty_err_email') : undefined}>
              <TextInput type="email" value={value.email} onChange={event => onChange({ email: event.target.value })} autoComplete="off" disabled={disabled} />
            </Field>
          </div>
          <p className="text-xs text-gray-500">{t('ty_second_note')}</p>
        </div>
      )}
    </div>
  )
}

// Price per session and total, ready for the confirmation step. `rows` of { label, value }.
export function PriceBox({ title, rows, warning }) {
  return (
    <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${warning ? 'border-red-400/25 bg-red-400/10 text-red-200' : 'border-emerald-400/20 bg-emerald-400/5 text-emerald-100'}`}>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider opacity-80">{title}</p>
      {warning
        ? <p>{warning}</p>
        : (
          <dl className="space-y-1">
            {rows.map(row => (
              <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-4">
                <dt className="opacity-80">{row.label}</dt>
                <dd className={row.strong ? 'text-lg font-semibold text-white' : ''}>{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
    </div>
  )
}
