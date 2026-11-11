// Pure logic of the panel personalisation (no React, no network): clean a configuration, join it to the registry (falling back to the
// original whenever a key is missing, unknown or invalid), apply the protections, and the draft operations of the editor
// (reorder, rename, hide, reset). Tested in uiSettings.test.js.
//
// A configuration (what the server stores):  { menu: [{ key, label?, hidden? }], overview: [{ key, title?, hidden? }],
//                                              pages: { <pageKey>: { title?, subtitle? } }, version }
// A draft (what the editor holds): the same, but with EVERY key in order and `label` / `title` / `hidden` always present.

import {
  CUSTOMIZE_KEY, LABEL_MAX, MENU_ITEMS, MENU_KEYS, MIN_VISIBLE_AREAS, OVERVIEW_CARDS, OVERVIEW_KEYS, PAGES, PAGE_KEYS,
  PROTECTED_MENU_KEYS, SUBTITLE_MAX
} from './uiRegistry.js'

const AREA_KEYS = MENU_KEYS
export const DEFAULT_MENU_ORDER = [...AREA_KEYS, CUSTOMIZE_KEY]

// ---------------------------------------------------------------------------------------------- texts
const hasControlCharacter = (text) => [...text].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)

// The text trimmed and with runs of spaces collapsed; '' when it is not a text, is too long, or has "<", ">" or a control character.
export function cleanText(value, max = LABEL_MAX) {
  if (typeof value !== 'string' || hasControlCharacter(value) || /[<>]/.test(value)) return ''
  const text = value.replace(/ +/g, ' ').trim()
  return text.length > max ? '' : text
}

// Why a text cannot be saved: '' (fine), 'html_not_allowed', 'control_characters' or 'text_too_long'.
export function textProblem(value, max = LABEL_MAX) {
  const text = String(value ?? '')
  if (hasControlCharacter(text)) return 'control_characters'
  if (/[<>]/.test(text)) return 'html_not_allowed'
  return text.replace(/ +/g, ' ').trim().length > max ? 'text_too_long' : ''
}

// ---------------------------------------------------------------------------------------------- a configuration from anything
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function cleanList(raw, keys, textField) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const result = []
  for (const entry of raw) {
    if (!isObject(entry) || !keys.includes(entry.key) || seen.has(entry.key)) continue      // unknown / repeated keys are ignored
    seen.add(entry.key)
    result.push({ key: entry.key, [textField]: cleanText(entry[textField]), hidden: entry.hidden === true })
  }
  return result
}

// Whatever arrives (the server's answer, an old or damaged value) as a configuration that is safe to use. Never throws.
export function sanitizeSettings(raw) {
  const source = isObject(raw) ? raw : {}
  const pages = {}
  if (isObject(source.pages)) {
    for (const key of PAGE_KEYS) {
      const page = source.pages[key]
      if (!isObject(page)) continue
      const title = cleanText(page.title, LABEL_MAX)
      const subtitle = cleanText(page.subtitle, SUBTITLE_MAX)
      if (title || subtitle) pages[key] = { title, subtitle }
    }
  }
  const version = Number.isInteger(source.version) && source.version >= 0 ? source.version : 0
  return { menu: cleanList(source.menu, MENU_KEYS, 'label'), overview: cleanList(source.overview, OVERVIEW_KEYS, 'title'), pages, version }
}

// The registry keys in the order the configuration gives; keys it does not mention (a new area added later) come after, in their own order.
export function orderKeys(registryKeys, configList) {
  const wanted = configList.map(entry => entry.key).filter(key => registryKeys.includes(key))
  return [...wanted, ...registryKeys.filter(key => !wanted.includes(key))]
}

// ---------------------------------------------------------------------------------------------- what the panel shows
// The menu areas in order: [{ ...registry item, custom: 'Pedidos' | '', hidden }]. A protected area is never hidden and, if the
// configuration would leave fewer than 3 areas, nothing is hidden at all (the menu can never be broken by what is stored).
export function resolveMenu(settings) {
  const config = sanitizeSettings(settings)
  const byKey = new Map(config.menu.map(entry => [entry.key, entry]))
  const items = orderKeys(AREA_KEYS, config.menu).map(key => {
    const item = MENU_ITEMS.find(candidate => candidate.key === key)
    const entry = byKey.get(key)
    return { ...item, custom: entry?.label || '', hidden: !!entry?.hidden && !PROTECTED_MENU_KEYS.includes(key) }
  })
  return items.filter(item => !item.hidden).length < MIN_VISIBLE_AREAS ? items.map(item => ({ ...item, hidden: false })) : items
}

// The custom name of the "Personalizar panel" button ('' = the original text).
export function resolveCustomizeLabel(settings) {
  return sanitizeSettings(settings).menu.find(entry => entry.key === CUSTOMIZE_KEY)?.label || ''
}

// The Overview cards in order: [{ ...registry card, custom, hidden }].
export function resolveOverview(settings) {
  const config = sanitizeSettings(settings)
  const byKey = new Map(config.overview.map(entry => [entry.key, entry]))
  return orderKeys(OVERVIEW_KEYS, config.overview).map(key => {
    const card = OVERVIEW_CARDS.find(candidate => candidate.key === key)
    return { ...card, custom: byKey.get(key)?.title || '', hidden: !!byKey.get(key)?.hidden }
  })
}

// How the Overview is laid out: the visible small cards, and the rest as blocks in order - rows of big cards (at most 5 columns each, in
// the order of the configuration) and the full-width business panel. With the original order this gives exactly the original layout:
// stats = 3 cards; blocks = [row(week, pending), business, row(upcoming, quick)].
export function overviewBlocks(cards) {
  const visible = cards.filter(card => !card.hidden)
  const blocks = []
  let row = []
  let used = 0
  const flush = () => { if (row.length) blocks.push({ type: 'row', cards: row }); row = []; used = 0 }
  for (const card of visible.filter(candidate => candidate.group !== 'stat')) {
    if (card.group === 'business') { flush(); blocks.push({ type: 'business', card }); continue }
    if (used + card.span > 5) flush()
    row.push(card)
    used += card.span
  }
  flush()
  return { stats: visible.filter(card => card.group === 'stat'), blocks }
}

// The title and subtitle of a page: the custom ones, or the originals given (also when the key is not in the registry).
export function resolvePageText(settings, pageKey, defaultTitle, defaultSubtitle) {
  const page = sanitizeSettings(settings).pages[pageKey]
  return { title: page?.title || defaultTitle, subtitle: page?.subtitle || defaultSubtitle }
}

// ---------------------------------------------------------------------------------------------- the draft of the editor
export function buildDraft(settings) {
  const config = sanitizeSettings(settings)
  const byKey = new Map(config.menu.map(entry => [entry.key, entry]))
  const overview = new Map(config.overview.map(entry => [entry.key, entry]))
  return {
    menu: [
      ...orderKeys(AREA_KEYS, config.menu).map(key => ({
        key, label: byKey.get(key)?.label || '', hidden: !!byKey.get(key)?.hidden && !PROTECTED_MENU_KEYS.includes(key)
      })),
      { key: CUSTOMIZE_KEY, label: byKey.get(CUSTOMIZE_KEY)?.label || '', hidden: false }
    ],
    overview: orderKeys(OVERVIEW_KEYS, config.overview).map(key => ({ key, title: overview.get(key)?.title || '', hidden: !!overview.get(key)?.hidden })),
    pages: Object.fromEntries(PAGE_KEYS.map(key => [key, { title: config.pages[key]?.title || '', subtitle: config.pages[key]?.subtitle || '' }])),
    version: config.version
  }
}

// The configuration the panel shows while the draft is being edited (the live preview).
export function draftToSettings(draft) {
  return sanitizeSettings({ menu: draft.menu, overview: draft.overview, pages: draft.pages, version: draft.version })
}

// What is sent to the server: every key in order; texts and `hidden` only where set; empty pages left out.
export function toPayload(draft, version) {
  const entry = (item, field) => ({ key: item.key, ...(item[field] ? { [field]: item[field].replace(/ +/g, ' ').trim() } : {}), ...(item.hidden ? { hidden: true } : {}) })
  const pages = {}
  for (const key of PAGE_KEYS) {
    const page = draft.pages[key] || {}
    const title = String(page.title || '').replace(/ +/g, ' ').trim()
    const subtitle = String(page.subtitle || '').replace(/ +/g, ' ').trim()
    if (title || subtitle) pages[key] = { ...(title ? { title } : {}), ...(subtitle ? { subtitle } : {}) }
  }
  return { menu: draft.menu.map(item => entry(item, 'label')), overview: draft.overview.map(item => entry(item, 'title')), pages, version }
}

// True when nothing differs from the original panel (then there is nothing to keep: the stored configuration is removed).
export function isDefaultDraft(draft) {
  const trimmed = (text) => String(text || '').trim()
  return draft.menu.every((item, index) => item.key === DEFAULT_MENU_ORDER[index] && !trimmed(item.label) && !item.hidden)
    && draft.overview.every((item, index) => item.key === OVERVIEW_KEYS[index] && !trimmed(item.title) && !item.hidden)
    && PAGE_KEYS.every(key => !trimmed(draft.pages[key]?.title) && !trimmed(draft.pages[key]?.subtitle))
}

export const sameDraft = (a, b) => JSON.stringify(toPayload(a, 0)) === JSON.stringify(toPayload(b, 0))

export const visibleAreas = (menu) => menu.filter(item => item.key !== CUSTOMIZE_KEY && !item.hidden).length

// What stops the draft from being saved: [{ code: 'protected_hidden' | 'too_few_visible' | 'html_not_allowed' | 'control_characters' | 'text_too_long', key? }].
export function draftProblems(draft) {
  const problems = []
  for (const item of draft.menu) {
    if (item.hidden && PROTECTED_MENU_KEYS.includes(item.key)) problems.push({ code: 'protected_hidden', key: item.key })
    const problem = textProblem(item.label)
    if (problem) problems.push({ code: problem, key: item.key })
  }
  if (visibleAreas(draft.menu) < MIN_VISIBLE_AREAS) problems.push({ code: 'too_few_visible' })
  for (const item of draft.overview) {
    const problem = textProblem(item.title)
    if (problem) problems.push({ code: problem, key: item.key })
  }
  for (const key of PAGE_KEYS) {
    const page = draft.pages[key] || {}
    const problem = textProblem(page.title, LABEL_MAX) || textProblem(page.subtitle, SUBTITLE_MAX)
    if (problem) problems.push({ code: problem, key })
  }
  return problems
}

// ---- list operations (the menu keeps "Personalizar panel" fixed at the end: it is never moved)
const movable = (list) => list.filter(item => item.key !== CUSTOMIZE_KEY)
const withFixedEnd = (list, ordered) => [...ordered, ...list.filter(item => item.key === CUSTOMIZE_KEY)]

// One place up (delta -1) or down (+1). Out of range changes nothing.
export function moveItem(list, key, delta) {
  const items = movable(list)
  const from = items.findIndex(item => item.key === key)
  const to = from + delta
  if (from < 0 || to < 0 || to >= items.length) return list
  const next = [...items]
  ;[next[from], next[to]] = [next[to], next[from]]
  return withFixedEnd(list, next)
}

// Drag and drop: the item goes where `targetKey` is (before it when coming from below, after it when coming from above).
export function moveToItem(list, key, targetKey) {
  const items = movable(list)
  const from = items.findIndex(item => item.key === key)
  const to = items.findIndex(item => item.key === targetKey)
  if (from < 0 || to < 0 || from === to) return list
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return withFixedEnd(list, next)
}

// The name / title of an item (typing is cut at the limit; the problems are reported when saving).
export const setItemText = (list, key, field, value) =>
  list.map(item => (item.key === key ? { ...item, [field]: String(value ?? '').slice(0, LABEL_MAX) } : item))

// Hides or shows an item. A protected item cannot be hidden, and the menu cannot go under 3 visible areas: { list, error } with
// error 'protected' | 'too_few_visible' | null (and the list unchanged when there is an error).
export function toggleHidden(list, key, { isMenu = false } = {}) {
  const item = list.find(candidate => candidate.key === key)
  if (!item) return { list, error: null }
  if (!item.hidden && isMenu) {
    if (PROTECTED_MENU_KEYS.includes(key)) return { list, error: 'protected' }
    if (visibleAreas(list) - 1 < MIN_VISIBLE_AREAS) return { list, error: 'too_few_visible' }
  }
  return { list: list.map(candidate => (candidate.key === key ? { ...candidate, hidden: !candidate.hidden } : candidate)), error: null }
}

// Back to the original name and visibility of one item (its position is kept: "Repor tudo" resets that too).
export const resetItem = (list, key, field) =>
  list.map(item => (item.key === key ? { ...item, [field]: '', hidden: false } : item))

export const setPageText = (pages, key, field, value) =>
  ({ ...pages, [key]: { ...(pages[key] || { title: '', subtitle: '' }), [field]: String(value ?? '').slice(0, field === 'subtitle' ? SUBTITLE_MAX : LABEL_MAX) } })

export const pageDefaults = (pageKey) => PAGES.find(page => page.key === pageKey)
