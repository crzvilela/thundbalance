import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_VISIBLE_SESSIONS, allClear, alertsOf, calendarDayLink, fullDate, madridDateKey, sessionBadge, stripCards } from './overviewToday.js'
import { adminText } from './adminText.js'

// The logic of the "Hoy" blocks of the Overview (docs/ADMIN_UI_SETTINGS.md, "Overview").
const data = (changes = {}) => ({
  date: '2026-11-17', sessions_today: { total: 0, items: [] }, pending_requests: 0, pending_trials: 0, unread_messages: 0, pending_deletions: 0,
  expiring_packs: 0, email: { ready: true, reason: '' }, new_errors: 0, legal_needs_attention: false, ...changes
})

test('the day is the studio\'s day in Europe/Madrid, whatever the time zone of the browser', () => {
  assert.equal(madridDateKey(new Date('2026-07-01T22:30:00Z')), '2026-07-02')       // summer: already the 2nd in Madrid
  assert.equal(madridDateKey(new Date('2026-12-01T22:30:00Z')), '2026-12-01')       // winter: still the 1st
  assert.equal(madridDateKey(new Date('2026-12-01T23:30:00Z')), '2026-12-02')
})

test('the date is written in full, in each language', () => {
  assert.equal(fullDate('2026-11-17', 'es-ES'), 'martes, 17 de noviembre')
  assert.match(fullDate('2026-11-17', 'en-GB'), /^Tuesday,? 17 November$/)
  assert.equal(fullDate('', 'es-ES'), '')
  assert.equal(fullDate('nonsense', 'es-ES'), '')
})

test('"What to do today" has the four cards, each leading where it is solved; the deletion card only exists when there is one', () => {
  const cards = stripCards(data({ pending_requests: 3, pending_trials: 1, unread_messages: 2, sessions_today: { total: 4, items: [] } }))
  assert.deepEqual(cards.map(card => [card.key, card.count, card.to]), [
    ['requests', 3, '/admin/requests'], ['trials', 1, '/admin/trials'], ['sessions', 4, '/admin/calendar?view=timeGridDay&date=2026-11-17'], ['messages', 2, '/admin/messages']
  ])
  assert.equal(calendarDayLink('2026-11-17'), '/admin/calendar?view=timeGridDay&date=2026-11-17')
  const withDeletion = stripCards(data({ pending_deletions: 1 }))
  assert.deepEqual(withDeletion.map(card => card.key), ['requests', 'trials', 'sessions', 'messages', 'deletions'])
  assert.equal(withDeletion.at(-1).to, '/admin#deletion-requests')
  assert.deepEqual(stripCards(null), [])
})

test('everything at zero is "all up to date"; one thing pending or an unknown part is not', () => {
  assert.equal(allClear(stripCards(data())), true)
  assert.equal(allClear(stripCards(data({ pending_requests: 1 }))), false)
  assert.equal(allClear(stripCards(data({ sessions_today: { total: 2, items: [] } }))), false)
  assert.equal(allClear(stripCards(data({ unread_messages: null }))), false)             // the server could not read it: not "all clear"
  assert.equal(allClear([]), false)
  assert.equal(stripCards(data({ unread_messages: null })).find(card => card.key === 'messages').count, null)
})

test('the warnings: none when all is well, only what is really wrong, the most serious first', () => {
  assert.deepEqual(alertsOf(data()), [])
  assert.deepEqual(alertsOf(null), [])
  assert.deepEqual(alertsOf(data({ new_errors: null, expiring_packs: null, email: null, legal_needs_attention: null, pending_deletions: null })), [])      // unknown is not a warning
  const all = alertsOf(data({ email: { ready: false, reason: 'unauthorized' }, pending_deletions: 2, new_errors: 3, legal_needs_attention: true, expiring_packs: 4 }))
  assert.deepEqual(all.map(alert => alert.key), ['email', 'deletions', 'errors', 'legal', 'packs'])
  assert.equal(all[0].tone, 'red')
  assert.equal(all[0].reason, 'unauthorized')
  assert.deepEqual(all.map(alert => alert.to), ['/admin/trials', '/admin#deletion-requests', '/admin/system', '/admin/legal', '/admin/clients'])
  assert.deepEqual(all.filter(alert => alert.count).map(alert => [alert.key, alert.count]), [['deletions', 2], ['errors', 3], ['packs', 4]])
})

test('a session of today has the badge of its status: trials with their own words', () => {
  assert.deepEqual(sessionBadge({ kind: 'trial', status: 'pending' }), { tone: 'amber', textKey: 'trial_b_pending' })
  assert.deepEqual(sessionBadge({ kind: 'trial', status: 'confirmed' }), { tone: 'emerald', textKey: 'trial_b_confirmed' })
  assert.deepEqual(sessionBadge({ kind: 'session', status: 'booked' }), { tone: 'emerald', textKey: 'ac_st_booked' })
  assert.equal(sessionBadge({ kind: 'session', status: 'something-new' }).tone, 'neutral')
  assert.equal(MAX_VISIBLE_SESSIONS, 8)
})

test('every text of the Hoy blocks exists in Spanish and English, and the keys the code uses are all there', () => {
  const used = ['ov_page_title', 'ov_date_hint', 'ov_strip_title', 'ov_today_title', 'ov_alerts_title', 'ov_k_requests', 'ov_k_trials', 'ov_k_sessions', 'ov_k_messages', 'ov_k_deletions',
    'ov_none', 'ov_sessions_none', 'ov_all_clear', 'ov_all_clear_sub', 'ov_no_sessions', 'ov_no_sessions_sub', 'ov_see_all', 'ov_more', 'ov_sessions_aria', 'ov_strip_aria', 'ov_unknown',
    'ov_alerts_ok', 'ov_alerts_show', 'ov_alerts_hide', 'ov_a_email', 'ov_a_email_open', 'ov_a_errors', 'ov_a_errors_open', 'ov_a_legal', 'ov_a_legal_open', 'ov_a_packs', 'ov_a_packs_open',
    'ov_a_deletions', 'ov_a_deletions_open', 'ov_load_error', 'ov_deletions_hint', 'nav_group_today', 'nav_group_people', 'nav_group_agenda', 'nav_group_offer', 'nav_group_system',
    'ui_warn_card_protected', 'ui_err_card_protected']
  for (const key of used) for (const language of ['en', 'es']) assert.ok(adminText[language][key], `${key} (${language})`)
  assert.equal(adminText.es.ov_strip_title, 'Qué hacer hoy')
  assert.equal(adminText.es.ov_none, 'Sin pendientes')
  assert.equal(adminText.es.ov_all_clear, 'Todo al día')
  assert.equal(adminText.es.ov_no_sessions, 'Hoy no hay sesiones')
  assert.equal(adminText.es.ov_alerts_ok, 'Todo en orden')
  assert.equal(adminText.es.ov_page_title, 'Hoy')
  assert.equal(adminText.en.ov_page_title, 'Today')
  assert.match(adminText.es.ov_a_errors, /\{n\}/)
})
