// The Pricing section of the landing page: Individual | Dual, three prices each (Monthly, Quarterly, Semiannual), written by hand.
// Nothing here reads the catalogue of packs, a token or a role: the landing is one site for everybody (see backend/landing_pricing.py).
//
//   section.plans   the three text cards (description, button, highlight): the same for Individual and Dual
//   section.prices  { individual: [t0, t1, t2], dual: [t0, t1, t2] }   t = { price, features: [..] }
//                   index 0 Monthly, 1 Quarterly, 2 Semiannual. A text is a plain string or an { en, es, ca } object.
import { resolveText, setTextForLanguage } from './multilingual.js'

export const TYPES = ['individual', 'dual']
export const TIERS = ['monthly', 'quarterly', 'semiannual']
export const PRICE_LIMIT = 60
export const FEATURE_LIMIT = 100
export const MAX_FEATURES = 10

export const blankTier = () => ({ price: '', features: [] })
export const blankPrices = () => ({ individual: TIERS.map(blankTier), dual: TIERS.map(blankTier) })

// The tier to draw: always an object, so an empty or missing one is an empty tier (never a crash, never "nothing").
export const tierOf = (section, type, index) => {
  const tier = section?.prices?.[type]?.[index]
  return tier && typeof tier === 'object' ? tier : blankTier()
}

export const textOf = (value, language) => String(resolveText(value, language) ?? '')

// Writing a text in the form: a field that already holds an { en, es, ca } object changes only the current language.
export const withText = (value, language, text) => (value && typeof value === 'object' ? setTextForLanguage(value, language, text) : text)

// `prices` with one tier changed (the other tiers, and the other type, are untouched).
export function withTier(section, type, index, patch) {
  const base = { ...blankPrices(), ...(section?.prices || {}) }
  const tiers = TIERS.map((_tier, at) => (at === index ? { ...tierOf(section, type, at), ...patch } : tierOf({ prices: base }, type, at)))
  return { ...base, [type]: tiers }
}

// True when at least one tier has a price or a feature (otherwise the page shows its empty state).
export const hasContent = (section, language) => TYPES.some(type => TIERS.some((_tier, index) => {
  const tier = tierOf(section, type, index)
  return textOf(tier.price, language) !== '' || (Array.isArray(tier.features) && tier.features.some(item => textOf(item, language) !== ''))
}))

const allTexts = (value) => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).filter(text => typeof text === 'string') : [])

// '' when fine, otherwise the key of the admin text that explains the problem (the server checks the same limits).
export function textProblem(value, limit) {
  for (const text of allTexts(value)) {
    if (/[<>]/.test(text)) return 'lp_err_html'
    if (text.length > limit) return 'lp_err_len'
  }
  return ''
}

export function featuresProblem(items) {
  const list = Array.isArray(items) ? items : []
  if (list.length > MAX_FEATURES) return 'lp_err_list_max'
  for (const item of list) {
    const problem = textProblem(item, FEATURE_LIMIT)
    if (problem) return problem
  }
  return ''
}

export const tierProblem = (tier) => textProblem(tier?.price, PRICE_LIMIT) || featuresProblem(tier?.features)
