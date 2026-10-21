// Pure helpers of the trainer panel (periods, ranges, grouping, chart data, calendar events).
// Tested with: node --test src/trainer/
// Every date is a "YYYY-MM-DD" text in the studio's time (Europe/Madrid); nothing here depends on the browser's time zone.
import { madridWallClock } from '../admin/calendar/calendarConfig.js'

export const PERIODS = ['today', 'week', 'month', 'custom']
export const MAX_RANGE_DAYS = 366
export const STATUSES = ['booked', 'completed', 'cancelled']
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const pad = (n) => String(n).padStart(2, '0')
const utc = (key) => {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}
export const toKey = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
export const addDaysKey = (key, days) => toKey(new Date(utc(key).getTime() + days * 86400000))

// Today in Madrid, as a key
export const madridToday = (now = new Date()) => toKey(madridWallClock(now))

// The first and last day of today | week (Monday to Sunday) | month, in Madrid. `custom` is chosen by the person.
export function periodRange(period, today = madridToday()) {
  if (period === 'today') return { from: today, to: today }
  if (period === 'week') {
    const date = utc(today)
    const monday = addDaysKey(today, -((date.getUTCDay() + 6) % 7))
    return { from: monday, to: addDaysKey(monday, 6) }
  }
  if (period === 'month') {
    const date = utc(today)
    const first = toKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)))
    const last = toKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)))
    return { from: first, to: last }
  }
  return null
}

// null when the range is fine, otherwise the text key of the problem (the server checks the same again)
export function rangeProblem(from, to) {
  if (!from || !to) return 'tr_range_missing'
  if (from > to) return 'tr_range_order'
  if ((utc(to) - utc(from)) / 86400000 + 1 > MAX_RANGE_DAYS) return 'tr_range_long'
  return null
}

// What the page asks for: { period, from, to } -> the actual range (or null while a custom range is incomplete or wrong)
export function resolveRange({ period, from, to }, today = madridToday()) {
  if (period === 'custom') return rangeProblem(from, to) ? null : { from, to }
  return periodRange(period, today)
}

// "2026-10-19" + "18:00" -> a sortable text
const stamp = (item) => `${item.date} ${item.time}`

// Sessions grouped by day: the days from today on (soonest first), then the past days (latest first).
export function groupByDay(sessions, today = madridToday()) {
  const days = new Map()
  for (const item of sessions) {
    if (!days.has(item.date)) days.set(item.date, [])
    days.get(item.date).push(item)
  }
  const groups = [...days.entries()].map(([date, items]) => ({ date, items: items.sort((a, b) => stamp(a).localeCompare(stamp(b))) }))
  const upcoming = groups.filter(group => group.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const past = groups.filter(group => group.date < today).sort((a, b) => b.date.localeCompare(a.date))
  return [...upcoming, ...past]
}

export const filterByStatus = (sessions, status) => (status === 'all' ? sessions : sessions.filter(item => item.status === status))

// Seven columns, Monday first, with 0 for the days that have no sessions: [{ key, value }]
export function weekdayBars(busiest = []) {
  const counts = Object.fromEntries(busiest.map(item => [item.weekday, item.count]))
  return WEEKDAYS.map(key => ({ key, value: counts[key] || 0 }))
}

// One column per hour from the earliest to the latest of the studio's day (at least 07:00-20:00): [{ key: 9, value }]
export function hourBars(busiest = [], minHour = 7, maxHour = 20) {
  const counts = Object.fromEntries(busiest.map(item => [item.hour, item.count]))
  const hours = Object.keys(counts).map(Number)
  const first = Math.min(minHour, ...hours)
  const last = Math.max(maxHour, ...hours)
  return Array.from({ length: last - first + 1 }, (_, index) => ({ key: first + index, value: counts[first + index] || 0 }))
}

// "2026-10-19" + "09:00" -> "2026-10-19T09:00:00" and one hour later (the session lasts one hour)
export function eventTimes(date, time) {
  const hour = Number(time.slice(0, 2))
  const start = `${date}T${time.slice(0, 5)}:00`
  const end = hour >= 23 ? `${addDaysKey(date, 1)}T00:00:00` : `${date}T${pad(hour + 1)}:${time.slice(3, 5)}:00`
  return { start, end }
}

// The FullCalendar events of the panel: the trainer's sessions and trials, and the free hours as quiet blocks.
// `text` gives the labels already in the reader's language: { trial, free }.
export function calendarEvents(sessions, freeSlots, color, text) {
  const events = sessions.map(item => ({
    id: `${item.is_trial ? 't' : 's'}${item.session_id}`,
    title: item.is_trial ? `${text.trial} · ${item.client_display_name}` : `${item.session_number ? `${item.session_number} ` : ''}${item.client_display_name}`,
    ...eventTimes(item.date, item.time),
    extendedProps: { kind: item.is_trial ? 'trial' : 'session', status: item.status, session: item, color }
  }))
  const free = freeSlots.map(slot => ({
    id: `f${slot.date}${slot.time}`,
    title: text.free,
    ...eventTimes(slot.date, slot.time),
    extendedProps: { kind: 'free', status: 'free', color }
  }))
  return [...events, ...free]
}

// Everything the person may see about a session: nothing else is ever drawn.
export const SESSION_FIELDS = ['session_id', 'client_display_name', 'session_number', 'pack_name', 'date', 'time', 'status', 'is_trial']
