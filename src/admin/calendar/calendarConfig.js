// Settings and small helpers of the admin calendar.

// The hours drawn in the day and week views. They come from the working hours of the trainers (see studioHours):
// the first hour any trainer starts and the last hour any trainer ends, so the hours when the studio never opens
// are not shown. ONLY when no trainer has hours yet, these two constants are used. Change them here.
export const STUDIO_START = '07:00'
export const STUDIO_END = '21:00'
export const OPENING_HOURS = { start: `${STUDIO_START}:00`, end: `${STUDIO_END}:00` }

const toMinutes = (text) => {
  const [hour, minute] = String(text || '').split(':').map(Number)
  return Number.isFinite(hour) ? hour * 60 + (minute || 0) : null
}
const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:00:00`

// The studio's day from the trainers' weekly hours ([{ hours: { Monday: { start: '07:00', end: '21:00' } | null, ... } }]):
// { start, end } as "HH:00:00" (whole hours: the start rounded down, the end rounded up), or the constants.
export function studioHours(trainers) {
  let first = null
  let last = null
  for (const trainer of Array.isArray(trainers) ? trainers : []) {
    for (const window of Object.values(trainer?.hours || {})) {
      const start = toMinutes(window?.start)
      const end = toMinutes(window?.end)
      if (start === null || end === null || end <= start) continue
      first = first === null ? start : Math.min(first, start)
      last = last === null ? end : Math.max(last, end)
    }
  }
  if (first === null) return { ...OPENING_HOURS, fromTrainers: false }
  return { start: clock(Math.floor(first / 60) * 60), end: clock(Math.min(24 * 60, Math.ceil(last / 60) * 60)), fromTrainers: true }
}

// Day and week views on a laptop: every hour of the studio on one screen, no scrolling.
export const MIN_ROW_PX = 20          // the smallest a half-hour row may be before the grid goes hourly
export const GRID_CHROME_PX = 70      // the calendar's own toolbar and day header, inside the frame (measured: 67px)
export const PAGE_BOTTOM_PX = 16      // what is left under the frame

// 30-minute rows while each one stays at least MIN_ROW_PX tall, otherwise hourly rows (the sessions last one hour and
// start on the hour, so nothing is lost). `frameHeight` is the height of the calendar frame in pixels.
export function slotDurationFor(frameHeight, studio) {
  const hours = Math.max(1, (toMinutes(studio.end) - toMinutes(studio.start)) / 60)
  return (frameHeight - GRID_CHROME_PX) / (hours * 2) >= MIN_ROW_PX ? '00:30:00' : '01:00:00'
}

// 12 colours with good contrast on the dark background. Same list and order as
// PALETTE in backend/admin_calendar.py (the server only accepts these).
export const TRAINER_PALETTE = [
  '#34d399', '#38bdf8', '#f59e0b', '#f472b6', '#a78bfa', '#fb7185',
  '#2dd4bf', '#facc15', '#60a5fa', '#f97316', '#a3e635', '#e879f9'
]

export const NEUTRAL_COLOR = '#9ca3af'      // trial sessions with no trainer yet
export const KINDS = ['all', 'packs', 'trials']
export const MOBILE_QUERY = '(max-width: 767px)'

// FullCalendar runs with timeZone "UTC" and the server sends the studio's wall-clock
// times without an offset, so what is drawn is exactly what is stored. For the
// "now" line and "today" we hand FullCalendar the Madrid wall clock as if it were UTC.
export function madridWallClock(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(now).map(part => [part.type, part.value])
  )
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second))
}

// "2026-10-19T18:00:00" -> a Date whose UTC fields are that wall-clock time
export const wallClock = (text) => {
  const [day, time = '00:00'] = String(text).split('T')
  const [year, month, date] = day.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return new Date(Date.UTC(year, month - 1, date, hour, minute))
}

// "lunes, 19 de octubre, 18:00 - 19:00"
export function describeWhen(start, end, locale) {
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(wallClock(start))
  return `${day}, ${String(start).slice(11, 16)} - ${String(end).slice(11, 16)}`
}

export const dayKey = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
