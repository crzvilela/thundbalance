// Pure logic of the panel personalisation (no React, no network): clean a configuration, join it to the registry (falling back to the
// original whenever a key is missing, unknown or invalid), apply the protections, and the draft operations of the editor
// (reorder, rename, hide, reset). Tested in uiSettings.test.js.
//
// A configuration (what the server stores):  { menu: [{ key, label?, hidden? }], overview: [{ key, title?, hidden? }],
//                                              pages: { <pageKey>: { title?, subtitle? } }, version }
// A draft (what the editor holds): the same, but with EVERY key in order and `label` / `title` / `hidden` always present.

import {
  BLOCKS, BLOCK_PAGES, CUSTOMIZE_KEY, EDITABLE_TEXTS, LABEL_MAX, TEXT_ENTRIES, TEXT_KEYS, blocksOf, editableText, protectedBlocks, MENU_ITEMS, MENU_KEYS, MIN_VISIBLE_AREAS, OVERVIEW_CARDS, OVERVIEW_KEYS, PAGES, PAGE_KEYS,
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

// The `texts` section: only registered keys, each a clean text within ITS limit; an empty text, a key that no longer exists or a damaged value is
// ignored in silence (the original text is shown).
function cleanTexts(raw) {
  const result = {}
  if (!isObject(raw)) return result
  for (const entry of TEXT_ENTRIES) {
    const text = cleanText(raw[entry.key], entry.max)
    if (text) result[entry.key] = text
  }
  return result
}

// The `blocks` section: only registered pages, groups and blocks (each in its own group), no repeats; anything else (a block that no longer
// exists, a damaged value) is ignored in silence.
function cleanBlocks(raw) {
  const result = {}
  if (!isObject(raw)) return result
  for (const page of BLOCK_PAGES) {
    if (!isObject(raw[page])) continue
    for (const group of Object.keys(BLOCKS[page])) {
      const keys = BLOCKS[page][group].map(block => block.key)
      const list = cleanList(raw[page][group], keys, '_')
      if (list.length) result[page] = { ...(result[page] || {}), [group]: list.map(entry => ({ key: entry.key, hidden: entry.hidden })) }
    }
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
  return { menu: cleanList(source.menu, MENU_KEYS, 'label'), overview: cleanList(source.overview, OVERVIEW_KEYS, 'title'), pages, blocks: cleanBlocks(source.blocks), texts: cleanTexts(source.texts), version }
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
export function overviewBlocks(cards, { showHidden = false } = {}) {
  const visible = showHidden ? cards : cards.filter(card => !card.hidden)      // while editing, hidden cards stay (dimmed) so they can be shown again
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
    blocks: draftBlocksOf(config),
    texts: Object.fromEntries(TEXT_KEYS.map(key => [key, config.texts[key] || ''])),
    version: config.version
  }
}

// The configuration the panel shows while the draft is being edited (the live preview).
export function draftToSettings(draft) {
  return sanitizeSettings({ menu: draft.menu, overview: draft.overview, pages: draft.pages, blocks: draft.blocks, texts: draft.texts, version: draft.version })
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
  return { menu: draft.menu.map(item => entry(item, 'label')), overview: draft.overview.map(item => entry(item, 'title')), pages, blocks: blocksPayload(draft), texts: textsPayload(draft), version }
}

// True when nothing differs from the original panel (then there is nothing to keep: the stored configuration is removed).
export function isDefaultDraft(draft) {
  const trimmed = (text) => String(text || '').trim()
  return draft.menu.every((item, index) => item.key === DEFAULT_MENU_ORDER[index] && !trimmed(item.label) && !item.hidden)
    && draft.overview.every((item, index) => item.key === OVERVIEW_KEYS[index] && !trimmed(item.title) && !item.hidden)
    && PAGE_KEYS.every(key => !trimmed(draft.pages[key]?.title) && !trimmed(draft.pages[key]?.subtitle))
    && Object.keys(blocksPayload(draft)).length === 0
    && Object.keys(textsPayload(draft)).length === 0
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
  for (const entry of TEXT_ENTRIES) {
    const problem = textProblem(draft.texts?.[entry.key], entry.max)
    if (problem) problems.push({ code: problem, key: entry.key })
  }
  for (const page of BLOCK_PAGES) {
    const lists = draft.blocks?.[page] || {}
    const protectedKeys = protectedBlocks(page)
    if (Object.values(lists).flat().some(block => block.hidden && protectedKeys.includes(block.key))) problems.push({ code: 'block_protected', key: page })
    if (pageBlocksVisible(draft, page) === 0) problems.push({ code: 'page_empty', key: page })
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

// ---------------------------------------------------------------------------------------------------------------------------------
// Inline editing on the panel itself (the <Editable> component and the edit bar). Everything that decides something lives here, as pure
// functions over the same draft as the advanced editor, so there is ONE logic and it is tested without a browser.

// Only the studio's main admin can edit the panel: the account of the administrator, never a trainer or a client.
export const canEditPanel = (email, adminEmail) => {
  const own = String(email || '').trim().toLowerCase()
  return own !== '' && own === String(adminEmail || '').trim().toLowerCase()
}

// A keyPath: 'menu:requests' | 'overview:week' | 'page:trials:title' | 'page:trials:subtitle' -> { group, key, field } (null when it is not in the registry).
export function parseKeyPath(path) {
  if (!editableText(path)) return null
  const [group, key, field] = String(path).split(':')
  return { group, key, field: group === 'menu' ? 'label' : group === 'overview' ? 'title' : group === 'text' ? 'text' : field }
}

export const limitOfPath = (path) => editableText(path)?.max ?? LABEL_MAX

// The custom text of a keyPath in a configuration ('' = none: the original is shown).
export function textOfPath(settings, path) {
  const parsed = parseKeyPath(path)
  if (!parsed) return ''
  const config = sanitizeSettings(settings)
  if (parsed.group === 'menu') return config.menu.find(entry => entry.key === parsed.key)?.label || ''
  if (parsed.group === 'overview') return config.overview.find(entry => entry.key === parsed.key)?.title || ''
  if (parsed.group === 'text') return config.texts[parsed.key] || ''
  return config.pages[parsed.key]?.[parsed.field] || ''
}

// The draft with that text set ('' puts the original back for that one item).
export function setDraftText(draft, path, value) {
  const parsed = parseKeyPath(path)
  if (!parsed) return draft
  if (parsed.group === 'menu') return { ...draft, menu: setItemText(draft.menu, parsed.key, 'label', value) }
  if (parsed.group === 'overview') return { ...draft, overview: setItemText(draft.overview, parsed.key, 'title', value) }
  if (parsed.group === 'text') return { ...draft, texts: { ...draft.texts, [parsed.key]: String(value ?? '').slice(0, limitOfPath(path)) } }
  return { ...draft, pages: setPageText(draft.pages, parsed.key, parsed.field, value) }
}

// The text of a keyPath exactly as the draft holds it (what the field shows while editing; '' = original).
export function draftTextOf(draft, path) {
  const parsed = parseKeyPath(path)
  if (!parsed) return ''
  if (parsed.group === 'menu') return draft.menu.find(item => item.key === parsed.key)?.label || ''
  if (parsed.group === 'overview') return draft.overview.find(item => item.key === parsed.key)?.title || ''
  if (parsed.group === 'text') return draft.texts?.[parsed.key] || ''
  return draft.pages[parsed.key]?.[parsed.field] || ''
}

// What is wrong in the draft, by keyPath: Map keyPath -> code (the field shows it next to itself).
export function problemPaths(draft) {
  const found = new Map()
  for (const entry of EDITABLE_TEXTS) {
    const problem = textProblem(draftTextOf(draft, entry.path), entry.max)
    if (problem) found.set(entry.path, problem)
  }
  return found
}

// The little state machine of one inline text field. Actions: open, change(text), confirm, cancel. `current` is the custom text now ('' = original).
// The result is { open, text, commit }: `commit` is undefined while nothing is decided, otherwise the new text to keep ('' = back to the original).
// Enter or leaving the field confirms, Esc cancels, typing stops at `max`, and an empty text puts the original back.
export function inlineReduce(state, action, { max, current = '' }) {
  switch (action.type) {
    case 'open': return { open: true, text: current, commit: undefined }
    case 'change': return { open: true, text: String(action.text ?? '').slice(0, max), commit: undefined }
    case 'cancel': return { open: false, text: current, commit: undefined }
    case 'confirm': {
      if (!state.open) return state
      const text = state.text.replace(/ +/g, ' ').trim()
      return { open: false, text, commit: text === current ? undefined : text }
    }
    default: return state
  }
}

// What an <Editable> draws: plain text with NOTHING extra unless the panel is being edited by someone who can edit it.
export function editableView({ canEdit, isEditing, custom, defaultText }) {
  const text = custom || defaultText
  return { mode: canEdit && isEditing ? 'editing' : 'plain', text, custom: !!custom }
}

// Saves the draft (or removes the stored configuration when the draft is the original panel). `request(method, path, body)` is adminRequest.
// { ok: true, saved } or { ok: false, error: { code, field?, key? } } where `code` is a refusal of the server (409 version_conflict, 422 ...)
// or of the draft itself; nothing is thrown.
export async function performSave({ draft, saved, request }) {
  const problems = draftProblems(draft)
  if (problems.length) return { ok: false, error: { code: problems[0].code, key: problems[0].key } }
  try {
    if (isDefaultDraft(draft)) {
      if (saved.version > 0) await request('DELETE', '/admin/ui-settings')
      return { ok: true, saved: sanitizeSettings({}) }
    }
    return { ok: true, saved: sanitizeSettings(await request('PUT', '/admin/ui-settings', toPayload(draft, saved.version))) }
  } catch (error) {
    return { ok: false, error: { code: error?.code || '', field: error?.field } }
  }
}

// "Repor tudo": removes the stored configuration.
export async function performReset({ request }) {
  try {
    await request('DELETE', '/admin/ui-settings')
    return { ok: true, saved: sanitizeSettings({}) }
  } catch (error) {
    return { ok: false, error: { code: error?.code || '', field: error?.field } }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// BLOCKS (whole parts of a page): order and visibility inside their own group.

// The draft's blocks: every page and group with every block in order: { page: { group: [{ key, hidden }] } }.
function draftBlocksOf(config) {
  const result = {}
  for (const page of BLOCK_PAGES) {
    result[page] = {}
    for (const group of Object.keys(BLOCKS[page])) {
      const registry = BLOCKS[page][group]
      const stored = config.blocks?.[page]?.[group] || []
      const byKey = new Map(stored.map(entry => [entry.key, entry]))
      const protectedKeys = protectedBlocks(page)
      result[page][group] = orderKeys(registry.map(block => block.key), stored).map(key => ({ key, hidden: !!byKey.get(key)?.hidden && !protectedKeys.includes(key) }))
    }
  }
  return result
}

// How many blocks of a page are visible in a draft.
const pageBlocksVisible = (draft, page) => Object.values(draft.blocks?.[page] || {}).flat().filter(block => !block.hidden).length

// What is sent for the blocks: only the groups that differ from the original (a different order or something hidden).
function blocksPayload(draft) {
  const payload = {}
  for (const page of BLOCK_PAGES) {
    for (const group of Object.keys(BLOCKS[page])) {
      const original = BLOCKS[page][group].map(block => block.key)
      const list = draft.blocks?.[page]?.[group] || []
      if (list.some(block => block.hidden) || list.some((block, index) => block.key !== original[index])) {
        payload[page] = { ...(payload[page] || {}), [group]: list.map(block => ({ key: block.key, ...(block.hidden ? { hidden: true } : {}) })) }
      }
    }
  }
  return payload
}

// The blocks of a group in the order to draw them: [{ ...registry block, hidden }], with the original order where nothing is stored, a block
// that is not stored (a new one) at the end, the protected ones never hidden and, if every block of the page would be hidden, none hidden.
export function resolveBlocks(settings, page, group) {
  const registry = blocksOf(page, group)
  if (!registry) return []
  const config = sanitizeSettings(settings)
  const protectedKeys = protectedBlocks(page)
  const stored = config.blocks?.[page]?.[group] || []
  const byKey = new Map(stored.map(entry => [entry.key, entry]))
  const items = orderKeys(registry.map(block => block.key), stored).map(key => ({
    ...registry.find(block => block.key === key), hidden: !!byKey.get(key)?.hidden && !protectedKeys.includes(key)
  }))
  const everyHidden = Object.keys(BLOCKS[page]).flatMap(name => resolveHiddenOf(config, page, name)).every(Boolean)
  return everyHidden ? items.map(block => ({ ...block, hidden: false })) : items
}

// (the hidden flags of one group of a page, for the "page is never empty" rule)
function resolveHiddenOf(config, page, group) {
  const protectedKeys = protectedBlocks(page)
  const stored = config.blocks?.[page]?.[group] || []
  return BLOCKS[page][group].map(block => !!stored.find(entry => entry.key === block.key)?.hidden && !protectedKeys.includes(block.key))
}

// Rows of blocks laid out in 5 columns (for the groups in GRID_GROUPS): consecutive blocks share a row while their spans fit in 5.
export function blockRows(items) {
  const rows = []
  let row = []
  let used = 0
  for (const item of items) {
    const span = item.span || 5
    if (used + span > 5 && row.length) { rows.push(row); row = []; used = 0 }
    row.push(item)
    used += span
  }
  if (row.length) rows.push(row)
  return rows
}

const withBlocks = (draft, page, group, list) => ({ ...draft, blocks: { ...draft.blocks, [page]: { ...draft.blocks[page], [group]: list } } })

// One place up / down inside its own group (out of range changes nothing). A block can never leave its group: there is nothing to move it to.
export function moveBlock(draft, page, group, key, delta) {
  const list = draft.blocks?.[page]?.[group]
  if (!list) return draft
  const next = moveItem(list, key, delta)
  return next === list ? draft : withBlocks(draft, page, group, next)
}

// Drag and drop: only onto a block of the SAME group (anything else is ignored).
export function moveBlockTo(draft, page, group, key, targetKey) {
  const list = draft.blocks?.[page]?.[group]
  if (!list || !list.some(block => block.key === key) || !list.some(block => block.key === targetKey)) return draft
  const next = moveToItem(list, key, targetKey)
  return next === list ? draft : withBlocks(draft, page, group, next)
}

// Hides or shows a block: { draft, error } with error 'block_protected' | 'page_empty' | null (and the draft unchanged when there is an error).
export function toggleBlock(draft, page, group, key) {
  const list = draft.blocks?.[page]?.[group]
  const block = list?.find(candidate => candidate.key === key)
  if (!block) return { draft, error: null }
  if (!block.hidden) {
    if (protectedBlocks(page).includes(key)) return { draft, error: 'block_protected' }
    if (pageBlocksVisible(draft, page) <= 1) return { draft, error: 'page_empty' }
  }
  return { draft: withBlocks(draft, page, group, list.map(candidate => (candidate.key === key ? { ...candidate, hidden: !candidate.hidden } : candidate))), error: null }
}

// "Repor página": the order and visibility of the blocks of that page go back to the original (and, from phase 2, its texts too).
export function resetPage(draft, page) {
  const original = draftBlocksOf({})[page]
  let next = original ? { ...draft, blocks: { ...draft.blocks, [page]: original } } : draft
  const cleared = Object.fromEntries(TEXT_ENTRIES.filter(entry => entry.page === page).map(entry => [entry.key, '']))
  if (Object.keys(cleared).length) next = { ...next, texts: { ...next.texts, ...cleared } }                              // every text of that page
  if (next.pages?.[page]) next = { ...next, pages: { ...next.pages, [page]: { title: '', subtitle: '' } } }               // and its title and subtitle
  return next
}

// What is sent for the texts: only the ones that were changed.
function textsPayload(draft) {
  const payload = {}
  for (const entry of TEXT_ENTRIES) {
    const text = String(draft.texts?.[entry.key] || '').replace(/ +/g, ' ').trim()
    if (text) payload[entry.key] = text
  }
  return payload
}

// Whether the page has anything customised (blocks, texts, title or subtitle): for the "Reset page" button.
export function pageIsCustomised(draft, page) {
  const blocks = draftBlocksOf({})[page]
  const blocksChanged = !!blocks && JSON.stringify(draft.blocks?.[page]) !== JSON.stringify(blocks)
  const texts = TEXT_ENTRIES.some(entry => entry.page === page && String(draft.texts?.[entry.key] || '').trim())
  const header = !!(draft.pages?.[page]?.title?.trim() || draft.pages?.[page]?.subtitle?.trim())
  return blocksChanged || texts || header
}
