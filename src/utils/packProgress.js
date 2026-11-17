import { daysBetween } from './sessionCountdown.js'

// The progress of a pack as the dashboard and My Sessions show it. Pure (tested in node). The numbers come from the server
// (GET /client/workflow: done, remaining, total, end_date): nothing is invented here, only arranged.

export const WARN_SESSIONS = 2        // "only 2 sessions left" or fewer
export const WARN_DAYS = 14           // the pack ends in 14 days or fewer
export const VISIBLE_PACKS = 3        // blocks shown before "View all"

const whole = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0)

// { done, total, remaining, percent, endDate, daysLeft, warn } where warn is null | { kind: 'left', n } | { kind: 'ended' } | { kind: 'end', n }.
// The warning is gentle: few sessions left, or the end date close. `todayKey` is the studio's day ('YYYY-MM-DD').
export function packState(pack, todayKey) {
  const total = whole(pack?.total)
  const done = Math.min(whole(pack?.done), total || whole(pack?.done))
  const remaining = pack?.remaining === undefined || pack?.remaining === null ? Math.max(0, total - done) : whole(pack.remaining)
  const endDate = pack?.end_date ? String(pack.end_date).slice(0, 10) : ''
  const daysLeft = endDate && todayKey ? daysBetween(todayKey, endDate) : null
  let warn = null
  if (total > 0 && remaining <= WARN_SESSIONS) warn = { kind: 'left', n: remaining }
  else if (daysLeft !== null && daysLeft < 0) warn = { kind: 'ended' }
  else if (daysLeft !== null && daysLeft <= WARN_DAYS) warn = { kind: 'end', n: daysLeft }
  return { done, total, remaining, percent: total ? Math.min(100, Math.round((done / total) * 100)) : 0, endDate, daysLeft, warn }
}

// The text key and values of a warning for t().
export function warnText(warn) {
  if (!warn) return null
  if (warn.kind === 'ended') return { key: 'pk_warn_ended', values: {} }
  if (warn.kind === 'left') return { key: warn.n === 0 ? 'pk_warn_none' : warn.n === 1 ? 'pk_warn_left_one' : 'pk_warn_left', values: { n: warn.n } }
  return { key: warn.n === 0 ? 'pk_warn_end_today' : warn.n === 1 ? 'pk_warn_end_one' : 'pk_warn_end', values: { n: warn.n } }
}

// The packs ordered by what ends first (no end date: last, then the fewest sessions left first). Does not change the list given.
export function sortPacks(packs) {
  return [...(packs || [])].sort((a, b) => {
    const left = a?.end_date ? String(a.end_date).slice(0, 10) : '9999-12-31'
    const right = b?.end_date ? String(b.end_date).slice(0, 10) : '9999-12-31'
    return left.localeCompare(right) || whole(a?.remaining) - whole(b?.remaining) || String(a?.name || '').localeCompare(String(b?.name || ''))
  })
}
