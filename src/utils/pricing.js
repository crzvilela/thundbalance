// Prices and session type (Individual | Dual) on the site and in the admin.
//
// The site holds NO price. They come from the server (GET /pricing, the `pricing` table, one source) and the server
// works out the price again for every pack, request and trial: what is shown here is only a preview.
//   {"packs": {"individual": {"1": 65, ...}, "dual": {...}}, "trial": {"individual": 40, "dual": 50}, "months": [1, 3, 6]}

export const SESSION_TYPES = ['individual', 'dual']

export const packPricePerSession = (prices, type, months) => prices?.packs?.[type]?.[String(months)] ?? null
export const trialPricePerSession = (prices, type) => prices?.trial?.[type] ?? null

// price per session x number of sessions, without float noise (65.1 x 3)
export function totalPrice(perSession, sessions) {
  if (perSession == null || !sessions) return null
  return Math.round(Number(perSession) * Number(sessions) * 100) / 100
}

// 60 -> "€60", 62.5 -> "€62.50"
export function formatMoney(value) {
  if (value == null || value === '') return '—'
  const number = Number(value)
  return `€${Number.isInteger(number) ? number : number.toFixed(2)}`
}

// Months of the packs that have a price, ascending (the plans of the home page follow this order).
export const priceMonths = (prices) => (Array.isArray(prices?.months) ? prices.months : [])

// What a pack costs: { perSession, total, sessions } (null when there is no price for that duration yet)
export function packQuote(prices, type, months, sessions) {
  const perSession = packPricePerSession(prices, type, months)
  return { perSession, sessions: sessions || 0, total: totalPrice(perSession, sessions) }
}

// The fields every pack / request / trial body carries (an individual one sends no second person at all).
export function sessionTypeBody({ type, name, email }) {
  return type === 'dual'
    ? { session_type: 'dual', second_person_name: String(name || '').trim(), second_person_email: String(email || '').trim().toLowerCase() }
    : { session_type: 'individual' }
}
