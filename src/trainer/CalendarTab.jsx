import { useCallback, useEffect, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import enGbLocale from '@fullcalendar/core/locales/en-gb'
import esLocale from '@fullcalendar/core/locales/es'
import caLocale from '@fullcalendar/core/locales/ca'
import { MOBILE_QUERY, NEUTRAL_COLOR, OPENING_HOURS, madridWallClock } from '../admin/calendar/calendarConfig'
import '../admin/calendar/calendar.css'
import './trainer.css'
import { SessionModal } from './PanelParts'
import { CARD } from './trainerStyle'
import { addDaysKey, calendarEvents } from './trainerData'
import { errorKey } from './trainerSource'

const LOCALES = { en: enGbLocale, es: esLocale, ca: caLocale }
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

// Day, week and month with the same FullCalendar set-up as the admin calendar (same colours, same hours, Madrid time).
// The trainer's sessions in their colour, trials marked "Trial", and the free hours as quiet dashed blocks.
export default function CalendarTab({ source, text, color }) {
  const { t, language } = text
  const calendar = useRef(null)
  const mobile = useMobile()
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [count, setCount] = useState(null)
  const tone = color || NEUTRAL_COLOR

  // FullCalendar asks for the events of what it shows through ONE stable function.
  const sourceRef = useRef(source)
  const labelsRef = useRef({ trial: t('tr_cal_trial') })
  useEffect(() => {
    sourceRef.current = source
    labelsRef.current = { trial: t('tr_cal_trial') }
    calendar.current?.getApi().refetchEvents()
  }, [source, t])

  const fetchEvents = useCallback(async (info, success, failure) => {
    const range = { from: info.startStr.slice(0, 10), to: addDaysKey(info.endStr.slice(0, 10), -1) }
    try {
      const [sessions, free] = await Promise.all([sourceRef.current.sessions(range), sourceRef.current.freeSlots(range)])
      setError(null)
      const events = calendarEvents(sessions, free, tone, labelsRef.current)
      setCount(sessions.length)
      success(events)
    } catch (problem) {
      setError(problem)
      failure(problem)
    }
  }, [tone])

  const retry = () => { setError(null); calendar.current?.getApi().refetchEvents() }
  const wall = madridWallClock()
  const scrollHour = Math.max(Number(OPENING_HOURS.start.slice(0, 2)), wall.getUTCHours() - 1)

  const headerToolbar = mobile
    ? { left: 'prev,next', center: 'title', right: 'today' }
    : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }
  const footerToolbar = mobile ? { center: 'timeGridDay,timeGridWeek,dayGridMonth' } : false

  const classNames = (arg) => {
    const props = arg.event.extendedProps
    if (props.kind === 'free') return ['tr-free']
    return ['ac-ev', props.kind === 'trial' ? 'ac-trial' : 'ac-session', `ac-${props.status}`]
  }
  const mounted = (info) => {
    const props = info.event.extendedProps
    info.el.style.setProperty('--ev', props.color || NEUTRAL_COLOR)
    info.el.title = info.event.title
    if (props.kind === 'free') info.el.setAttribute('aria-hidden', 'true')
  }
  const renderEvent = (arg) => {
    const props = arg.event.extendedProps
    if (props.kind === 'free') return <div className="tr-free-inner" />          // a free hour is only the quiet dashed block: no text
    return (
      <div className="ac-ev-inner">
        <div className="ac-ev-title">{arg.timeText && <span className="ac-ev-time">{arg.timeText}</span>}{arg.event.title}</div>
        {props.kind === 'trial' && <div className="ac-ev-sub">{t('tr_cal_trial')}</div>}
      </div>
    )
  }

  return (
    <div>
      <ul aria-label={t('tr_cal_legend')} className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-300">
        <li className="flex items-center gap-2"><span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: tone }} />{t('tr_cal_legend_session')}</li>
        <li className="flex items-center gap-2"><span aria-hidden="true" className="h-3.5 w-5 rounded border-2 border-dashed" style={{ borderColor: tone }} />{t('tr_cal_legend_trial')}</li>
        <li className="flex items-center gap-2"><span aria-hidden="true" className="h-3.5 w-5 rounded border border-dashed border-gray-400" />{t('tr_cal_legend_free')}</li>
        <li className="flex items-center gap-2 text-gray-400"><span aria-hidden="true" className="h-3 w-3 rounded-full opacity-45" style={{ background: tone }} /><span className="line-through">{t('tr_cal_legend_cancelled')}</span></li>
      </ul>

      <div className={`${CARD} admin-fc tr-fc relative overflow-hidden p-2 sm:p-4`}>
        {error && (
          <div role="alert" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/75 p-6 text-center backdrop-blur-sm">
            <p className="max-w-sm text-sm text-gray-100">{t(errorKey(error))}</p>
            <button type="button" onClick={retry} className="min-h-[44px] rounded-xl border border-white/25 px-6 text-sm font-semibold uppercase tracking-wider text-white hover:bg-white hover:text-black">{t('tr_retry')}</button>
          </div>
        )}
        {loading && !error && <p role="status" className="absolute right-4 top-4 z-10 rounded-full bg-black/60 px-3 py-1 text-xs text-gray-300">{t('tr_loading')}</p>}
        <div className="ac-frame">
          <FullCalendar
            ref={calendar}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView={mobile ? 'timeGridDay' : 'timeGridWeek'}
            locale={LOCALES[language] || enGbLocale}
            buttonText={{ today: t('tr_cal_today'), month: t('tr_cal_month'), week: t('tr_cal_week'), day: t('tr_cal_day') }}
            moreLinkText={(number) => `+${number} ${t('tr_cal_more')}`}
            headerToolbar={headerToolbar}
            footerToolbar={footerToolbar}
            timeZone="UTC"
            now={madridWallClock}
            firstDay={1}
            height="100%"
            expandRows
            nowIndicator
            allDaySlot={false}
            slotMinTime={OPENING_HOURS.start}
            slotMaxTime={OPENING_HOURS.end}
            scrollTime={`${String(scrollHour).padStart(2, '0')}:00:00`}
            slotDuration="01:00:00"
            slotLabelFormat={TIME_FORMAT}
            eventTimeFormat={TIME_FORMAT}
            dayMaxEvents={3}
            eventDisplay="block"
            displayEventEnd={false}
            eventOrder={(a, b) => (a.extendedProps.kind === 'free') - (b.extendedProps.kind === 'free') || String(a.start).localeCompare(String(b.start))}
            events={fetchEvents}
            loading={setLoading}
            eventClassNames={classNames}
            eventDidMount={mounted}
            eventContent={renderEvent}
            eventClick={(info) => {
              info.jsEvent.preventDefault()
              const props = info.event.extendedProps
              if (props.kind !== 'free') setSelected(props.session)
            }}
          />
        </div>
        {count === 0 && !loading && !error && <p className="mt-3 text-center text-sm text-gray-500">{t('tr_cal_empty')}</p>}
      </div>

      {selected && <SessionModal session={selected} text={text} onClose={() => setSelected(null)} />}
    </div>
  )
}
