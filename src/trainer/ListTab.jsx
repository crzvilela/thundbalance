import { useState } from 'react'
import { ErrorBox, SessionModal, Skeleton, StatusBadge, TrialTag } from './PanelParts'
import { CARD, FOCUS, formatDay } from './trainerStyle'
import { STATUSES, filterByStatus, groupByDay, madridToday } from './trainerData'
import { errorKey } from './trainerSource'

// The sessions of the period grouped by day (the coming days first), filtered by status, each one opening the
// same read-only details as the calendar.
export default function ListTab({ state, text, color }) {
  const { t, locale } = text
  const [status, setStatus] = useState('all')
  const [open, setOpen] = useState(null)
  const today = madridToday()

  if (state.loading) return <div role="status" aria-label={t('tr_loading')} className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
  if (state.error) return <ErrorBox message={t(errorKey(state.error))} onRetry={state.reload} retryLabel={t('tr_retry')} />
  if (!state.data) return null

  const all = state.data
  const groups = groupByDay(filterByStatus(all, status), today)

  return (
    <div>
      <div role="group" aria-label={t('tr_list_filter')} className="mb-5 flex flex-wrap gap-2">
        {['all', ...STATUSES].map(key => (
          <button key={key} type="button" aria-pressed={status === key} onClick={() => setStatus(key)}
            className={`min-h-[44px] rounded-full border px-4 text-sm transition ${FOCUS} ${status === key ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-gray-400 hover:border-white/25 hover:text-white'}`}>
            {t(`tr_f_${key}`)}
            <span className="ml-2 rounded-full bg-white/10 px-1.5 text-xs tabular-nums">{key === 'all' ? all.length : all.filter(item => item.status === key).length}</span>
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className={`${CARD} p-8 text-center text-sm text-gray-400`}>{t(all.length === 0 ? 'tr_list_empty' : 'tr_list_empty_filter')}</p>
      ) : (
        <div className="space-y-6">
          {groups.map(group => (
            <section key={group.date} aria-label={formatDay(group.date, locale)}>
              <h3 className="mb-2 flex items-center gap-3 text-sm font-semibold text-gray-200 first-letter:uppercase">
                {formatDay(group.date, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
                {group.date === today && <span className="rounded-full bg-emerald-400 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-black">{t('tr_list_today')}</span>}
              </h3>
              <ul className={`${CARD} divide-y divide-white/[0.07] overflow-hidden`}>
                {group.items.map(item => (
                  <li key={`${item.is_trial ? 't' : 's'}${item.session_id}`}>
                    <button type="button" onClick={() => setOpen(item)}
                      aria-label={t('tr_list_open', { name: item.client_display_name, when: `${formatDay(item.date, locale, { weekday: 'long', day: 'numeric', month: 'long' })} ${item.time}` })}
                      className={`flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.05] ${FOCUS} ${item.status === 'cancelled' ? 'opacity-60' : ''}`}>
                      <span aria-hidden="true" className="h-10 w-1 shrink-0 rounded-full" style={{ background: color }} />
                      <span className="w-14 shrink-0 text-lg tabular-nums text-white">{item.time}</span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-base font-medium text-white ${item.status === 'cancelled' ? 'line-through' : ''}`}>{item.client_display_name}</span>
                        <span className="block truncate text-sm text-gray-400">{item.is_trial ? t('tr_trial') : [item.session_number, item.pack_name].filter(Boolean).join(' · ')}</span>
                      </span>
                      {item.is_trial && <span className="hidden sm:block"><TrialTag label={t('tr_trial')} /></span>}
                      <StatusBadge status={item.status} label={t(`tr_status_${item.status}`)} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {open && <SessionModal session={open} text={text} onClose={() => setOpen(null)} />}
    </div>
  )
}
