// Pure helpers of the client's inbox. Tested with: node --test src/utils/

const MADRID = 'Europe/Madrid'

// The wall clock of Europe/Madrid at an instant, as a number (the same fields read as UTC).
function madridWallMs(instantMs) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: MADRID, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(instantMs)).map(part => [part.type, part.value])
  )
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
}

// The server sends moments as Madrid wall-clock text without an offset ("2026-10-21T18:00:00").
// This is the real instant they mean, whatever the time zone of the visitor's device.
export function madridWallToInstant(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text || ''))
  if (!match) return null
  const wall = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +(match[6] || 0))
  let guess = wall
  for (let round = 0; round < 3; round += 1) guess += wall - madridWallMs(guess)
  return new Date(guess)
}

// "hace 2 horas" / "ahora" / "21 oct 2026" in the language of the site.
export function relativeTime(text, now, locale) {
  const instant = madridWallToInstant(text)
  if (!instant) return ''
  const seconds = Math.max(0, Math.round((now.getTime() - instant.getTime()) / 1000))
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (seconds < 45) return formatter.format(0, 'second')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return formatter.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return formatter.format(-hours, 'hour')
  const days = Math.round(hours / 24)
  if (days < 30) return formatter.format(-days, 'day')
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: MADRID }).format(instant)
}

// The full date and time, for the tooltip.
export function fullDate(text, locale) {
  const instant = madridWallToInstant(text)
  if (!instant) return ''
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: MADRID
  }).format(instant)
}

// The number in the badge: nothing for zero, "9+" from ten.
export function badgeText(count) {
  const number = Number(count) || 0
  if (number <= 0) return ''
  return number >= 10 ? '9+' : String(number)
}

// The beginning of a text, on one line.
export function preview(text, limit = 90) {
  const line = String(text || '').replace(/\s+/g, ' ').trim()
  return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line
}

// A message is "long" when it would not fit the first lines of a card.
export function isLong(text) {
  const value = String(text || '')
  return value.length > 280 || value.split('\n').length > 4
}

// What the card says after the client pressed a button (the server's outcome decides the words).
export function resultKey(type, outcome) {
  const answer = String(outcome || '')
  if (answer === 'expired') return 'in_res_expired'
  if (type === 'trial_confirm' || type === 'trial_decline') {
    if (answer.endsWith('confirmed')) return 'in_res_confirmed'
    if (answer.endsWith('declined')) return 'in_res_declined_trial'
    return 'in_res_done_before'
  }
  if (answer === 'accepted') return 'in_res_accepted'
  if (answer === 'declined') return 'in_res_rejected'
  return 'in_res_done_before'
}

// The badge that replaces the buttons once the answer is given. The server says what was answered in `action.result`
// (read from the real session / request, so it is right on any visit); the outcome of this visit is only a fallback,
// and without either a plain "Answered".
export function doneLabelKey(type, outcome) {
  const answer = String(outcome || '')
  if (type === 'trial_confirm' || type === 'trial_decline') {
    if (answer.endsWith('confirmed')) return 'in_done_confirmed'
    if (answer.endsWith('declined')) return 'in_done_declined'
  } else if (answer === 'accepted') return 'in_done_accepted'
  else if (answer === 'declined' || answer === 'rejected') return 'in_done_rejected'
  return 'in_done'
}
