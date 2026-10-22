import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import InsightsTab from './InsightsTab'
import ListTab from './ListTab'
import CalendarTab from './CalendarTab'
import { CARD, FOCUS, HEADING_FONT, formatDay } from './trainerStyle'
import { PERIODS, madridToday, rangeProblem, resolveRange } from './trainerData'
import { useLoad } from './useLoad'
import { useTrainerText } from './useTrainerText'

const TABS = ['insights', 'calendar', 'list']
const ICON = {
  insights: <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-white/15 p-1">
      {options.map(([key, text]) => (
        <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}
          className={`min-h-[44px] rounded-lg px-3 text-sm font-semibold transition sm:px-4 ${FOCUS} ${value === key ? 'bg-emerald-400 text-black' : 'text-gray-300 hover:text-white'}`}>
          {text}
        </button>
      ))}
    </div>
  )
}

// The panel of a trainer: period, three tabs (Insights | Calendar | List). It knows nothing about who is looking:
// the trainer's page and the admin's view give it a `source` (see trainerSource.js). READ ONLY: nothing in it changes data.
export default function TrainerPanel({ source, trainerName, color, language }) {
  const text = useTrainerText(language)
  const { t, locale } = text
  const [params, setParams] = useSearchParams()

  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'insights'
  const period = PERIODS.includes(params.get('period')) ? params.get('period') : 'week'
  const from = params.get('from') || ''
  const to = params.get('to') || ''
  const range = useMemo(() => resolveRange({ period, from, to }), [period, from, to])

  // custom range: typed first, applied with the button
  const [draft, setDraft] = useState({ from, to })
  const [problem, setProblem] = useState(null)
  const update = (changes) => setParams(previous => {
    const next = new URLSearchParams(previous)
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key) }
    return next
  }, { replace: true })

  const choosePeriod = (value) => {
    setProblem(null)
    if (value === 'custom') {
      const today = madridToday()
      const start = draft.from || today
      const end = draft.to || today
      setDraft({ from: start, to: end })
      update({ period: 'custom', from: start, to: end })
    } else {
      update({ period: value, from: '', to: '' })
    }
  }
  const apply = () => {
    const error = rangeProblem(draft.from, draft.to)
    setProblem(error)
    if (!error) update({ period: 'custom', from: draft.from, to: draft.to })
  }

  const summary = useLoad(
    () => source.summary({ period, from: period === 'custom' ? from : '', to: period === 'custom' ? to : '' }),
    tab === 'insights' && range ? `${period}|${range.from}|${range.to}` : null
  )
  const list = useLoad(() => source.sessions(range), tab === 'list' && range ? `${range.from}|${range.to}` : null)

  const showPeriod = tab !== 'calendar'
  return (
    <div>
      <header className="mb-6">
        <h1 className="text-5xl text-white sm:text-6xl" style={HEADING_FONT}>{t('tr_greeting', { name: trainerName })}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-400">
          <span className="rounded-full border border-white/15 px-2.5 py-0.5 text-xs uppercase tracking-wider text-gray-300">{t('tr_readonly')}</span>
          {t('tr_subtitle')}
        </p>
      </header>

      <div role="tablist" aria-label={t('tr_tabs_label')} className="mb-6 flex gap-1 overflow-x-auto border-b border-white/10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(key => (
          <button key={key} type="button" role="tab" id={`tr-tab-${key}`} aria-selected={tab === key} aria-controls={`tr-panel-${key}`} tabIndex={tab === key ? 0 : -1}
            onClick={() => update({ tab: key === 'insights' ? '' : key })}
            onKeyDown={(event) => {
              const move = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
              if (!move) return
              event.preventDefault()
              const next = TABS[(TABS.indexOf(key) + move + TABS.length) % TABS.length]
              update({ tab: next === 'insights' ? '' : next })
              document.getElementById(`tr-tab-${next}`)?.focus()
            }}
            className={`flex min-h-[48px] min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-2 text-xs font-semibold uppercase tracking-wider outline-none sm:flex-none sm:gap-2 sm:px-4 sm:text-sm transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400 ${tab === key ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-gray-400 hover:text-white'}`}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[key]}</svg>
            {t(`tr_tab_${key}`)}
          </button>
        ))}
      </div>

      {showPeriod && (
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented label={t('tr_period_label')} value={period}
              options={PERIODS.map(key => [key, t(`tr_period_${key}`)])} onChange={choosePeriod} />
            {range && <p className="text-sm text-gray-400">{t('tr_range_shown', { from: formatDay(range.from, locale, { day: 'numeric', month: 'short', year: 'numeric' }), to: formatDay(range.to, locale, { day: 'numeric', month: 'short', year: 'numeric' }) })}</p>}
          </div>
          {period === 'custom' && (
            <div className={`${CARD} mt-3 flex flex-wrap items-end gap-3 p-4`}>
              {[['from', 'tr_from'], ['to', 'tr_to']].map(([field, label]) => (
                <label key={field} className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-xs uppercase tracking-wider text-gray-400">
                  {t(label)}
                  <input type="date" value={draft[field]} onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))}
                    className={`min-h-[44px] rounded-xl border border-white/15 bg-black/40 px-3 text-base normal-case tracking-normal text-white [color-scheme:dark] ${FOCUS}`} />
                </label>
              ))}
              <button type="button" onClick={apply} className={`min-h-[44px] rounded-xl bg-emerald-400 px-6 text-sm font-semibold uppercase tracking-wider text-black transition hover:bg-emerald-300 ${FOCUS}`}>{t('tr_apply')}</button>
              {problem && <p role="alert" className="basis-full text-sm text-red-300">{t(problem)}</p>}
            </div>
          )}
        </div>
      )}

      <div role="tabpanel" id={`tr-panel-${tab}`} aria-labelledby={`tr-tab-${tab}`}>
        {!range && tab !== 'calendar' && <p role="alert" className={`${CARD} p-6 text-center text-sm text-red-300`}>{t(rangeProblem(from, to) || 'tr_range_missing')}</p>}
        {tab === 'insights' && <InsightsTab state={summary} text={text} color={color} />}
        {tab === 'calendar' && <CalendarTab source={source} text={text} color={color} />}
        {tab === 'list' && <ListTab state={list} text={text} color={color} />}
      </div>
    </div>
  )
}
