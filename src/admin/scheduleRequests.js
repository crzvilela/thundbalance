import { wallClock } from './calendar/calendarConfig.js'

// Pure helpers of the Schedule page (reschedule requests). Tested with: node --test src/admin/

// The tabs. A request the client accepted counts as "approved" (the session moved); one the client
// declined counts as "rejected" (the session stayed). An empty list means "every status".
export const TABS = [
  { key: 'pending', statuses: ['pending'] },
  { key: 'counter', statuses: ['counter_proposed'] },
  { key: 'approved', statuses: ['approved', 'accepted'] },
  { key: 'rejected', statuses: ['rejected', 'declined'] },
  { key: 'expired', statuses: ['expired'] },
  { key: 'all', statuses: [] }
]

export const STATUS_TONE = {
  pending: 'amber', counter_proposed: 'sky', approved: 'emerald', accepted: 'emerald', rejected: 'red', declined: 'red', expired: 'neutral'
}

export const OPEN = ['pending', 'counter_proposed']

export const tabByKey = (key) => TABS.find(tab => tab.key === key) || TABS[0]
export const tabOfStatus = (status) => (TABS.find(tab => tab.statuses.includes(status)) || TABS[0]).key
export const statusesOf = (key) => tabByKey(key).statuses.join(',')

// How many requests a tab holds, from the per-status counts the server sends.
export function tabCount(key, counts = {}) {
  const tab = tabByKey(key)
  const names = tab.statuses.length ? tab.statuses : Object.keys(counts)
  return names.reduce((total, name) => total + (counts[name] || 0), 0)
}

// ?tab=pending&q=ana&trainers=1,3&request=12&page=2  ->  the page's state. Anything odd falls back to the default.
export function readParams(params) {
  const page = Number.parseInt(params.get('page') || '1', 10)
  const request = Number.parseInt(params.get('request') || '', 10)
  return {
    tab: tabByKey(params.get('tab')).key,
    q: params.get('q') || '',
    trainers: (params.get('trainers') || '').split(',').map(Number).filter(id => Number.isInteger(id) && id > 0),
    request: Number.isInteger(request) && request > 0 ? request : null,
    page: Number.isInteger(page) && page > 0 ? page : 1
  }
}

// The time left until the session starts: { unit: 'minute' | 'hour' | 'day', n } or { past: true }.
// `now` is the Madrid wall clock as a UTC date (madridWallClock) and the session is read the same way.
export function timeUntil(date, time, now) {
  const diff = wallClock(`${String(date).slice(0, 10)}T${String(time).slice(0, 5)}`).getTime() - now.getTime()
  if (!(diff > 0)) return { past: true }
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return { unit: 'minute', n: Math.max(1, minutes) }
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return { unit: 'hour', n: hours }
  return { unit: 'day', n: Math.floor(hours / 24) }
}

// "21/10 a las 18:00" style pieces for the confirmations ("2026-10-21", "18:00")
export function shortDate(date) {
  const [, month, day] = String(date).slice(0, 10).split('-')
  return `${day}/${month}`
}

export const NOTE_MAX = 300       // the server refuses longer notes (reschedule_requests.NOTE_MAX)

// "mié, 21 oct · 18:00" from "2026-10-21", "18:00" (the studio's wall clock, shown as it is stored)
export function formatSlot(date, time, locale) {
  const day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(wallClock(`${date}T00:00`))
  return `${day} · ${time}`
}
