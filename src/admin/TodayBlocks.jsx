import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAdminText } from './useAdminText'
import Editable from './Editable'
import { Badge, Card, EmptyState, ErrorState, Icon, Skeleton } from './ui'
import { MAX_VISIBLE_SESSIONS, allClear, alertsOf, calendarDayLink, sessionBadge, stripCards } from './overviewToday'

// The three "Hoy" blocks of the Overview (what to do today, today's sessions, the warnings). They all read ONE resource (/admin/overview/today),
// loaded by the Overview: while it loads they show a skeleton, and when it fails each one says so with a "Reintentar" without touching the rest.
const fill = (text, n) => String(text).replace('{n}', n)
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'

function Failed({ today, t }) {
  return <ErrorState message={t('ov_load_error')} retryLabel={t('retry')} onRetry={today.reload} />
}

// ---------------------------------------------------------------------------------------------- "Qué hacer hoy"
const CARD_TONE = {
  amber: { on: 'border-amber-400/40 bg-amber-400/10 hover:border-amber-300/70', number: 'text-amber-200', label: 'text-amber-100/90' },
  emerald: { on: 'border-emerald-400/35 bg-emerald-400/10 hover:border-emerald-300/70', number: 'text-emerald-200', label: 'text-emerald-100/90' }
}
const COLUMNS = { 4: 'sm:grid-cols-4', 5: 'sm:grid-cols-5' }

export function TodayStrip({ today }) {
  const { t } = useAdminText()
  const loading = today.loading && !today.data
  const cards = stripCards(today.data)
  const clear = allClear(cards)
  return (
    <section aria-labelledby="ov-strip-title">
      <Editable as="h2" id="ov-strip-title" keyPath="overview:today_strip" defaultText={t('ov_strip_title')} className="mb-3 text-lg font-semibold" />
      {today.error && !today.data ? <Card><Failed today={today} t={t} /></Card>
        : loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="status" aria-label={t('ov_strip_aria')}>
            {[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-24 rounded-2xl" />)}
          </div>
        ) : clear ? (
          <Card className="border-emerald-400/20 bg-emerald-400/[0.04]">
            <EmptyState icon="check" title={t('ov_all_clear')} text={t('ov_all_clear_sub')} />
          </Card>
        ) : (
          <ul aria-label={t('ov_strip_aria')} className={`grid grid-cols-2 gap-3 ${COLUMNS[cards.length] || 'sm:grid-cols-4'}`}>
            {cards.map((card, position) => {
              const unknown = card.count === null
              const active = !unknown && card.count > 0
              const tone = CARD_TONE[card.tone]
              // with an odd number of cards the last one takes the whole row on a phone
              const wide = cards.length % 2 === 1 && position === cards.length - 1
              return (
                <li key={card.key} className={wide ? 'col-span-2 sm:col-span-1' : ''}>
                  <Link
                    to={card.to}
                    className={`flex h-full min-h-[96px] flex-col justify-between rounded-2xl border p-4 transition-colors ${FOCUS} ${active ? tone.on : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}
                  >
                    <span className={`text-3xl font-semibold tabular-nums leading-none ${active ? tone.number : 'text-gray-400'}`}>{unknown ? '—' : card.count}</span>
                    <span className="mt-3 block">
                      <span className={`block text-sm font-medium ${active ? tone.label : 'text-gray-300'}`}>{t(card.labelKey)}</span>
                      <span className="block text-xs text-gray-400">{unknown ? t('ov_unknown') : active ? '' : t(card.emptyKey)}</span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
    </section>
  )
}

// ---------------------------------------------------------------------------------------------- "Sesiones de hoy"
export function TodaySessions({ today }) {
  const { t } = useAdminText()
  const loading = today.loading && !today.data
  const sessions = today.data?.sessions_today
  const shown = sessions ? sessions.items.slice(0, MAX_VISIBLE_SESSIONS) : []
  const more = sessions ? sessions.total - shown.length : 0
  const badgeText = (item) => {
    const { textKey } = sessionBadge(item)
    return t(textKey) === textKey ? item.status : t(textKey)
  }
  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="flex items-center gap-3 text-lg font-semibold">
          <Editable as="span" keyPath="overview:today_sessions" defaultText={t('ov_today_title')} />
          {sessions && sessions.total > 0 && <Badge tone="emerald">{sessions.total}</Badge>}
        </h2>
        {today.data?.date && sessions?.total > 0 && (
          <Link to={calendarDayLink(today.data.date)} className={`inline-flex min-h-[44px] items-center rounded-lg text-sm text-emerald-300 hover:text-emerald-200 ${FOCUS}`}>{t('ov_see_all')} →</Link>
        )}
      </div>
      {today.error && !today.data ? <Failed today={today} t={t} />
        : loading ? <div className="space-y-3" role="status" aria-label={t('ov_sessions_aria')}><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
          : !sessions ? <p className="py-6 text-center text-sm text-gray-400">{t('ov_unknown')}</p>
            : shown.length === 0 ? <EmptyState icon="calendar" title={t('ov_no_sessions')} text={t('ov_no_sessions_sub')} />
              : (
                <>
                  <ul aria-label={t('ov_sessions_aria')} className="divide-y divide-white/[0.06]">
                    {shown.map(item => (
                      <li key={item.id} className="flex items-center gap-4 py-3">
                        <span className="flex w-14 shrink-0 items-center gap-1.5 text-sm font-medium tabular-nums text-white"><Icon name="clock" className="h-4 w-4 text-gray-500" />{item.time || '—'}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{item.client || '—'}</span>
                          <span className="block truncate text-xs text-gray-400">{item.trainer || '—'}</span>
                        </span>
                        <Badge tone={sessionBadge(item).tone}>{badgeText(item)}</Badge>
                      </li>
                    ))}
                  </ul>
                  {more > 0 && (
                    <Link to={calendarDayLink(today.data.date)} className={`mt-2 inline-flex min-h-[44px] items-center rounded-lg text-sm text-emerald-300 hover:text-emerald-200 ${FOCUS}`}>
                      {fill(t('ov_more'), more)} →
                    </Link>
                  )}
                </>
              )}
    </Card>
  )
}

// ---------------------------------------------------------------------------------------------- "Avisos (n)"
const DOT = { red: 'bg-red-400', amber: 'bg-amber-400', sky: 'bg-sky-400' }

// One line, closed: the number of warnings and the most serious one. Open: every warning with a link to where it is solved. With none: a quiet
// "Todo en orden". The email warning is also still shown on the trial sessions page.
export function AlertsLine({ today }) {
  const { t } = useAdminText()
  const [open, setOpen] = useState(false)
  const alerts = alertsOf(today.data)
  const textOf = (alert) => {
    const text = fill(t(alert.textKey), alert.count ?? '')
    if (alert.key !== 'email' || !alert.reason) return text
    const key = `tr_err_${alert.reason}`
    return alert.reason.startsWith('http_') ? `${text} (${t('tr_err_http')} ${alert.reason.slice(5)})` : `${text} (${t(key) === key ? alert.reason : t(key)})`
  }
  const title = <Editable as="span" keyPath="overview:alerts" defaultText={t('ov_alerts_title')} />

  if (today.error && !today.data) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <span role="alert" className="flex items-center gap-2 text-sm text-gray-300"><Icon name="alert" className="h-4 w-4 text-red-300" />{t('ov_load_error')}</span>
        <button type="button" onClick={today.reload} className={`min-h-[44px] rounded-lg px-3 text-sm font-semibold text-emerald-300 hover:text-emerald-200 ${FOCUS}`}>{t('retry')}</button>
      </Card>
    )
  }
  if (today.loading && !today.data) return <Skeleton className="h-14 rounded-2xl" />
  if (alerts.length === 0) {
    return (
      <Card className="flex items-center gap-3 px-5 py-3 text-sm text-gray-400">
        <Icon name="check" className="h-4 w-4 text-emerald-300" />
        <h2 className="font-medium text-gray-300">{title}</h2>
        <span aria-hidden="true">·</span>
        <span>{t('ov_alerts_ok')}</span>
      </Card>
    )
  }
  const worst = alerts[0]
  return (
    <Card className={`overflow-hidden ${worst.tone === 'red' ? 'border-red-400/30' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 px-5">
        <h2 className="flex min-h-[48px] shrink-0 items-center gap-2 text-sm font-semibold">
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${DOT[worst.tone]}`} />
          <span>{title} <span className="tabular-nums">({alerts.length})</span></span>
        </h2>
        <button
          type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="ov-alerts-list"
          aria-label={`${open ? t('ov_alerts_hide') : t('ov_alerts_show')}: ${textOf(worst)}`}
          className={`flex min-h-[48px] min-w-0 flex-1 items-center justify-between gap-3 rounded-lg text-left text-sm text-gray-300 hover:text-white ${FOCUS}`}
        >
          <span className="min-w-0 truncate">{open ? '' : textOf(worst)}</span>
          <Icon name={open ? 'up' : 'down'} className="h-5 w-5 shrink-0 text-gray-400" />
        </button>
      </div>
      {open && (
        <ul id="ov-alerts-list" aria-label={t('ov_alerts_title')} className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
          {alerts.map(alert => (
            <li key={alert.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
              <span className="flex min-w-0 items-center gap-2.5">
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[alert.tone]}`} />
                <span className="text-gray-200">{textOf(alert)}</span>
              </span>
              <Link to={alert.to} className={`inline-flex min-h-[44px] items-center rounded-lg font-semibold text-emerald-300 hover:text-emerald-200 ${FOCUS}`}>{t(alert.linkKey)} →</Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
