// Packs, prices and session type (Individual | Dual) on the site and in the admin.
//
// The site holds NO price and no list of packs. They come from the server (GET /pricing: the catalogue of packs that are
// on sale, edited in Admin > Packs) and the server works the price out again for every pack, request and trial: what is
// shown here is only a preview.
//   {"packs": [{id, name, session_type, weeks, months, sessions_per_week_options, price_per_session, price_per_pack}],
//    "trial": {"individual": 40, "dual": 50}}

export const SESSION_TYPES = ['individual', 'dual']

export const trialPricePerSession = (prices, type) => prices?.trial?.[type] ?? null

// The packs on sale of one session type, in the order of the catalogue.
export const packsOfType = (prices, type) => (Array.isArray(prices?.packs) ? prices.packs.filter(pack => pack.session_type === type) : [])

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

// What a pack costs for a number of sessions per week: { perSession, sessions, total }. With ONE option of sessions per
// week and a pack price set, that price is the total; otherwise price per session x weeks x sessions (as the server does).
export function packQuote(pack, perWeek) {
  if (!pack) return { perSession: null, sessions: 0, total: null }
  const sessions = pack.weeks * Number(perWeek || 0)
  const single = (pack.sessions_per_week_options || []).length === 1
  const total = single && pack.price_per_pack != null ? Number(pack.price_per_pack) : totalPrice(pack.price_per_session, sessions)
  return { perSession: pack.price_per_session, sessions, total }
}

// 4 weeks = 1 month, 12 = 3, 24 = 6; any other number of weeks has no equivalence (null).
export const EQUIVALENT_MONTHS = { 4: 1, 12: 3, 24: 6 }
export const monthsEquivalent = (weeks) => EQUIVALENT_MONTHS[Number(weeks)] ?? null

// The pack price suggested for ONE option of sessions per week: price per session x weeks x sessions per week.
export function suggestedPackPrice(perSession, weeks, perWeek) {
  const sessions = Number(weeks) * Number(perWeek)
  return perSession === '' || perSession == null || !sessions ? null : totalPrice(Number(perSession), sessions)
}

// True when a pack price differs a lot (more than 15%) from price per session x total sessions: a warning, never a block.
export function packPriceLooksOff(perSession, packPrice, weeks, perWeek) {
  const expected = suggestedPackPrice(perSession, weeks, perWeek)
  if (expected == null || packPrice === '' || packPrice == null || Number(expected) === 0) return false
  return Math.abs(Number(packPrice) - expected) / expected > 0.15
}

// A price typed in a form: a number >= 0 with at most 2 decimals (the server checks it again).
export const isPriceText = (text) => /^\d+([.,]\d{1,2})?$/.test(String(text ?? '').trim())
export const priceFromText = (text) => Number(String(text ?? '').trim().replace(',', '.'))

// The fields every pack / request / trial body carries (an individual one sends no second person at all).
export function sessionTypeBody({ type, name, email }) {
  return type === 'dual'
    ? { session_type: 'dual', second_person_name: String(name || '').trim(), second_person_email: String(email || '').trim().toLowerCase() }
    : { session_type: 'individual' }
}
