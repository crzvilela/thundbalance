import { ErrorBox, Skeleton } from './PanelParts'
import { formatDay, CARD, HEADING_FONT } from './trainerStyle'
import { errorKey } from './trainerSource'
import { hourBars, weekdayBars } from './trainerData'

// Columns drawn with plain HTML and Tailwind (no chart library). Each column says its number in text too.
function BarChart({ title, bars, label, valueText, color, emptyText }) {
  const max = Math.max(1, ...bars.map(bar => bar.value))
  const total = bars.reduce((sum, bar) => sum + bar.value, 0)
  return (
    <section className={`${CARD} min-w-0 p-5`}>
      <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">{title}</h3>
      {total === 0 ? (
        <p className="py-10 text-center text-sm text-gray-500">{emptyText}</p>
      ) : (
        <ul className="flex h-44 items-end gap-1 sm:gap-1.5" aria-label={title}>
          {bars.map(bar => (
            <li key={bar.key} className="flex h-full min-w-0 flex-1 flex-col justify-end text-center">
              <span className="mb-1 text-[11px] tabular-nums text-gray-300">{bar.value || ''}</span>
              <span className="sr-only">{label(bar)}: {valueText(bar.value)}</span>
              <span aria-hidden="true" className="block w-full rounded-t-md transition-[height]"
                style={{ height: `${Math.round((bar.value / max) * 100)}%`, minHeight: bar.value ? 4 : 2, background: bar.value ? color : 'rgba(255,255,255,0.08)' }} />
              <span aria-hidden="true" className="mt-1 truncate text-[10px] text-gray-500 sm:text-xs">{label(bar)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const CARDS = [
  ['tr_i_booked', 'sessions_booked'], ['tr_i_completed', 'sessions_completed'], ['tr_i_cancelled', 'sessions_cancelled'],
  ['tr_i_rescheduled', 'sessions_rescheduled'], ['tr_i_upcoming', 'upcoming_7_days'], ['tr_i_hours', 'hours_given'],
  ['tr_i_clients', 'distinct_clients'], ['tr_i_trials', 'trial_sessions'], ['tr_i_free', 'free_hours']
]
const HOURS_FIELDS = new Set(['hours_given', 'free_hours'])

// Numbers of the chosen period. No comparison with another period and no money.
export default function InsightsTab({ state, text, color }) {
  const { t, locale } = text
  if (state.loading) {
    return (
      <div role="status" aria-label={t('tr_loading')} className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{CARDS.map(([key]) => <Skeleton key={key} className="h-24" />)}</div>
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-60" /><Skeleton className="h-60" /></div>
      </div>
    )
  }
  if (state.error) return <ErrorBox message={t(errorKey(state.error))} onRetry={state.reload} retryLabel={t('tr_retry')} />
  const data = state.data
  if (!data) return null

  const number = (value) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
  const weekday = (key) => formatDay(`2026-10-${19 + ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(key)}`, locale, { weekday: 'short' })
  const valueText = (n) => (n === 1 ? t('tr_chart_value_one') : t('tr_chart_value', { n }))

  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {CARDS.map(([label, field]) => (
          <li key={field} className={`${CARD} min-w-0 p-4`}>
            <p className="text-xs uppercase tracking-wider text-gray-400">{t(label)}</p>
            <p className="mt-2 text-4xl tabular-nums text-white" style={HEADING_FONT}>
              {HOURS_FIELDS.has(field) ? t('tr_i_hours_unit', { n: number(data[field]) }) : number(data[field])}
            </p>
          </li>
        ))}
      </ul>
      <div className="grid gap-4 lg:grid-cols-2">
        <BarChart title={t('tr_chart_weekdays')} bars={weekdayBars(data.busiest_weekdays)} label={bar => weekday(bar.key)} valueText={valueText} color={color} emptyText={t('tr_chart_none')} />
        <BarChart title={t('tr_chart_hours')} bars={hourBars(data.busiest_hours)} label={bar => `${bar.key}`} valueText={valueText} color={color} emptyText={t('tr_chart_none')} />
      </div>
    </div>
  )
}
