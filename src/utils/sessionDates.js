import { madridWallToInstant } from './inboxFormat.js'
// Dates, statuses and Google Calendar links of the client's sessions (My Sessions).
// Pure functions (no React), so they can be tested with `node --test`.

export const TIMEZONE = 'Europe/Madrid'
export const STUDIO_PLACE = 'ThundBalance, Carrer de Pallars 286, Barcelona'
export const SESSION_MINUTES = 60

const pad = (value) => String(value).padStart(2, '0')

// 'YYYY-MM-DD' -> a Date at noon UTC: formatting it in UTC never slips to the neighbouring day.
const utcDay = (key) => {
  const [year, month, day] = String(key).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 12))
}

// "lunes, 19 de octubre de 2026" (es-ES) / "Monday 19 October 2026" (en-GB) / "dilluns, 19 d’octubre de 2026" (ca-ES)
export function formatDay(key, locale, { year = true } = {}) {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long', day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC'
  }).format(utcDay(key))
}

// "lun, 19 oct" for the compact list
export function formatShortDay(key, locale) {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(utcDay(key))
}

// "12 nov" (no weekday, no year) for the one-line summaries
export function formatShortDate(key, locale) {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(utcDay(key))
}

// When the client sent something: the server saves UTC, the page shows the day in Madrid ("4 nov 2026").
export function formatSentAt(iso, locale) {
  if (!iso) return ''
  const text = String(iso)
  const moment = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`)
  if (Number.isNaN(moment.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: TIMEZONE }).format(moment)
}

export function formatMonth(date, locale) {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date)
}

export function weekdayNames(locale) {
  // 1 Jan 2024 was a Monday: the week starts on Monday
  return Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + index, 12))))
}

// 24-hour clock, always "HH:MM"
export const formatTime = (time) => String(time || '').slice(0, 5)

// What time is it in Madrid right now? { date: 'YYYY-MM-DD', time: 'HH:MM' }
export function madridNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(now).map(part => [part.type, part.value])
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

// 'YYYY-MM-DD' + 'HH:MM' plus some minutes, as the same two strings (wall clock, no time zone maths).
export function addMinutes(key, time, minutes) {
  const [hour, minute] = formatTime(time).split(':').map(Number)
  const moment = new Date(utcDay(key).getTime() - 12 * 3600000 + (hour * 60 + minute + minutes) * 60000)
  return {
    date: `${moment.getUTCFullYear()}-${pad(moment.getUTCMonth() + 1)}-${pad(moment.getUTCDate())}`,
    time: `${pad(moment.getUTCHours())}:${pad(moment.getUTCMinutes())}`
  }
}

// cancelled | completed | rescheduled | upcoming. A session is completed once its hour has ended in Madrid.
export function sessionStatus(session, now = new Date()) {
  if (String(session.status).toLowerCase() === 'cancelled') return 'cancelled'
  const end = addMinutes(session.date, session.time, SESSION_MINUTES)
  const current = madridNow(now)
  if (`${end.date} ${end.time}` <= `${current.date} ${current.time}`) return 'completed'
  return session.rescheduled ? 'rescheduled' : 'upcoming'
}

// The same title the e-mail, the .ics and the feed use (backend/calendar_titles.py).
export function clientSessionTitle(trainer, number) {
  const first = String(trainer || '').trim().split(/\s+/)[0]
  const position = String(number || '').trim()
  return `ThundBalance · Sesión${first ? ` con ${first}` : ''}${position ? ` ${position}` : ''}`
}

const stamp = ({ date, time }) => `${date.replaceAll('-', '')}T${time.replace(':', '')}00`

// Opens a prefilled event in Google Calendar. Local time + ctz (no UTC conversion).
export function googleCalendarUrl(session, details = '') {
  const end = addMinutes(session.date, session.time, SESSION_MINUTES)
  const dates = `${stamp({ date: session.date, time: formatTime(session.time) })}/${stamp(end)}`
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + `&text=${encodeURIComponent(clientSessionTitle(session.trainer, session.number))}`
    + `&dates=${dates}`
    + `&ctz=${encodeURIComponent(TIMEZONE)}`
    + `&details=${encodeURIComponent(details)}`
    + `&location=${encodeURIComponent(STUDIO_PLACE)}`
}
// Minutes from now until the session starts, in REAL time (the Madrid clock change is counted: on the day the clocks go
// back there are 25 hours); negative once it has started.
export function minutesUntil(session, now = new Date()) {
  const start = madridWallToInstant(`${String(session.date).slice(0, 10)}T${formatTime(session.time)}`)
  return start ? (start.getTime() - now.getTime()) / 60000 : Number.NaN
}

// A change can be requested up to `hours` before the session (the number comes from the server: GET /features). The server
// decides; this only decides whether the button is on. Without a number yet the button stays on and the server answers.
export const canRequestChange = (session, now = new Date(), hours) => (
  Number.isFinite(hours) ? minutesUntil(session, now) >= hours * 60 : minutesUntil(session, now) > 0
)
