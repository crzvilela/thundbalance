import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import enGbLocale from '@fullcalendar/core/locales/en-gb'
import esLocale from '@fullcalendar/core/locales/es'
import { API_URL } from '../../config'
import { adminFetch } from '../../api/admin'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { Button, Card, Icon, PageHeader } from '../ui'
import CalendarFilters from '../calendar/CalendarFilters'
import EventDetail from '../calendar/EventDetail'
import { MOBILE_QUERY, NEUTRAL_COLOR, dayKey, madridWallClock, slotDurationFor, studioHours } from '../calendar/calendarConfig'
import { useCalendarFilters } from '../calendar/useCalendarFilters'
import '../calendar/calendar.css'

const VIEWS = ['dayGridMonth', 'timeGridWeek', 'timeGridDay']
const TIME_FORMAT = { hour: '2-digit', minute: '2-digit', hour12: false }

function useMobile() {
  const [mobile, setMobile] = useState(() => (typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches))
  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY)
    const change = (event) => setMobile(event.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  return mobile
}

// Day and week views on a computer: the calendar takes all the height that is left on the screen (so every hour of the
// studio fits with no scrolling, inside or outside it) and follows the window when it is resized. `null` = not used
// (phones, the month view): the CSS height applies.
function useFitHeight(frame, enabled) {
  const [height, setHeight] = useState(null)
  useEffect(() => {
    const element = frame.current
    if (!enabled || !element) return undefined
    const compute = () => {
      const top = element.getBoundingClientRect().top + window.scrollY
      const padding = (node) => (node ? parseFloat(window.getComputedStyle(node).paddingBottom) || 0 : 0)
      setHeight(Math.max(240, Math.floor(window.innerHeight - top - padding(element.parentElement) - padding(element.closest('main')) - 2)))
    }
    const first = window.setTimeout(compute, 0)            // the first size, as soon as the page has been laid out
    const observer = new ResizeObserver(compute)          // and any later change of the page above the calendar
    observer.observe(document.documentElement)
    window.addEventListener('resize', compute)
    return () => { window.clearTimeout(first); observer.disconnect(); window.removeEventListener('resize', compute) }
  }, [frame, enabled])
  return enabled ? height : null
}

export default function Calendar() {
  const { t, language } = useAdminText()
  const calendar = useRef(null)
  const trainersResource = useAdminResource('/admin/trainer-availability')
  const trainers = useMemo(() => (Array.isArray(trainersResource.data) ? trainersResource.data : []), [trainersResource.data])
  const { filters, setFilters, clear, active, view, date, setPosition } = useCalendarFilters()
  const mobile = useMobile()
  const studio = useMemo(() => studioHours(trainers), [trainers])      // first start to last end of all trainers
  const frame = useRef(null)
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [count, setCount] = useState(null)
  const lastPosition = useRef('')

  // FullCalendar asks for events through ONE stable function that reads the current filters.
  const filtersRef = useRef(filters)
  const fetchEvents = useCallback(async (info, success, failure) => {
    const current = filtersRef.current
    const params = new URLSearchParams({ start: info.startStr.slice(0, 10), end: info.endStr.slice(0, 10), kind: current.kind })
    if (current.email) params.set('email', current.email)
    if (current.trainers.length) params.set('trainer_ids', current.trainers.join(','))
    if (current.cancelled) params.set('show_cancelled', 'true')
    try {
      const response = await adminFetch(`${API_URL}/admin/calendar?${params}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const events = await response.json()
      setError('')
      setCount(events.length)
      success(events)
    } catch (problem) {
      setError(problem.message || 'Error')
      failure(problem)
    }
  }, [])

  const filterKey = JSON.stringify(filters)
  useEffect(() => {
    filtersRef.current = filters
    calendar.current?.getApi().refetchEvents()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `filterKey` stands for the filters
  }, [filterKey])

  const retry = () => { setError(''); calendar.current?.getApi().refetchEvents() }
  const reload = () => calendar.current?.getApi().refetchEvents()

  const initialView = VIEWS.includes(view) ? view : (mobile ? 'timeGridDay' : 'timeGridWeek')
  const timeView = (VIEWS.includes(view) ? view : initialView) !== 'dayGridMonth'
  const fitHeight = useFitHeight(frame, !mobile && timeView)
  // 30-minute rows while they stay readable, hourly rows on a short screen (a session is one hour, on the hour)
  const slotDuration = mobile ? '00:30:00' : slotDurationFor(fitHeight ?? 10000, studio)
  useEffect(() => { calendar.current?.getApi().updateSize() }, [fitHeight, slotDuration])

  const headerToolbar = mobile
    ? { left: 'prev,next', center: 'title', right: 'today' }
    : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }
  const footerToolbar = mobile ? { center: 'timeGridDay,timeGridWeek,dayGridMonth' } : false

  const classNames = (arg) => {
    const props = arg.event.extendedProps
    return [
      'ac-ev', props.kind === 'trial' ? 'ac-trial' : 'ac-session', `ac-${props.status}`,
      props.kind === 'trial' && !props.trainerId ? 'ac-unassigned' : ''
    ].filter(Boolean)
  }

  const mounted = (info) => {
    const props = info.event.extendedProps
    // a trial the client has not confirmed yet is grey, like its "Trial (Pendiente)" event in Google
    const pending = props.kind === 'trial' && props.status === 'approved'
    info.el.style.setProperty('--ev', pending ? NEUTRAL_COLOR : (props.color || NEUTRAL_COLOR))
    info.el.title = info.event.title                      // the full title, whatever is cut by the width
  }

  const renderEvent = (arg) => {
    const props = arg.event.extendedProps
    const sub = props.kind === 'trial'
      ? [t(`ac_tr_${props.status}`), props.trainerId ? '' : t('ac_unassigned')].filter(Boolean).join(' · ')
      : ''
    return (
      <div className="ac-ev-inner">
        <div className="ac-ev-title">{arg.timeText && <span className="ac-ev-time">{arg.timeText}</span>}{arg.event.title}</div>
        {sub && <div className="ac-ev-sub">{sub}</div>}
      </div>
    )
  }

  return (
    <div className="admin-fade ac-page">
      <PageHeader
        title={t('ac_title')} subtitle={t('ac_sub')}
        actions={<Button variant="secondary" onClick={reload}><Icon name="refresh" className="h-4 w-4" />{t('refresh')}</Button>}
      />

      <CalendarFilters filters={filters} setFilters={setFilters} clear={clear} active={active} trainers={trainers} />

      <ul aria-label={t('ac_legend')} className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-300">
        {trainers.map(trainer => (
          <li key={trainer.id} className="flex items-center gap-2"><span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: trainer.color || NEUTRAL_COLOR }} />{trainer.name}</li>
        ))}
        <li className="flex items-center gap-2"><span aria-hidden="true" className="h-3.5 w-5 rounded border-2 border-dashed" style={{ borderColor: NEUTRAL_COLOR, background: 'color-mix(in srgb, #9ca3af 22%, transparent)' }} />{t('ac_legend_pending')}</li>
        <li className="flex items-center gap-2"><span aria-hidden="true" className="h-3.5 w-5 rounded border-2 border-dashed border-gray-300" />{t('ac_legend_trial')}</li>
        <li className="flex items-center gap-2"><span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: NEUTRAL_COLOR }} />{t('ac_unassigned')}</li>
        <li className="flex items-center gap-2 text-gray-400"><span aria-hidden="true" className="h-3 w-3 rounded-full opacity-45" style={{ background: NEUTRAL_COLOR }} /><span className="line-through">{t('ac_legend_cancelled')}</span></li>
      </ul>

      <Card className="admin-fc relative overflow-hidden p-2 sm:p-4">
        {error && (
          <div role="alert" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/70 p-6 text-center backdrop-blur-sm">
            <Icon name="alert" className="h-6 w-6 text-red-300" />
            <p className="text-sm text-gray-100">{t('ac_error')} <span className="text-gray-400">({error})</span></p>
            <Button variant="secondary" onClick={retry}>{t('ac_retry')}</Button>
          </div>
        )}
        {loading && !error && <p role="status" className="absolute right-4 top-4 z-10 rounded-full bg-black/60 px-3 py-1 text-xs text-gray-300">{t('ac_loading')}</p>}
        <div ref={frame} className="ac-frame" style={fitHeight ? { height: fitHeight } : undefined}>
          <FullCalendar
            ref={calendar}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={initialView}
            {...(date ? { initialDate: date } : {})}
            locale={language === 'es' ? esLocale : enGbLocale}
            buttonText={{ today: t('ac_today'), month: t('ac_month'), week: t('ac_week'), day: t('ac_day') }}
            moreLinkText={(number) => `+${number} ${t('ac_more')}`}
            headerToolbar={headerToolbar}
            footerToolbar={footerToolbar}
            timeZone="UTC"
            now={madridWallClock}
            firstDay={1}
            height="100%"
            expandRows
            nowIndicator
            allDaySlot={false}
            slotMinTime={studio.start}
            slotMaxTime={studio.end}
            scrollTime={studio.start}
            slotDuration={slotDuration}
            slotLabelInterval="01:00:00"
            slotEventOverlap={false}
            slotLabelFormat={TIME_FORMAT}
            eventTimeFormat={TIME_FORMAT}
            dayMaxEvents={4}
            eventDisplay="block"
            displayEventEnd={false}
            events={fetchEvents}
            loading={setLoading}
            eventClassNames={classNames}
            eventDidMount={mounted}
            eventContent={renderEvent}
            eventClick={(info) => { info.jsEvent.preventDefault(); setSelected(info.event) }}
            datesSet={(info) => {
              const key = `${info.view.type}|${dayKey(info.view.currentStart)}`
              if (key !== lastPosition.current) { lastPosition.current = key; setPosition(info.view.type, dayKey(info.view.currentStart)) }
            }}
          />
        </div>
        {count === 0 && !loading && !error && <p className="mt-3 text-center text-sm text-gray-500">{t('ac_empty')}</p>}
      </Card>

      {selected && <EventDetail key={selected.id} event={selected} onClose={() => setSelected(null)} onChanged={reload} />}
    </div>
  )
}
