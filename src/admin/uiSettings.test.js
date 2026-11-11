// node --test src/admin/
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDraft, draftProblems, draftToSettings, isDefaultDraft, moveItem, moveToItem, resetItem, resolveCustomizeLabel, resolveMenu,
  overviewBlocks, resolveOverview, resolvePageText, sameDraft, sanitizeSettings, setItemText, setPageText, textProblem, toPayload, toggleHidden, visibleAreas
} from './uiSettings.js'
import { MENU_ITEMS, OVERVIEW_CARDS, PAGES } from './uiRegistry.js'

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
