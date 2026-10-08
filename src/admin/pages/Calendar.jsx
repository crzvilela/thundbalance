import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminRequest } from '../api'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { useToast } from '../toastContext'
import { dateKey, parseDateKey } from '../requests'
import { Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Icon, PageHeader, SelectInput, Skeleton } from '../ui'

const HOUR_HEIGHT = 52
const TRAINER_COLORS = [
  { chip: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-100', dot: 'bg-emerald-400' },
  { chip: 'border-sky-400/40 bg-sky-400/15 text-sky-100', dot: 'bg-sky-400' },
  { chip: 'border-violet-400/40 bg-violet-400/15 text-violet-100', dot: 'bg-violet-400' },
  { chip: 'border-rose-400/40 bg-rose-400/15 text-rose-100', dot: 'bg-rose-400' },
  { chip: 'border-orange-400/40 bg-orange-400/15 text-orange-100', dot: 'bg-orange-400' }
]
const TRIAL_COLOR = { chip: 'border-amber-400/50 bg-amber-400/15 text-amber-100', dot: 'bg-amber-400' }
const OTHER_COLOR = { chip: 'border-white/20 bg-white/10 text-gray-200', dot: 'bg-gray-400' }

const dayOf = (value) => value.slice(0, 10)
const minutesOf = (value) => Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16))
const timeOf = (value) => value.slice(11, 16)
const addDays = (date, amount) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)
const mondayOf = (date) => addDays(date, -((date.getDay() + 6) % 7))

// Side-by-side columns for events that overlap in time within one day.
function layoutDay(list) {
  const sorted = [...list].sort((a, b) => a.s - b.s || a.e - b.e)
  const placed = []
  let cluster = []
  let clusterEnd = -1
  const flush = () => {
    const columns = Math.max(...cluster.map(item => item.col)) + 1
    cluster.forEach(item => placed.push({ ...item, columns }))
    cluster = []
  }
  for (const event of sorted) {
    if (cluster.length && event.s >= clusterEnd) { flush(); clusterEnd = -1 }
    const used = cluster.filter(item => item.e > event.s).map(item => item.col)
    let col = 0
    while (used.includes(col)) col += 1
    cluster.push({ ...event, col })
    clusterEnd = Math.max(clusterEnd, event.e)
  }
  if (cluster.length) flush()
  return placed
}

export default function Calendar() {
  const { t, language } = useAdminText()
  const toast = useToast()
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const todayKey = dateKey(new Date())
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes()

  const [view, setView] = useState(() => (typeof window !== 'undefined' && window.innerWidth >= 1024 ? 'week' : 'month'))
  const [cursor, setCursor] = useState(() => new Date())
  const [selectedDay, setSelectedDay] = useState(todayKey)
  const [trainer, setTrainer] = useState('')
  const [selected, setSelected] = useState(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [busy, setBusy] = useState(false)

  // Visible range: a Monday-first week, or the full weeks around the month.
  const range = useMemo(() => {
    if (view === 'week') {
      const start = mondayOf(cursor)
      return { start, days: 7 }
    }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const start = mondayOf(first)
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    const weeks = Math.ceil(((last - start) / 86400000 + 1) / 7)
    return { start, days: weeks * 7 }
  }, [view, cursor])

  const days = useMemo(() => Array.from({ length: range.days }, (_, index) => {
    const date = addDays(range.start, index)
    return { key: dateKey(date), date, inMonth: date.getMonth() === cursor.getMonth() }
  }), [range, cursor])

  const resource = useAdminResource(`/admin/calendar-events?start=${days[0].key}&end=${dateKey(addDays(range.start, range.days))}`)
  const allEvents = useMemo(() => (Array.isArray(resource.data) ? resource.data : []), [resource.data])

  const trainerNames = useMemo(
    () => [...new Set(allEvents.map(event => event.trainer).filter(Boolean))].sort(),
    [allEvents]
  )
  const colorFor = (event) => {
    if (event.kind === 'trial') return TRIAL_COLOR
    if (event.kind === 'session') return TRAINER_COLORS[Math.max(0, trainerNames.indexOf(event.trainer)) % TRAINER_COLORS.length]
    return OTHER_COLOR
  }

  const events = useMemo(() => allEvents
    .filter(event => !trainer || event.trainer === trainer)
    .map(event => {
      const s = event.all_day ? 0 : minutesOf(event.start)
      const e = event.all_day ? 0 : Math.max(s + 30, event.end && dayOf(event.end) === dayOf(event.start) ? minutesOf(event.end) : 24 * 60)
      return { ...event, day: dayOf(event.start), s, e }
    }), [allEvents, trainer])

  const byDay = useMemo(() => {
    const map = new Map()
    for (const event of events) {
      if (!map.has(event.day)) map.set(event.day, [])
      map.get(event.day).push(event)
    }
    for (const list of map.values()) list.sort((a, b) => a.s - b.s)
    return map
  }, [events])

  const hours = useMemo(() => {
    const timed = events.filter(event => !event.all_day)
    const first = Math.min(7, ...timed.map(event => Math.floor(event.s / 60)))
    const last = Math.max(21, ...timed.map(event => Math.ceil(event.e / 60) - 1))
    return { first, last }
  }, [events])

  const label = (event) => {
    if (event.kind === 'session') return `${event.client || event.title}${event.number ? ` · ${event.number}` : ''}`
    if (event.kind === 'trial') return `${t('cal_legend_trial')}: ${event.client || ''}`
    return event.title
  }

  const shift = (direction) => setCursor(current => view === 'week'
    ? addDays(current, direction * 7)
    : new Date(current.getFullYear(), current.getMonth() + direction, 1))
  const goToday = () => { setCursor(new Date()); setSelectedDay(todayKey) }

  const title = view === 'week'
    ? `${days[0].date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} – ${days[6].date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : cursor.toLocaleDateString(locale, { month: 'long', year: 'numeric' })

  const cancelSelected = async () => {
    setBusy(true)
    try {
      if (selected.kind === 'session') await adminRequest('POST', `/admin/sessions/${selected.session_id}/cancel`)
      else await adminRequest('POST', `/admin/trial-sessions/${selected.trial_id}/cancel`)
      toast.push(t(selected.kind === 'session' ? 'cl_cancelled_ok' : 'tr_cancelled_ok'))
      setConfirmCancel(false)
      setSelected(null)
      resource.reload()
    } catch (error) {
      toast.push(error.message, 'error')
      setConfirmCancel(false)
    } finally {
      setBusy(false)
    }
  }

  const canCancel = selected && ((selected.kind === 'session' && String(selected.status).toLowerCase() !== 'cancelled') || (selected.kind === 'trial' && ['approved', 'confirmed'].includes(String(selected.status).toLowerCase())))
  const dayEvents = byDay.get(selectedDay) || []
  const weekdayLabels = days.slice(0, 7).map(day => day.date.toLocaleDateString(locale, { weekday: 'short' }))

  const EventButton = ({ event, className = '', style }) => (
    <button
      type="button" onClick={() => setSelected(event)} style={style} title={`${timeOf(event.start)} ${label(event)}`}
      className={`overflow-hidden rounded-lg border border-l-[3px] px-2 py-1 text-left text-[11px] leading-tight shadow-sm transition hover:z-20 hover:brightness-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 ${colorFor(event).chip} ${className}`}
    >
      <span className="block truncate font-semibold">{label(event)}</span>
      {!event.all_day && <span className="block truncate opacity-70">{timeOf(event.start)}{event.trainer ? ` · ${event.trainer}` : ''}</span>}
    </button>
  )

  return (
    <div className="admin-fade">
      <PageHeader
        title={t('cal_title')} subtitle={t('cal_sub')}
        actions={<Button variant="secondary" onClick={resource.reload}><Icon name="refresh" className="h-4 w-4" />{t('refresh')}</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shift(-1)} aria-label={t('cal_prev')} className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white"><Icon name="arrow" className="h-4 w-4 rotate-180" /></button>
          <button type="button" onClick={() => shift(1)} aria-label={t('cal_next')} className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white"><Icon name="arrow" className="h-4 w-4" /></button>
          <Button variant="secondary" onClick={goToday} className="ml-1 !px-3 !py-1.5">{t('cal_today')}</Button>
          <h2 className="ml-3 text-lg font-semibold capitalize">{title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SelectInput value={trainer} onChange={event => setTrainer(event.target.value)} aria-label={t('trainer')} className="!w-auto min-w-44">
            <option value="">{t('ss_all_trainers')}</option>
            {trainerNames.map(name => <option key={name} value={name}>{name}</option>)}
          </SelectInput>
          <div className="hidden rounded-lg border border-white/10 bg-black/30 p-0.5 lg:flex" role="group">
            {[['week', t('cal_week')], ['month', t('cal_month')]].map(([key, text]) => (
              <button key={key} type="button" onClick={() => setView(key)} aria-pressed={view === key}
                className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${view === key ? 'bg-emerald-400 text-black' : 'text-gray-400 hover:text-white'}`}>{text}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-400">
        {trainerNames.map(name => (
          <span key={name} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${TRAINER_COLORS[trainerNames.indexOf(name) % TRAINER_COLORS.length].dot}`} />{name}</span>
        ))}
        <span className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${TRIAL_COLOR.dot}`} />{t('cal_legend_trial')}</span>
        <span className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${OTHER_COLOR.dot}`} />{t('cal_legend_other')}</span>
        <span className="ml-auto flex items-center gap-1.5 text-emerald-300/80"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{t('cal_synced')}</span>
      </div>

      {resource.error ? (
        <Card><ErrorState message={`${t('load_error')} (${resource.error})`} retryLabel={t('retry')} onRetry={resource.reload} /></Card>
      ) : resource.loading && !resource.data ? (
        <Skeleton className="h-[32rem] w-full" />
      ) : view === 'week' ? (
        <Card className="overflow-hidden shadow-xl shadow-black/30">
          <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-white/[0.08] bg-white/[0.02]">
            <div />
            {days.map(day => (
              <button key={day.key} type="button" onClick={() => setSelectedDay(day.key)}
                className={`border-l border-white/[0.06] px-2 py-3 text-center transition hover:bg-white/5 ${day.key === todayKey ? 'bg-emerald-400/5' : ''}`}>
                <span className="block text-[11px] uppercase text-gray-500">{day.date.toLocaleDateString(locale, { weekday: 'short' })}</span>
                <span className={`mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${day.key === todayKey ? 'bg-emerald-400 text-black' : ''}`}>{day.date.getDate()}</span>
              </button>
            ))}
          </div>

          {days.some(day => (byDay.get(day.key) || []).some(event => event.all_day)) && (
            <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-white/[0.08]">
              <div className="px-1 py-2 text-right text-[10px] uppercase text-gray-600">{t('cal_all_day')}</div>
              {days.map(day => (
                <div key={day.key} className="space-y-1 border-l border-white/[0.06] p-1">
                  {(byDay.get(day.key) || []).filter(event => event.all_day).map(event => <EventButton key={event.id} event={event} className="w-full" />)}
                </div>
              ))}
            </div>
          )}

          <div className="relative grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
            <div className="pt-3">
              {Array.from({ length: hours.last - hours.first + 1 }, (_, index) => (
                <div key={index} style={{ height: HOUR_HEIGHT }} className="relative pr-2 text-right text-[11px] tabular-nums text-gray-500">
                  <span className="absolute -top-2 right-2">{String(hours.first + index).padStart(2, '0')}:00</span>
                </div>
              ))}
            </div>
            {days.map(day => {
              const timed = layoutDay((byDay.get(day.key) || []).filter(event => !event.all_day))
              return (
                <div key={day.key} className={`relative mt-3 border-l border-white/[0.06] ${day.key === todayKey ? 'bg-emerald-400/[0.04]' : ''}`} style={{ height: (hours.last - hours.first + 1) * HOUR_HEIGHT }}>
                  {Array.from({ length: hours.last - hours.first + 1 }, (_, index) => (
                    <div key={index} style={{ top: index * HOUR_HEIGHT, height: HOUR_HEIGHT }} className={`absolute inset-x-0 border-t border-white/[0.06] ${index % 2 ? 'bg-white/[0.012]' : ''}`}>
                      <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-white/[0.04]" />
                    </div>
                  ))}
                  {day.key === todayKey && nowMinutes >= hours.first * 60 && nowMinutes <= (hours.last + 1) * 60 && (
                    <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: ((nowMinutes - hours.first * 60) / 60) * HOUR_HEIGHT }}>
                      <span className="-ml-1 h-2 w-2 rounded-full bg-rose-400" />
                      <span className="h-px flex-1 bg-rose-400/80" />
                    </div>
                  )}
                  {timed.map(event => (
                    <EventButton
                      key={event.id} event={event} className="absolute"
                      style={{
                        top: ((event.s - hours.first * 60) / 60) * HOUR_HEIGHT + 1,
                        height: Math.max(26, ((event.e - event.s) / 60) * HOUR_HEIGHT - 2),
                        left: `calc(${(event.col / event.columns) * 100}% + 2px)`,
                        width: `calc(${100 / event.columns}% - 4px)`
                      }}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        </Card>
      ) : (
        <>
          <Card className="hidden overflow-hidden lg:block">
            <div className="grid grid-cols-7 border-b border-white/[0.08] bg-white/[0.02]">
              {weekdayLabels.map(text => <div key={text} className="py-2.5 text-center text-[11px] font-medium uppercase tracking-wider text-gray-500">{text}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {days.map(day => {
                const list = byDay.get(day.key) || []
                const isToday = day.key === todayKey
                return (
                  <div key={day.key} className={`min-h-32 border-b border-l border-white/[0.06] p-1.5 [&:nth-child(7n+1)]:border-l-0 ${day.inMonth ? '' : 'bg-black/20'} ${isToday ? 'bg-emerald-400/[0.04]' : ''}`}>
                    <span className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums ${isToday ? 'bg-emerald-400 font-semibold text-black' : day.inMonth ? 'text-gray-300' : 'text-gray-600'}`}>{day.date.getDate()}</span>
                    <div className="space-y-1">
                      {list.slice(0, 3).map(event => <EventButton key={event.id} event={event} className="block w-full" />)}
                      {list.length > 3 && (
                        <button type="button" onClick={() => { setCursor(day.date); setView('week') }} className="px-1 text-[11px] text-gray-400 hover:text-emerald-300">+{list.length - 3} {t('cal_more')}</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          <div className="grid gap-6 lg:hidden">
            <Card className="p-4">
              <div className="grid grid-cols-7 gap-1 text-center">
                {weekdayLabels.map(text => <div key={text} className="pb-1 text-[11px] uppercase text-gray-500">{text}</div>)}
                {days.map(day => {
                  const list = byDay.get(day.key) || []
                  const isSelected = day.key === selectedDay
                  return (
                    <button key={day.key} type="button" onClick={() => setSelectedDay(day.key)}
                      className={`flex min-h-14 flex-col items-center rounded-xl border p-1.5 text-sm transition ${
                        isSelected ? 'border-emerald-400 bg-emerald-400/15'
                          : day.key === todayKey ? 'border-emerald-400/40 hover:bg-white/5' : 'border-transparent hover:border-white/15 hover:bg-white/5'
                      } ${day.inMonth ? '' : 'opacity-35'}`}>
                      <span className="tabular-nums">{day.date.getDate()}</span>
                      {list.length > 0 && (
                        <span className="mt-1 flex flex-wrap items-center justify-center gap-0.5">
                          {list.slice(0, 4).map(event => <span key={event.id} className={`h-1.5 w-1.5 rounded-full ${colorFor(event).dot}`} />)}
                          {list.length > 4 && <span className="text-[9px] text-gray-400">+{list.length - 4}</span>}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="text-lg font-semibold capitalize">{parseDateKey(selectedDay).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
              <p className="mb-4 text-xs text-gray-500">{dayEvents.length} {t('cal_events_count')}</p>
              {dayEvents.length === 0 ? (
                <EmptyState icon="calendar" title={t('cal_no_events')} />
              ) : (
                <ul className="space-y-2">
                  {dayEvents.map(event => (
                    <li key={event.id}>
                      <button type="button" onClick={() => setSelected(event)} className="flex w-full items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-left transition hover:border-white/20">
                        <span className={`h-9 w-1 shrink-0 rounded-full ${colorFor(event).dot}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{label(event)}</span>
                          <span className="block truncate text-xs text-gray-500">{event.all_day ? t('cal_all_day') : `${timeOf(event.start)} – ${timeOf(event.end)}`}{event.trainer ? ` · ${event.trainer}` : ''}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      <Drawer
        open={!!selected} onClose={() => setSelected(null)}
        title={selected ? (selected.kind === 'other' ? selected.title : selected.client || selected.title) : ''}
        subtitle={selected ? t(`cal_type_${selected.kind}`) : ''}
        footer={selected && <>
          {selected.link && <a href={selected.link} target="_blank" rel="noopener noreferrer" className="inline-flex flex-1 items-center justify-center rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-gray-100 transition hover:bg-white/10">{t('cal_open_google')}</a>}
          {canCancel && <Button variant="danger" className="flex-1" onClick={() => setConfirmCancel(true)}>{t('cl_cancel_session')}</Button>}
        </>}
      >
        {selected && (
          <dl className="space-y-5 text-sm">
            <div className="flex items-center gap-2"><Badge tone={selected.kind === 'trial' ? 'amber' : selected.kind === 'session' ? 'emerald' : 'neutral'}>{t(`cal_type_${selected.kind}`)}</Badge>{selected.status && <Badge>{selected.status}</Badge>}</div>
            <div>
              <dt className="mb-1 text-xs uppercase tracking-wider text-gray-500">{t('cal_when')}</dt>
              <dd className="capitalize">{parseDateKey(dayOf(selected.start)).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</dd>
              {!selected.all_day && <dd className="text-gray-400">{timeOf(selected.start)} – {timeOf(selected.end)}</dd>}
            </div>
            {selected.client && <div><dt className="mb-1 text-xs uppercase tracking-wider text-gray-500">{t('cal_client')}</dt><dd>{selected.client}{selected.number ? ` · ${selected.number}` : ''}</dd></div>}
            {selected.trainer && <div><dt className="mb-1 text-xs uppercase tracking-wider text-gray-500">{t('trainer')}</dt><dd>{selected.trainer}</dd></div>}
            {selected.kind === 'other' && <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-gray-400">{t('cal_other_hint')}</p>}
            {selected.kind === 'session' && <Link to="/admin/clients" className="inline-block text-emerald-300 hover:text-emerald-200">{t('cal_view_client')} →</Link>}
          </dl>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmCancel} busy={busy}
        title={t(selected?.kind === 'trial' ? 'tr_cancel_title' : 'cl_cancel_title')}
        text={t(selected?.kind === 'trial' ? 'tr_cancel_text' : 'cl_cancel_text')}
        confirmLabel={t('cl_cancel_do')} cancelLabel={t('cl_cancel_keep')}
        onConfirm={cancelSelected} onCancel={() => setConfirmCancel(false)}
      />
    </div>
  )
}
