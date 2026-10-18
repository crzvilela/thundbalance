// Settings and small helpers of the admin calendar.

// The visible hours of the day (the studio opens roughly 07:00 to 21:00). Change them here.
export const OPENING_HOURS = { start: '07:00:00', end: '21:00:00' }

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
