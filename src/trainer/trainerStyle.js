// Shared look of the trainer panel (classes and the date text).
export const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'
export const CARD = 'rounded-2xl border border-white/10 bg-white/[0.03]'
export const HEADING_FONT = { fontFamily: "'Bebas Neue', Inter, sans-serif" }

// "2026-10-21" -> "miércoles, 21 de octubre de 2026" (the day as the studio has it, in the reader's language)
export function formatDay(key, locale, options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) {
  const [year, month, day] = key.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)))
}
