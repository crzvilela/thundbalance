import { formatTime, madridNow } from './sessionDates.js'

// How far away the next session is, written for a person: "today at 10:00", "tomorrow", "in 2 days". Pure (tested in node).
// The day is the studio's day (Europe/Madrid): a client in another time zone sees the same count as the studio.

const utcDay = (key) => {
  const [year, month, day] = String(key).slice(0, 10).split('-').map(Number)
  return Date.UTC(year, month - 1, day, 12)
}

// Whole calendar days from one 'YYYY-MM-DD' to another (negative when it is in the past).
export const daysBetween = (fromKey, toKey) => Math.round((utcDay(toKey) - utcDay(fromKey)) / 86400000)

// { kind: 'today', time } | { kind: 'tomorrow' } | { kind: 'days', n } | null (the session is in the past or has no date)
export function countdownOf(session, now = new Date()) {
  if (!session?.date) return null
  const days = daysBetween(madridNow(now).date, session.date)
  if (days < 0) return null
  if (days === 0) return { kind: 'today', time: formatTime(session.time) }
  if (days === 1) return { kind: 'tomorrow' }
  return { kind: 'days', n: days }
}

// The text key and values of a countdown for t(): ns_today_at / ns_tomorrow / ns_in_days.
export function countdownText(countdown) {
  if (!countdown) return null
  if (countdown.kind === 'today') return { key: 'ns_today_at', values: { time: countdown.time } }
  if (countdown.kind === 'tomorrow') return { key: 'ns_tomorrow', values: {} }
  return { key: 'ns_in_days', values: { n: countdown.n } }
}
