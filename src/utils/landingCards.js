// The Pricing section of the landing page: MANUAL cards (section.cards), written by hand in the landing editor. They have no
// link with the catalogue of packs (Admin > Packs): the page never reads the catalogue (see backend/landing_pricing.py).
//
// A card: { id, visible, highlighted, name, price, period, tag, objective, duration, totalSessions, description,
//           benefits: [..], features: [..], buttonText, + the style objects of the texts }
// A text field is a plain string or an { en, es, ca } object (what a double click on the page writes for one language).
import { resolveText, setTextForLanguage } from './multilingual.js'

export const LIMITS = { name: 60, price: 40, period: 60, tag: 60, objective: 200, description: 200, duration: 60, totalSessions: 60, buttonText: 60 }
export const MAX_LIST = 10
export const MAX_ITEM = 100
export const MAX_CARDS = 30

export const cardsOf = (section) => (Array.isArray(section?.cards) ? section.cards.filter(card => card && typeof card === 'object') : [])

// What the page draws: the visible cards with their index in section.cards (the inline editing paths need it).
export const visibleEntries = (section) => cardsOf(section).map((card, index) => ({ card, index })).filter(entry => entry.card.visible !== false)

export const newId = (cards) => {
  const used = new Set(cards.map(card => card.id))
  let id
  do { id = `card-${Math.random().toString(36).slice(2, 9)}` } while (used.has(id))
  return id
}

// A blank card, ready to be filled in.
export const blankCard = (id) => ({
  id, visible: true, highlighted: false, name: '', price: '', period: '', tag: '', objective: '', duration: '', totalSessions: '',
  description: '', benefits: [], features: [], buttonText: '',
})

export function addCard(cards) {
  if (cards.length >= MAX_CARDS) return cards
  return [...cards, blankCard(newId(cards))]
}

export function duplicateCard(cards, index) {
  if (index < 0 || index >= cards.length || cards.length >= MAX_CARDS) return cards
  const copy = { ...JSON.parse(JSON.stringify(cards[index])), id: newId(cards) }
  return [...cards.slice(0, index + 1), copy, ...cards.slice(index + 1)]
}

export const removeCard = (cards, index) => cards.filter((_card, at) => at !== index)
export const setVisible = (cards, index, visible) => cards.map((card, at) => (at === index ? { ...card, visible } : card))
export const patchCard = (cards, index, patch) => cards.map((card, at) => (at === index ? { ...card, ...patch } : card))

// Moves the card at `from` to the place `to` (drag and drop; the up / down buttons use a step of one).
export function reorder(cards, from, to) {
  if (from === to || from < 0 || to < 0 || from >= cards.length || to >= cards.length) return cards
  const next = [...cards]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

// Writing a text in the form: a field that already holds an { en, es, ca } object changes only the current language.
export const withText = (value, language, text) => (value && typeof value === 'object' ? setTextForLanguage(value, language, text) : text)

export const textOf = (value, language) => String(resolveText(value, language) ?? '')

// Every text a field holds (one for a plain string, one per language for an object): the limits apply to all of them.
const allTexts = (value) => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).filter(text => typeof text === 'string') : [])

// '' when fine, otherwise the key of the admin text that explains the problem.
export function textProblem(value, limit) {
  for (const text of allTexts(value)) {
    if (/[<>]/.test(text)) return 'lp_err_html'
    if (text.length > limit) return 'lp_err_len'
  }
  return ''
}

export function listProblem(items) {
  const list = Array.isArray(items) ? items : []
  if (list.length > MAX_LIST) return 'lp_err_list_max'
  for (const item of list) {
    const problem = textProblem(item, MAX_ITEM)
    if (problem) return problem
  }
  return ''
}

// The first problem of a card: { field, key } or null.
export function cardProblem(card) {
  for (const [field, limit] of Object.entries(LIMITS)) {
    const key = textProblem(card?.[field], limit)
    if (key) return { field, key }
  }
  for (const field of ['benefits', 'features']) {
    const key = listProblem(card?.[field])
    if (key) return { field, key }
  }
  return null
}
