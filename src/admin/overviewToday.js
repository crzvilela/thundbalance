import { adminUrl } from './adminUrl.js'
// The logic of the "Hoy" blocks of the Overview, without React (tested in overviewToday.test.js). The data is the answer of
// GET /admin/overview/today (backend/admin_overview.py): a part the server could not read is null ("unknown"), never 0.

export const MAX_VISIBLE_SESSIONS = 8

// The day in Europe/Madrid as YYYY-MM-DD (the studio's day, whatever the time zone of the browser).
export function madridDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const value = (type) => parts.find(part => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

// "martes, 17 de noviembre" / "Tuesday 17 November": the day written in full. `key` is YYYY-MM-DD; it is formatted as that very day (no zone shifts).
export function fullDate(key, locale) {
  const [year, month, day] = String(key).split('-').map(Number)
  if (!year || !month || !day) return ''
  return new Date(Date.UTC(year, month - 1, day, 12)).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
}

// Where "Sessions today" leads: the calendar on the day view of that day.
export const calendarDayLink = (key) => adminUrl(`/calendar?view=timeGridDay&date=${key}`)

const known = (value) => typeof value === 'number'

// The cards of "What to do today", in order: { key, count, to, labelKey, tone, emptyKey }. `count` is null when the server could not read it.
// The deletion requests card exists only when there is one (it is the only one that is not always there).
export function stripCards(data) {
  if (!data) return []
  const cards = [
    { key: 'requests', count: data.pending_requests ?? null, to: adminUrl('/requests'), labelKey: 'ov_k_requests', tone: 'amber', emptyKey: 'ov_none' },
    { key: 'trials', count: data.pending_trials ?? null, to: adminUrl('/trials'), labelKey: 'ov_k_trials', tone: 'amber', emptyKey: 'ov_none' },
    { key: 'sessions', count: data.sessions_today ? data.sessions_today.total : null, to: calendarDayLink(data.date), labelKey: 'ov_k_sessions', tone: 'emerald', emptyKey: 'ov_sessions_none' },
    { key: 'messages', count: data.unread_messages ?? null, to: adminUrl('/messages'), labelKey: 'ov_k_messages', tone: 'amber', emptyKey: 'ov_none' }
  ]
  if (known(data.pending_deletions) && data.pending_deletions > 0) {
    cards.push({ key: 'deletions', count: data.pending_deletions, to: adminUrl('#deletion-requests'), labelKey: 'ov_k_deletions', tone: 'amber', emptyKey: 'ov_none' })
  }
  return cards
}

// Everything at zero (and nothing unknown): the positive "Todo al día".
export const allClear = (cards) => cards.length > 0 && cards.every(card => card.count === 0)

// The warnings, the most serious first: { key, tone, count?, textKey, linkKey, to, reason? }. Only what is really wrong is listed (an unknown part is not a warning).
// Order: email (clients are not being written to) > deletion requests (the studio owes an answer) > new errors > legal texts > packs about to end.
export function alertsOf(data) {
  if (!data) return []
  const list = []
  if (data.email && data.email.ready === false) list.push({ key: 'email', tone: 'red', textKey: 'ov_a_email', linkKey: 'ov_a_email_open', to: adminUrl('/trials'), reason: data.email.reason || '' })
  if (known(data.pending_deletions) && data.pending_deletions > 0) list.push({ key: 'deletions', tone: 'amber', count: data.pending_deletions, textKey: 'ov_a_deletions', linkKey: 'ov_a_deletions_open', to: adminUrl('#deletion-requests') })
  if (known(data.new_errors) && data.new_errors > 0) list.push({ key: 'errors', tone: 'amber', count: data.new_errors, textKey: 'ov_a_errors', linkKey: 'ov_a_errors_open', to: adminUrl('/system') })
  if (data.legal_needs_attention === true) list.push({ key: 'legal', tone: 'sky', textKey: 'ov_a_legal', linkKey: 'ov_a_legal_open', to: adminUrl('/legal') })
  if (known(data.expiring_packs) && data.expiring_packs > 0) list.push({ key: 'packs', tone: 'sky', count: data.expiring_packs, textKey: 'ov_a_packs', linkKey: 'ov_a_packs_open', to: adminUrl('/clients') })
  return list
}

// The badge of a session of today: the tone and the text key (admin text). Trials use their own words (trial_b_*), sessions ac_st_*.
export function sessionBadge(item) {
  if (item.kind === 'trial') return { tone: { pending: 'amber', approved: 'sky', confirmed: 'emerald' }[item.status] || 'neutral', textKey: `trial_b_${item.status}` }
  return { tone: { booked: 'emerald', completed: 'neutral', rescheduled: 'sky' }[item.status] || 'neutral', textKey: `ac_st_${item.status}` }
}
