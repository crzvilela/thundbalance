// node --test src/admin/
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import {
  pageIsCustomised, blockRows, moveBlock, moveBlockTo, resetPage, resolveBlocks, toggleBlock,
  canEditPanel, draftTextOf, editableView, inlineReduce, limitOfPath, parseKeyPath, performReset, performSave, problemPaths, setDraftText, textOfPath,
  buildDraft, draftProblems, draftToSettings, isDefaultDraft, moveItem, moveToItem, resetItem, resolveCustomizeLabel, resolveMenu,
  overviewBlocks, resolveOverview, resolvePageText, sameDraft, sanitizeSettings, setItemText, setPageText, textProblem, toPayload, toggleHidden, visibleAreas
} from './uiSettings.js'
import { adminText } from './adminText.js'
import { TEXT_ENTRIES, TEXT_KEYS, BLOCKS, EDITABLE_TEXTS, MENU_ITEMS, OVERVIEW_CARDS, PAGES, editableText } from './uiRegistry.js'

// The menu exactly as the panel had it before this existed (AdminLayout.jsx): what nobody who never customised may see changed.
const ORIGINAL_MENU = [
  ['/admin', true, 'overview', 'nav_overview', undefined],
  ['/admin/requests', undefined, 'requests', 'nav_requests', 'requests'],
  ['/admin/trials', undefined, 'whistle', 'nav_trials', 'trials'],
  ['/admin/messages', undefined, 'inbox', 'nav_messages', 'messages'],
  ['/admin/sent-messages', undefined, 'send', 'nav_broadcast', undefined],
  ['/admin/clients', undefined, 'clients', 'nav_clients', undefined],
  ['/admin/calendar', undefined, 'calendar', 'nav_sessions', undefined],
  ['/admin/schedule', undefined, 'refresh', 'nav_schedule', 'schedule'],
  ['/admin/trainers', undefined, 'clock', 'nav_trainers', undefined],
  ['/admin/plans', undefined, 'bolt', 'nav_plans', undefined],
  ['/admin/videos', undefined, 'video', 'nav_videos', undefined],
  ['/admin/landing-editor', undefined, 'landing', 'nav_landing', undefined]
]
const shape = (items) => items.map(item => [item.to, item.end, item.icon, item.labelKey, item.badge])
const keys = (list) => list.map(item => item.key)

test('without a configuration the menu is the original one', () => {
  for (const nothing of [undefined, null, {}, [], 'x', 42, { menu: 'broken' }, { menu: [{ key: 'ghost' }] }]) {
    const menu = resolveMenu(nothing)
    assert.deepEqual(shape(menu), ORIGINAL_MENU)
    assert.ok(menu.every(item => !item.hidden && !item.custom))
  }
  assert.deepEqual(shape(MENU_ITEMS), ORIGINAL_MENU)
})

test('without a configuration the overview, the pages and the button are the original ones', () => {
  assert.deepEqual(keys(resolveOverview({})), ['stat_clients', 'stat_sessions', 'stat_pending', 'week', 'pending', 'business', 'upcoming', 'quick'])
  assert.ok(resolveOverview({}).every(card => !card.hidden && !card.custom))
  assert.deepEqual(resolvePageText({}, 'requests', 'Requests', 'sub'), { title: 'Requests', subtitle: 'sub' })
  assert.deepEqual(resolvePageText({}, 'not-in-the-registry', 'T', 'S'), { title: 'T', subtitle: 'S' })
  assert.equal(resolveCustomizeLabel({}), '')
  assert.equal(PAGES.length, 11)
  assert.equal(OVERVIEW_CARDS.length, 8)
})

test('a configuration orders, renames and hides; the original shows through where it says nothing', () => {
  const menu = resolveMenu({ menu: [{ key: 'clients' }, { key: 'requests', label: 'Pedidos' }, { key: 'videos', hidden: true }] })
  assert.deepEqual(keys(menu).slice(0, 3), ['clients', 'requests', 'videos'])      // the keys it mentions come first, in its order
  assert.equal(menu.find(item => item.key === 'requests').custom, 'Pedidos')
  assert.equal(menu.find(item => item.key === 'videos').hidden, true)
  assert.equal(menu.length, 12)                                                    // nothing is lost: the rest follow in their own order
  assert.deepEqual(keys(menu).slice(3, 6), ['overview', 'trials', 'messages'])
  assert.equal(menu.find(item => item.key === 'messages').custom, '')
})

test('a key the configuration does not know (a new area) goes to the end; keys that no longer exist are ignored', () => {
  const partial = resolveMenu({ menu: [{ key: 'overview' }, { key: 'clients' }, { key: 'gone-area' }] })
  assert.deepEqual(keys(partial).slice(0, 2), ['overview', 'clients'])
  assert.equal(keys(partial).length, 12)
  assert.equal(keys(partial).at(-1), 'landing')
  assert.ok(!keys(partial).includes('gone-area'))
})

test('the protections always hold, whatever is stored', () => {
  const hiddenOverview = resolveMenu({ menu: [{ key: 'overview', hidden: true }] })
  assert.equal(hiddenOverview.find(item => item.key === 'overview').hidden, false)
  const allHidden = resolveMenu({ menu: MENU_ITEMS.map(item => ({ key: item.key, hidden: true })) })
  assert.ok(allHidden.every(item => !item.hidden))                                // fewer than 3 visible: nothing is hidden
  const nine = MENU_ITEMS.filter(item => item.key !== 'overview').slice(0, 9).map(item => ({ key: item.key, hidden: true }))
  assert.equal(visibleAreas(resolveMenu({ menu: nine })), 3)                      // exactly 3 left: the hiding is kept
  assert.equal(resolveMenu({ menu: nine }).filter(item => item.hidden).length, 9)
})

test('names with html, control characters or more than 30 characters are ignored, not shown', () => {
  const menu = resolveMenu({ menu: [
    { key: 'requests', label: '<b>x</b>' }, { key: 'clients', label: 'a\nb' }, { key: 'videos', label: 'x'.repeat(31) }, { key: 'plans', label: '  Mis   packs ' }
  ] })
  const label = (key) => menu.find(item => item.key === key).custom
  assert.deepEqual([label('requests'), label('clients'), label('videos'), label('plans')], ['', '', '', 'Mis packs'])
  assert.equal(textProblem('x'.repeat(31)), 'text_too_long')
  assert.equal(textProblem('a<b'), 'html_not_allowed')
  assert.equal(textProblem('a\tb'), 'control_characters')
  assert.equal(textProblem('x'.repeat(30)), '')
  assert.equal(sanitizeSettings({ version: -3 }).version, 0)
  assert.equal(sanitizeSettings({ version: 'x' }).version, 0)
})

test('repeated keys count once and a damaged value never throws', () => {
  assert.deepEqual(keys(resolveMenu({ menu: [{ key: 'clients' }, { key: 'clients' }] })).filter(key => key === 'clients').length, 1)
  assert.doesNotThrow(() => resolveMenu({ menu: [null, 5, 'x', { key: 5 }, { key: 'clients', label: 7 }] }))
  assert.doesNotThrow(() => resolveOverview({ overview: 'broken' }))
  assert.doesNotThrow(() => resolvePageText({ pages: [] }, 'requests', 'a', 'b'))
})

test('overview cards and page texts', () => {
  const cards = resolveOverview({ overview: [{ key: 'quick', title: 'Atajos' }, { key: 'week', hidden: true }] })
  assert.deepEqual(keys(cards).slice(0, 3), ['quick', 'week', 'stat_clients'])
  assert.equal(cards.find(card => card.key === 'quick').custom, 'Atajos')
  assert.equal(cards.find(card => card.key === 'week').hidden, true)
  const page = { pages: { trials: { title: 'Pruebas', subtitle: '' }, ghost: { title: 'x' } } }
  assert.deepEqual(resolvePageText(page, 'trials', 'Trial sessions', 'orig sub'), { title: 'Pruebas', subtitle: 'orig sub' })
})

test('the draft: reorder with buttons and with drag, "Personalizar panel" stays last', () => {
  const draft = buildDraft({})
  assert.deepEqual(keys(draft.menu), [...MENU_ITEMS.map(item => item.key), 'customize'])
  let menu = moveItem(draft.menu, 'clients', -1)
  assert.equal(keys(menu).indexOf('clients'), keys(draft.menu).indexOf('clients') - 1)
  assert.equal(keys(menu).at(-1), 'customize')
  assert.equal(moveItem(draft.menu, 'overview', -1), draft.menu)                              // the first cannot go up
  assert.equal(moveItem(draft.menu, 'landing', 1), draft.menu)                                // nor the last area go down past the fixed button
  assert.equal(moveItem(draft.menu, 'customize', -1), draft.menu)                             // the button is never moved
  menu = moveToItem(draft.menu, 'videos', 'requests')
  assert.equal(keys(menu).indexOf('videos'), keys(draft.menu).indexOf('requests'))
  assert.equal(keys(menu).length, 13)
  assert.equal(keys(moveToItem(draft.menu, 'requests', 'customize')).length, 13)             // dropping on the button does nothing odd
  assert.equal(moveToItem(draft.menu, 'requests', 'requests'), draft.menu)
})

test('the draft: rename, hide, reset', () => {
  let menu = buildDraft({}).menu
  menu = setItemText(menu, 'requests', 'label', 'Pedidos')
  assert.equal(menu.find(item => item.key === 'requests').label, 'Pedidos')
  assert.equal(setItemText(menu, 'requests', 'label', 'x'.repeat(50)).find(item => item.key === 'requests').label.length, 30)
  const hidden = toggleHidden(menu, 'videos', { isMenu: true })
  assert.equal(hidden.error, null)
  assert.equal(hidden.list.find(item => item.key === 'videos').hidden, true)
  assert.equal(toggleHidden(hidden.list, 'videos', { isMenu: true }).list.find(item => item.key === 'videos').hidden, false)   // shows it again
  assert.equal(toggleHidden(menu, 'overview', { isMenu: true }).error, 'protected')
  assert.equal(toggleHidden(menu, 'customize', { isMenu: true }).error, 'protected')
  const reset = resetItem(hidden.list, 'videos', 'label')
  assert.equal(reset.find(item => item.key === 'videos').hidden, false)
  assert.equal(resetItem(menu, 'requests', 'label').find(item => item.key === 'requests').label, '')
})

test('the draft: the menu cannot go under 3 visible areas', () => {
  let menu = buildDraft({}).menu
  const hideable = MENU_ITEMS.filter(item => !item.protected).map(item => item.key)               // 11 areas besides the Overview
  for (const key of hideable.slice(0, 9)) {
    const step = toggleHidden(menu, key, { isMenu: true })
    assert.equal(step.error, null, key)
    menu = step.list
  }
  assert.equal(visibleAreas(menu), 3)
  const refused = toggleHidden(menu, hideable[9], { isMenu: true })
  assert.equal(refused.error, 'too_few_visible')
  assert.equal(refused.list, menu)                                                                  // unchanged
  assert.deepEqual(draftProblems({ ...buildDraft({}), menu }), [])
  const broken = menu.map(item => ({ ...item, hidden: item.key !== 'overview' }))
  assert.ok(draftProblems({ ...buildDraft({}), menu: broken }).some(problem => problem.code === 'too_few_visible'))
  assert.ok(draftProblems({ ...buildDraft({}), menu: menu.map(item => (item.key === 'overview' ? { ...item, hidden: true } : item)) }).some(problem => problem.code === 'protected_hidden'))
})

test('the draft becomes the payload and the preview; nothing changed means "the original"', () => {
  const original = buildDraft({})
  assert.equal(isDefaultDraft(original), true)
  assert.equal(sameDraft(original, buildDraft({})), true)
  let draft = { ...original, menu: setItemText(original.menu, 'requests', 'label', ' Pedidos ') }
  draft = { ...draft, menu: moveItem(draft.menu, 'clients', -1) }
  draft = { ...draft, menu: toggleHidden(draft.menu, 'videos', { isMenu: true }).list }
  draft = { ...draft, pages: setPageText(draft.pages, 'trials', 'title', 'Pruebas') }
  assert.equal(isDefaultDraft(draft), false)
  assert.equal(sameDraft(draft, original), false)
  const payload = toPayload(draft, 4)
  assert.equal(payload.version, 4)
  assert.deepEqual(payload.menu.find(entry => entry.key === 'requests'), { key: 'requests', label: 'Pedidos' })
  assert.deepEqual(payload.menu.find(entry => entry.key === 'videos'), { key: 'videos', hidden: true })
  assert.deepEqual(payload.pages, { trials: { title: 'Pruebas' } })
  assert.equal(payload.menu.length, 13)
  const preview = draftToSettings(draft)
  assert.equal(resolveMenu(preview).find(item => item.key === 'requests').custom, 'Pedidos')
  // what the server stores comes back to the same draft
  assert.equal(sameDraft(buildDraft(payload), draft), true)
  assert.equal(isDefaultDraft({ ...original, pages: setPageText(original.pages, 'clients', 'subtitle', '   ') }), true)
  assert.equal(isDefaultDraft({ ...original, menu: moveItem(original.menu, 'clients', 1) }), false)           // only the order changed
})

test('page texts are cut at their limits', () => {
  const pages = buildDraft({}).pages
  assert.equal(setPageText(pages, 'trials', 'title', 'x'.repeat(40)).trials.title.length, 30)
  assert.equal(setPageText(pages, 'trials', 'subtitle', 'x'.repeat(200)).trials.subtitle.length, 120)
  assert.ok(draftProblems({ ...buildDraft({}), pages: { ...pages, trials: { title: '<b>', subtitle: '' } } }).some(problem => problem.code === 'html_not_allowed'))
})

test('the overview layout: the original order gives the original rows; a new order flows into rows of 5 columns', () => {
  const original = overviewBlocks(resolveOverview({}))
  assert.deepEqual(keys(original.stats), ['stat_clients', 'stat_sessions', 'stat_pending'])
  assert.deepEqual(original.blocks.map(block => (block.type === 'business' ? 'business' : keys(block.cards))), [['week', 'pending'], 'business', ['upcoming', 'quick']])
  const moved = overviewBlocks(resolveOverview({ overview: [{ key: 'quick' }, { key: 'week' }, { key: 'pending', hidden: true }, { key: 'stat_sessions', hidden: true }] }))
  assert.deepEqual(keys(moved.stats), ['stat_clients', 'stat_pending'])
  assert.deepEqual(moved.blocks.map(block => (block.type === 'business' ? 'business' : keys(block.cards))), [['quick', 'week'], 'business', ['upcoming']])
  const none = overviewBlocks(resolveOverview({ overview: resolveOverview({}).map(card => ({ key: card.key, hidden: true })) }))
  assert.deepEqual([none.stats.length, none.blocks.length], [0, 0])
})

// ---------------------------------------------------------------------------------------------------------------------------------
// Editing on the panel itself: the pure logic behind <Editable>, the edit bar and the menu / Overview controls.

test('only the main admin can edit the panel: a trainer or anybody else never gets edit mode', () => {
  assert.equal(canEditPanel('david@admin.es', 'david@admin.es'), true)
  assert.equal(canEditPanel('  David@Admin.es ', 'david@admin.es'), true)
  assert.equal(canEditPanel('trainer@thundbalance.com', 'david@admin.es'), false)
  assert.equal(canEditPanel('client@x.com', 'david@admin.es'), false)
  assert.equal(canEditPanel('', 'david@admin.es'), false)
  assert.equal(canEditPanel(undefined, 'david@admin.es'), false)
  assert.equal(canEditPanel('david@admin.es', ''), false)                                   // no admin configured: nobody
})

test('outside edit mode (or for somebody who cannot edit) an <Editable> is just the text', () => {
  assert.deepEqual(editableView({ canEdit: true, isEditing: false, custom: '', defaultText: 'Requests' }), { mode: 'plain', text: 'Requests', custom: false })
  assert.deepEqual(editableView({ canEdit: true, isEditing: false, custom: 'Pedidos', defaultText: 'Requests' }), { mode: 'plain', text: 'Pedidos', custom: true })
  assert.equal(editableView({ canEdit: false, isEditing: true, custom: '', defaultText: 'Requests' }).mode, 'plain')      // a trainer: never edit mode
  assert.equal(editableView({ canEdit: true, isEditing: true, custom: '', defaultText: 'Requests' }).mode, 'editing')
})

test('the inline field: Enter keeps the text, Esc drops it, the limit holds, empty puts the original back', () => {
  const options = { max: 10, current: '' }
  const typed = (text) => inlineReduce(inlineReduce({}, { type: 'open' }, options), { type: 'change', text }, options)
  assert.deepEqual(typed('Pedidos'), { open: true, text: 'Pedidos', commit: undefined })
  assert.equal(typed('x'.repeat(40)).text.length, 10)                                          // typing stops at the limit
  const wide = { max: 30, current: '' }
  const wideTyped = inlineReduce(inlineReduce({}, { type: 'open' }, wide), { type: 'change', text: '  Mis   pedidos ' }, wide)
  assert.equal(inlineReduce(wideTyped, { type: 'confirm' }, wide).commit, 'Mis pedidos')   // Enter / leaving the field: trimmed
  assert.equal(inlineReduce(typed('Pedidos'), { type: 'cancel' }, options).commit, undefined)  // Esc: nothing changes
  assert.equal(inlineReduce(typed('Pedidos'), { type: 'cancel' }, options).open, false)
  const custom = { max: 10, current: 'Pedidos' }
  const cleared = inlineReduce(inlineReduce({}, { type: 'open' }, custom), { type: 'change', text: '' }, custom)
  assert.equal(inlineReduce(cleared, { type: 'confirm' }, custom).commit, '')                  // empty = back to the original
  const same = inlineReduce(inlineReduce({}, { type: 'open' }, custom), { type: 'confirm' }, custom)
  assert.equal(same.commit, undefined)                                                         // nothing changed: nothing to keep
  assert.equal(inlineReduce({ open: false, text: '' }, { type: 'confirm' }, options).commit, undefined)       // confirming a closed field does nothing
})

test('every editable text is in the registry with its limit, and a keyPath finds its place in the draft', () => {
  assert.equal(EDITABLE_TEXTS.filter(entry => entry.kind === 'menu').length, MENU_ITEMS.length + 1)           // the areas and the editor button
  assert.equal(EDITABLE_TEXTS.filter(entry => entry.kind === 'overview').length, OVERVIEW_CARDS.length)
  assert.equal(EDITABLE_TEXTS.filter(entry => entry.kind === 'page').length, PAGES.length * 2)
  assert.equal(limitOfPath('menu:requests'), 30)
  assert.equal(limitOfPath('page:trials:title'), 30)
  assert.equal(limitOfPath('page:trials:subtitle'), 120)
  assert.equal(parseKeyPath('menu:requests').group, 'menu')
  assert.deepEqual(parseKeyPath('page:trials:subtitle'), { group: 'page', key: 'trials', field: 'subtitle' })
  assert.equal(parseKeyPath('menu:ghost'), null)
  assert.equal(parseKeyPath('page:trials:colour'), null)
  assert.equal(editableText('overview:week').defaultKey, 'week_title')
  let draft = buildDraft({})
  draft = setDraftText(draft, 'menu:requests', 'Pedidos')
  draft = setDraftText(draft, 'overview:week', 'Semana')
  draft = setDraftText(draft, 'page:trials:title', 'Pruebas')
  draft = setDraftText(draft, 'page:trials:subtitle', 'Sub')
  assert.deepEqual(['menu:requests', 'overview:week', 'page:trials:title', 'page:trials:subtitle'].map(path => draftTextOf(draft, path)), ['Pedidos', 'Semana', 'Pruebas', 'Sub'])
  assert.deepEqual(['menu:requests', 'overview:week', 'page:trials:title'].map(path => textOfPath(draftToSettings(draft), path)), ['Pedidos', 'Semana', 'Pruebas'])
  assert.equal(setDraftText(draft, 'menu:ghost', 'x'), draft)                                  // not in the registry: ignored
  draft = setDraftText(draft, 'menu:requests', '')
  assert.equal(draftTextOf(draft, 'menu:requests'), '')                                        // empty = the original again
  assert.equal(draftTextOf(draft, 'overview:week'), 'Semana')                                  // the others are untouched
})

test('a text with a problem is flagged next to its own field', () => {
  let draft = buildDraft({})
  assert.equal(problemPaths(draft).size, 0)
  draft = setDraftText(draft, 'menu:requests', '<b>x</b>')
  draft = setDraftText(draft, 'page:trials:subtitle', 'ok')
  assert.deepEqual([...problemPaths(draft).entries()], [['menu:requests', 'html_not_allowed']])
})

test('the menu in edit mode: buttons reorder, hidden items stay (dimmed), protected ones cannot be hidden', () => {
  let menu = buildDraft({}).menu
  menu = moveItem(menu, 'trainers', -1)
  menu = moveItem(menu, 'trainers', -1)
  assert.equal(keys(menu).indexOf('trainers'), keys(buildDraft({}).menu).indexOf('trainers') - 2)
  const hidden = toggleHidden(menu, 'videos', { isMenu: true })
  assert.equal(hidden.error, null)
  assert.ok(resolveMenu({ menu: hidden.list }).some(item => item.key === 'videos' && item.hidden))         // still in the list while editing: it can be shown again
  assert.equal(toggleHidden(menu, 'overview', { isMenu: true }).error, 'protected')
  assert.equal(toggleHidden(menu, 'customize', { isMenu: true }).error, 'protected')
})

test('the Overview in edit mode keeps the hidden cards (dimmed) so they can be shown again', () => {
  const cards = resolveOverview({ overview: [{ key: 'quick', hidden: true }, { key: 'week', hidden: true }] })
  const normal = overviewBlocks(cards)
  const editing = overviewBlocks(cards, { showHidden: true })
  assert.ok(!normal.blocks.flatMap(block => (block.cards || [])).some(card => ['quick', 'week'].includes(card.key)))
  assert.equal(editing.blocks.flatMap(block => (block.cards || [])).filter(card => card.hidden).map(card => card.key).sort().join(), 'quick,week')
})

const refused = (code, field) => Object.assign(new Error('refused'), { code, field })

test('saving: 409 and 422 are reported without throwing, a good save returns the new configuration', async () => {
  let draft = setDraftText(buildDraft({}), 'menu:requests', 'Pedidos')
  const saved = sanitizeSettings({ version: 4 })
  const calls = []
  const ok = await performSave({ draft, saved, request: async (method, path, body) => { calls.push([method, path, body.version]); return { ...body, version: 5 } } })
  assert.equal(ok.ok, true)
  assert.deepEqual(calls, [['PUT', '/admin/ui-settings', 4]])                                    // it sends the version it loaded
  assert.equal(ok.saved.version, 5)
  assert.equal(resolveMenu(ok.saved).find(item => item.key === 'requests').custom, 'Pedidos')
  const conflict = await performSave({ draft, saved, request: async () => { throw refused('version_conflict') } })
  assert.deepEqual(conflict, { ok: false, error: { code: 'version_conflict', field: undefined } })
  const html = await performSave({ draft, saved, request: async () => { throw refused('html_not_allowed', 'menu.label') } })
  assert.deepEqual(html, { ok: false, error: { code: 'html_not_allowed', field: 'menu.label' } })
  const network = await performSave({ draft, saved, request: async () => { throw new TypeError('offline') } })
  assert.deepEqual(network, { ok: false, error: { code: '', field: undefined } })
  draft = setDraftText(draft, 'menu:requests', '<b>')
  let asked = 0
  const invalid = await performSave({ draft, saved, request: async () => { asked += 1 } })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error.code, 'html_not_allowed')
  assert.equal(asked, 0)                                                                         // a text that is not valid never reaches the server
})

test('saving the original panel removes the stored configuration; "reset all" does too', async () => {
  const calls = []
  const request = async (method, path) => { calls.push(`${method} ${path}`); return {} }
  const original = await performSave({ draft: buildDraft({}), saved: sanitizeSettings({ version: 3 }), request })
  assert.equal(original.ok, true)
  assert.equal(original.saved.version, 0)
  assert.deepEqual(calls, ['DELETE /admin/ui-settings'])
  calls.length = 0
  await performSave({ draft: buildDraft({}), saved: sanitizeSettings({}), request })
  assert.deepEqual(calls, [])                                                                     // nothing was stored: nothing to remove
  const reset = await performReset({ request })
  assert.equal(reset.ok, true)
  assert.deepEqual(calls, ['DELETE /admin/ui-settings'])
  assert.equal((await performReset({ request: async () => { throw refused('x') } })).ok, false)
})

// ---------------------------------------------------------------------------------------------------------------------------------
// Blocks: whole parts of a page, moved and hidden inside their own group.
const blockKeys = (list) => list.map(block => block.key)
const hiddenKeys = (list) => list.filter(block => block.hidden).map(block => block.key)

test('without a configuration every group of blocks is in its original order and nothing is hidden', () => {
  for (const nothing of [undefined, {}, { menu: [] }, { blocks: 'broken' }, { blocks: { plans: 5 } }, { blocks: [1, 2] }]) {
    for (const page of Object.keys(BLOCKS)) {
      for (const group of Object.keys(BLOCKS[page])) {
        const resolved = resolveBlocks(nothing, page, group)
        assert.deepEqual(blockKeys(resolved), BLOCKS[page][group].map(block => block.key))
        assert.deepEqual(hiddenKeys(resolved), [])
      }
    }
  }
  assert.deepEqual(resolveBlocks({}, 'ghost', 'main'), [])                                     // not in the registry: nothing
  assert.deepEqual(resolveBlocks({}, 'plans', 'ghost'), [])
  assert.equal(Object.keys(BLOCKS).length, 5)                                                    // the five approved pages
  assert.deepEqual(Object.keys(BLOCKS).sort(), ['calendar', 'overview', 'plans', 'schedule', 'trainers'])
})

test('a configuration orders and hides blocks; an old configuration without blocks changes nothing', () => {
  const old = { menu: [{ key: 'clients', label: 'Mis clientes' }], overview: [], pages: {}, version: 3 }
  assert.deepEqual(blockKeys(resolveBlocks(old, 'plans', 'main')), ['on_sale', 'archived', 'trial_prices'])
  const mixed = { ...old, blocks: { plans: { main: [{ key: 'trial_prices' }, { key: 'on_sale' }, { key: 'archived', hidden: true }] } } }
  const resolved = resolveBlocks(mixed, 'plans', 'main')
  assert.deepEqual(blockKeys(resolved), ['trial_prices', 'on_sale', 'archived'])
  assert.deepEqual(hiddenKeys(resolved), ['archived'])
  assert.equal(resolveMenu(mixed).find(item => item.key === 'clients').custom, 'Mis clientes')   // the rest of the old configuration still works
})

test('a block that is not stored (a new one) goes to the end; one that no longer exists is ignored in silence', () => {
  const partial = { blocks: { calendar: { main: [{ key: 'calendar' }, { key: 'gone-block' }, { key: 'filters' }] } } }
  assert.deepEqual(blockKeys(resolveBlocks(partial, 'calendar', 'main')), ['calendar', 'filters', 'legend'])     // 'legend' was not stored: at the end
  const wrongPage = { blocks: { calendar: { main: [{ key: 'on_sale' }] }, ghost: { main: [{ key: 'x' }] } } }      // a block of another page, an unknown page
  assert.deepEqual(blockKeys(resolveBlocks(wrongPage, 'calendar', 'main')), ['filters', 'legend', 'calendar'])
  assert.doesNotThrow(() => sanitizeSettings({ blocks: { plans: { main: [null, 5, 'x', { key: 7 }, { key: 'on_sale', hidden: 'yes' }] } } }))
  assert.deepEqual(blockKeys(resolveBlocks({ blocks: { plans: { main: [{ key: 'archived' }, { key: 'archived' }] } } }, 'plans', 'main')), ['archived', 'on_sale', 'trial_prices'])   // repeated
})

test('the protections always hold: protected blocks are never hidden and a page keeps a visible block, whatever is stored', () => {
  const hiddenProtected = { blocks: { plans: { main: [{ key: 'on_sale', hidden: true }, { key: 'archived', hidden: true }] } } }
  assert.deepEqual(hiddenKeys(resolveBlocks(hiddenProtected, 'plans', 'main')), ['archived'])                  // the protected one stays visible
  const every = { blocks: { overview: { business: BLOCKS.overview.business.map(block => ({ key: block.key, hidden: true })) } } }
  assert.deepEqual(hiddenKeys(resolveBlocks(every, 'overview', 'business')), [])                               // nothing visible: nothing hidden
  const oneLeft = { blocks: { overview: { business: BLOCKS.overview.business.map(block => ({ key: block.key, hidden: block.key !== 'biz_nopack' })) } } }
  assert.deepEqual(hiddenKeys(resolveBlocks(oneLeft, 'overview', 'business')).sort(), ['biz_ending', 'biz_stats', 'biz_trainer'])
})

test('the blocks in edit mode: buttons move them up and down inside the group; the ends do not move', () => {
  let draft = buildDraft({})
  draft = moveBlock(draft, 'plans', 'main', 'trial_prices', -1)
  assert.deepEqual(blockKeys(draft.blocks.plans.main), ['on_sale', 'trial_prices', 'archived'])
  draft = moveBlock(draft, 'plans', 'main', 'trial_prices', -1)
  assert.deepEqual(blockKeys(draft.blocks.plans.main), ['trial_prices', 'on_sale', 'archived'])
  assert.equal(moveBlock(draft, 'plans', 'main', 'trial_prices', -1), draft)                                  // already first
  assert.equal(moveBlock(draft, 'plans', 'main', 'archived', 1), draft)                                       // already last
  assert.equal(moveBlock(draft, 'ghost', 'main', 'x', 1), draft)
  const dragged = moveBlockTo(draft, 'plans', 'main', 'archived', 'trial_prices')
  assert.deepEqual(blockKeys(dragged.blocks.plans.main), ['archived', 'trial_prices', 'on_sale'])
  assert.equal(moveBlockTo(draft, 'plans', 'main', 'archived', 'archived'), draft)
  assert.equal(moveBlockTo(draft, 'plans', 'main', 'archived', 'filters'), draft)                             // a target of another page: ignored
})

test('a block can never be moved to another group or another page', () => {
  BLOCKS.plans.side = [{ key: 'extra', labelKey: 'x' }]                                                         // a second group, only for this test
  try {
    const draft = buildDraft({})
    assert.deepEqual(blockKeys(draft.blocks.plans.side), ['extra'])
    assert.equal(moveBlockTo(draft, 'plans', 'side', 'extra', 'on_sale'), draft)                                // a target of the other group
    assert.equal(moveBlockTo(draft, 'plans', 'main', 'on_sale', 'extra'), draft)
    assert.equal(moveBlockTo(draft, 'plans', 'main', 'extra', 'on_sale'), draft)                                // a block that is not of this group
    assert.equal(moveBlock(draft, 'plans', 'main', 'extra', 1), draft)
    assert.deepEqual(blockKeys(draft.blocks.plans.main), ['on_sale', 'archived', 'trial_prices'])               // untouched
    const stored = resolveBlocks({ blocks: { plans: { side: [{ key: 'on_sale' }], main: [{ key: 'extra' }, { key: 'archived' }] } } }, 'plans', 'main')
    assert.deepEqual(blockKeys(stored), ['archived', 'on_sale', 'trial_prices'])                                // keys of another group are ignored when stored
  } finally {
    delete BLOCKS.plans.side
  }
})

test('hiding blocks: protected ones refuse, the last visible block of a page refuses, the rest hide and show', () => {
  let draft = buildDraft({})
  assert.equal(toggleBlock(draft, 'plans', 'main', 'on_sale').error, 'block_protected')
  assert.equal(toggleBlock(draft, 'calendar', 'main', 'calendar').error, 'block_protected')
  assert.equal(toggleBlock(draft, 'trainers', 'main', 'list').error, 'block_protected')
  assert.equal(toggleBlock(draft, 'trainers', 'main', 'access').error, 'block_protected')
  const hidden = toggleBlock(draft, 'plans', 'main', 'archived')
  assert.equal(hidden.error, null)
  assert.deepEqual(hiddenKeys(hidden.draft.blocks.plans.main), ['archived'])
  assert.equal(toggleBlock(hidden.draft, 'plans', 'main', 'archived').draft.blocks.plans.main.find(block => block.key === 'archived').hidden, false)   // shown again
  for (const key of ['biz_stats', 'biz_ending', 'biz_trainer']) draft = toggleBlock(draft, 'overview', 'business', key).draft
  assert.deepEqual(hiddenKeys(draft.blocks.overview.business), ['biz_stats', 'biz_ending', 'biz_trainer'])
  const last = toggleBlock(draft, 'overview', 'business', 'biz_nopack')
  assert.equal(last.error, 'page_empty')                                                                       // a page is never left empty
  assert.equal(last.draft, draft)
  assert.equal(toggleBlock(draft, 'overview', 'business', 'ghost').error, null)
})

test('the draft with blocks: only the changed groups are sent, and the original means nothing is stored', () => {
  const original = buildDraft({})
  assert.equal(isDefaultDraft(original), true)
  assert.deepEqual(toPayload(original, 0).blocks, {})
  let draft = moveBlock(original, 'calendar', 'main', 'legend', -1)
  draft = toggleBlock(draft, 'plans', 'main', 'trial_prices').draft
  assert.equal(isDefaultDraft(draft), false)
  assert.equal(sameDraft(draft, original), false)
  const payload = toPayload(draft, 7)
  assert.deepEqual(Object.keys(payload.blocks).sort(), ['calendar', 'plans'])                                   // trainers, schedule, overview: nothing to say
  assert.deepEqual(payload.blocks.calendar.main, [{ key: 'legend' }, { key: 'filters' }, { key: 'calendar' }])
  assert.deepEqual(payload.blocks.plans.main, [{ key: 'on_sale' }, { key: 'archived' }, { key: 'trial_prices', hidden: true }])
  assert.equal(sameDraft(buildDraft(payload), draft), true)                                                    // what the server stores comes back to the same draft
  assert.equal(isDefaultDraft(moveBlock(original, 'trainers', 'main', 'note', 1)), false)                       // only the order changed
  assert.deepEqual(draftProblems(draft), [])
  const broken = { ...original, blocks: { ...original.blocks, plans: { main: original.blocks.plans.main.map(block => ({ ...block, hidden: true })) } } }
  const codes = draftProblems(broken).map(problem => problem.code)
  assert.ok(codes.includes('block_protected'))
  assert.ok(codes.includes('page_empty'))                                                                        // and the page would be left with nothing visible
})

test('"Repor página" puts the order and visibility of that page back, and leaves the others alone', () => {
  let draft = buildDraft({})
  draft = moveBlock(draft, 'plans', 'main', 'trial_prices', -2)
  draft = toggleBlock(draft, 'plans', 'main', 'archived').draft
  draft = moveBlock(draft, 'calendar', 'main', 'legend', -1)
  const reset = resetPage(draft, 'plans')
  assert.deepEqual(blockKeys(reset.blocks.plans.main), ['on_sale', 'archived', 'trial_prices'])
  assert.deepEqual(hiddenKeys(reset.blocks.plans.main), [])
  assert.deepEqual(blockKeys(reset.blocks.calendar.main), ['legend', 'filters', 'calendar'])                      // the calendar page is untouched
  assert.equal(resetPage(draft, 'ghost'), draft)
})

test('the Business panel lays its blocks out in rows of 5 columns; reordering flows into new rows', () => {
  const rows = (settings) => blockRows(resolveBlocks(settings, 'overview', 'business').filter(block => !block.hidden)).map(row => blockKeys(row))
  assert.deepEqual(rows({}), [['biz_stats'], ['biz_ending', 'biz_trainer'], ['biz_nopack']])                    // exactly the original layout
  const moved = { blocks: { overview: { business: [{ key: 'biz_nopack' }, { key: 'biz_trainer' }, { key: 'biz_ending' }, { key: 'biz_stats' }] } } }
  assert.deepEqual(rows(moved), [['biz_nopack'], ['biz_trainer', 'biz_ending'], ['biz_stats']])
  const odd = { blocks: { overview: { business: [{ key: 'biz_ending' }, { key: 'biz_stats' }, { key: 'biz_trainer' }, { key: 'biz_nopack' }] } } }
  assert.deepEqual(rows(odd), [['biz_ending'], ['biz_stats'], ['biz_trainer'], ['biz_nopack']])
  assert.deepEqual(rows({ blocks: { overview: { business: [{ key: 'biz_stats', hidden: true }] } } }), [['biz_ending', 'biz_trainer'], ['biz_nopack']])
})

test('a trainer or any other account never gets block editing: only the main admin can edit', () => {
  assert.equal(canEditPanel('trainer@thundbalance.com', 'david@admin.es'), false)
  assert.equal(canEditPanel('david@admin.es', 'david@admin.es'), true)
  assert.equal(editableView({ canEdit: false, isEditing: true, custom: '', defaultText: 'x' }).mode, 'plain')
})

// ---------------------------------------------------------------------------------------------------------------------------------
// Texts inside the pages (section titles, table headers, filters, main buttons, empty-list messages): a closed list.
const adminDir = path.dirname(fileURLToPath(import.meta.url))
const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? sourceFiles(path.join(dir, entry.name))
  : /\.(jsx|js)$/.test(entry.name) && !/\.test\.js$/.test(entry.name) ? [path.join(dir, entry.name)] : []))

test('the closed list: keys are "<page>.<element>", limits are 40 (60 for an empty-list message) and every original fits its limit in ES and EN', () => {
  assert.ok(TEXT_ENTRIES.length >= 150)
  assert.equal(new Set(TEXT_KEYS).size, TEXT_KEYS.length)                                      // no repeated key
  for (const entry of TEXT_ENTRIES) {
    assert.match(entry.key, /^[a-z-]+\.[a-z_]+$/, entry.key)
    assert.ok([40, 60].includes(entry.max), entry.key)
    if (entry.max === 60) assert.match(entry.key, /\.(empty|empty_[a-z]+|pending_empty|upcoming_empty|biz_[a-z]+_empty)$/, entry.key)    // only empty-list messages get 60
    for (const language of ['en', 'es']) {
      const original = adminText[language][entry.defaultKey]
      assert.ok(typeof original === 'string' && original.length > 0, `${language} ${entry.defaultKey}`)
      assert.ok(original.length <= entry.max, `${language} ${entry.key}: ${original.length} > ${entry.max}`)
    }
  }
})

test('what must never be editable is not in the list: errors, states, confirmations, e-mail subjects, form validation', () => {
  const never = [
    'load_error', 'action_error', 'retry', 'tr_err_http', 'tr_health_bad', 'tr_health_hint', 'st_pending', 'st_booked', 'st_cancelled', 'trs_pending', 'trs_confirmed',
    'tr_email_sent', 'tr_email_failed', 'tr_email_none', 'msg_reply_subject', 'cat_err_price', 'tn_invalid', 'vd_required', 'need_trainer_date', 'ps_race_admin',
    'tr_cancel_title', 'tr_cancel_text', 'tr_cancel_do', 'tr_cancel_keep', 'cl_cancel_title', 'cl_cancel_text', 'cl_cancel_do', 'msg_delete_title', 'msg_delete_text',
    'req_archive_title', 'req_archive_text', 'ac_cancel_title', 'ac_cancel_text', 'ac_cancel_yes', 'sch_approve_title', 'sch_approve_text', 'bx_confirm_title', 'tn_remove_title',
    'gs_from_google', 'approved_ok', 'rejected_ok', 'cl_cancelled_ok', 'vd_saved', 'vd_deleted'
  ]
  const used = new Set(TEXT_ENTRIES.map(entry => entry.defaultKey))
  for (const key of never) assert.ok(!used.has(key), key)
  for (const entry of TEXT_ENTRIES) {
    assert.doesNotMatch(entry.defaultKey, /(^|_)(err|error|failed|ok|warning|invalid|required|race|saved|deleted)($|_)/, entry.key)
    assert.doesNotMatch(entry.defaultKey, /^(bk_|cf_|ps_|av_|st_|trs_|req_archive_|req_reason|reject_|approve_|tr_cancel_|cl_cancel_(title|text|do|keep)|msg_delete_|lc_delete_|vd_delete_|tn_remove_|sch_approve|ac_cancel_(title|text|yes))/, entry.key)
  }
  for (const path_ of ['text:requests.load_error', 'text:trials.status_pending', 'text:clients.cancel_confirm', 'text:trials.tr_err_http', 'text:overview.pending_hint_none']) {
    assert.equal(editableText(path_), null)
    assert.equal(parseKeyPath(path_), null)
  }
})

test('every <Txt id> used in the panel is in the list, and every text of the list is used somewhere (the two cannot drift apart)', () => {
  const ids = new Set()
  for (const file of sourceFiles(adminDir)) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/<Txt id="([^"]+)"/g)) ids.add(match[1])
  }
  for (const id of ids) assert.ok(TEXT_KEYS.includes(id), `${id} is used but not registered`)
  for (const key of TEXT_KEYS) assert.ok(ids.has(key), `${key} is registered but not drawn anywhere`)
})

test('a text is stored under its key; an old configuration (no texts) and a new one mix; empty puts the original back', () => {
  const old = { menu: [{ key: 'clients', label: 'Mis clientes' }], overview: [], pages: { trials: { title: 'Pruebas' } }, version: 2 }
  assert.deepEqual(sanitizeSettings(old).texts, {})
  assert.equal(textOfPath(old, 'text:requests.approve'), '')
  const mixed = { ...old, texts: { 'requests.approve': 'Aceptar', 'clients.add_client': 'Nuevo cliente' } }
  assert.equal(textOfPath(mixed, 'text:requests.approve'), 'Aceptar')
  assert.equal(resolveMenu(mixed).find(item => item.key === 'clients').custom, 'Mis clientes')                   // the rest still works
  assert.equal(resolvePageText(mixed, 'trials', 'Trial sessions', 's').title, 'Pruebas')
  let draft = buildDraft(mixed)
  assert.equal(draftTextOf(draft, 'text:requests.approve'), 'Aceptar')
  draft = setDraftText(draft, 'text:requests.approve', '')
  assert.equal(draftTextOf(draft, 'text:requests.approve'), '')                                                   // empty = the original
  assert.deepEqual(Object.keys(toPayload(draft, 1).texts), ['clients.add_client'])                               // only what is customised is sent
  assert.equal(sameDraft(buildDraft(toPayload(draft, 1)), draft), true)
})

test('texts that are not valid, not in the list or too long are ignored in silence, and never break the panel', () => {
  const dirty = { texts: {
    'requests.approve': '<b>x</b>', 'requests.reject': 'a'.repeat(41), 'ghost.nothing': 'x', 'requests.archive': 7, 'requests.unarchive': 'Ok', 'overview.pending_empty': 'z'.repeat(60),
    'overview.biz_end_empty': 'z'.repeat(61)
  } }
  assert.deepEqual(sanitizeSettings(dirty).texts, { 'requests.unarchive': 'Ok', 'overview.pending_empty': 'z'.repeat(60) })
  assert.deepEqual(sanitizeSettings({ texts: 'broken' }).texts, {})
  assert.deepEqual(sanitizeSettings({ texts: [1, 2] }).texts, {})
  assert.doesNotThrow(() => resolveMenu({ texts: null }))
  assert.equal(setDraftText(buildDraft({}), 'text:requests.approve', 'x'.repeat(99)).texts['requests.approve'].length, 40)       // typing stops at the limit
  assert.equal(setDraftText(buildDraft({}), 'text:overview.pending_empty', 'x'.repeat(99)).texts['overview.pending_empty'].length, 60)
  const bad = setDraftText(buildDraft({}), 'text:requests.approve', '<b>')
  assert.deepEqual([...problemPaths(bad).entries()], [['text:requests.approve', 'html_not_allowed']])
  assert.equal(draftProblems(bad)[0].code, 'html_not_allowed')
})

test('"Repor página" puts back every text, the title, the subtitle and the blocks of ONE page and leaves the others', () => {
  let draft = buildDraft({})
  draft = setDraftText(draft, 'text:plans.new_pack', 'Crear pack')
  draft = setDraftText(draft, 'text:plans.edit', 'Cambiar')
  draft = setDraftText(draft, 'text:requests.approve', 'Aceptar')
  draft = setDraftText(draft, 'page:plans:title', 'Mis packs')
  draft = moveBlock(draft, 'plans', 'main', 'trial_prices', -1)
  assert.equal(pageIsCustomised(draft, 'plans'), true)
  assert.equal(pageIsCustomised(draft, 'requests'), true)
  assert.equal(pageIsCustomised(draft, 'videos'), false)
  const reset = resetPage(draft, 'plans')
  assert.equal(draftTextOf(reset, 'text:plans.new_pack'), '')
  assert.equal(draftTextOf(reset, 'text:plans.edit'), '')
  assert.equal(draftTextOf(reset, 'page:plans:title'), '')
  assert.deepEqual(blockKeys(reset.blocks.plans.main), ['on_sale', 'archived', 'trial_prices'])
  assert.equal(draftTextOf(reset, 'text:requests.approve'), 'Aceptar')                                            // another page: untouched
  assert.equal(pageIsCustomised(reset, 'plans'), false)
  assert.equal(isDefaultDraft(resetPage(resetPage(draft, 'plans'), 'requests')), true)
})

test('a saved text appears where it is drawn: the original (ES / EN) otherwise, one name for both languages', () => {
  const settings = { texts: { 'requests.approve': 'Aceptar' } }
  for (const language of ['en', 'es']) {
    const entry = editableText('text:requests.approve')
    const original = adminText[language][entry.defaultKey]
    assert.deepEqual(editableView({ canEdit: true, isEditing: false, custom: textOfPath(settings, entry.path), defaultText: original }), { mode: 'plain', text: 'Aceptar', custom: true })
    assert.equal(editableView({ canEdit: true, isEditing: false, custom: textOfPath({}, entry.path), defaultText: original }).text, original)
  }
})
