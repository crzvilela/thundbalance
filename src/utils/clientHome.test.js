import test from 'node:test'
import assert from 'node:assert/strict'
import { countdownOf, countdownText, daysBetween } from './sessionCountdown.js'
import { VISIBLE_PACKS, WARN_DAYS, WARN_SESSIONS, packState, sortPacks, warnText } from './packProgress.js'
import { formatDate, formatDayTime, formatMonthDay } from './sessionDates.js'
import { translations } from '../i18n/translations.js'

// The client's home (docs/CLIENT_HOME): the countdown to the next session, the progress of a pack and the way dates are written.

test('the countdown says today (with the hour), tomorrow or the number of days, on the studio\'s day', () => {
  const at = (iso) => new Date(iso)
  assert.deepEqual(countdownOf({ date: '2026-11-17', time: '10:00:00' }, at('2026-11-17T07:00:00Z')), { kind: 'today', time: '10:00' })
  assert.deepEqual(countdownOf({ date: '2026-11-18', time: '10:00' }, at('2026-11-17T07:00:00Z')), { kind: 'tomorrow' })
  assert.deepEqual(countdownOf({ date: '2026-11-19', time: '10:00' }, at('2026-11-17T07:00:00Z')), { kind: 'days', n: 2 })
  assert.equal(countdownOf({ date: '2026-11-16', time: '10:00' }, at('2026-11-17T07:00:00Z')), null)         // past: nothing to count
  assert.equal(countdownOf(null), null)
  // 23:30 UTC in winter is already the next day in Madrid: "tomorrow" becomes "today"
  assert.equal(countdownOf({ date: '2026-12-02', time: '09:00' }, at('2026-12-01T23:30:00Z')).kind, 'today')
  // the clocks going back (25 hours in the day) do not shift whole days
  assert.equal(daysBetween('2026-10-25', '2026-10-26'), 1)
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2)
})

test('the countdown has a text for every kind', () => {
  assert.deepEqual(countdownText({ kind: 'today', time: '10:00' }), { key: 'ns_today_at', values: { time: '10:00' } })
  assert.deepEqual(countdownText({ kind: 'tomorrow' }), { key: 'ns_tomorrow', values: {} })
  assert.deepEqual(countdownText({ kind: 'days', n: 2 }), { key: 'ns_in_days', values: { n: 2 } })
  assert.equal(countdownText(null), null)
})

const pack = (changes = {}) => ({ id: 1, name: 'Monthly Plan', done: 4, total: 8, remaining: 4, end_date: '2026-12-15', session_type: 'individual', ...changes })

test('a pack shows what is done, what is left, the end date and a percentage', () => {
  const state = packState(pack(), '2026-11-17')
  assert.deepEqual([state.done, state.total, state.remaining, state.percent, state.endDate, state.daysLeft], [4, 8, 4, 50, '2026-12-15', 28])
  assert.equal(state.warn, null)
  assert.equal(packState(pack({ end_date: null }), '2026-11-17').endDate, '')
  assert.equal(packState(pack({ done: 0, total: 0, remaining: 0 }), '2026-11-17').percent, 0)          // no division by zero
  assert.equal(packState(pack({ remaining: undefined }), '2026-11-17').remaining, 4)                    // worked out when the server sends none
  assert.equal(packState(pack({ done: 12, total: 8, remaining: 0 }), '2026-11-17').percent, 100)
})

test('the gentle warning: two sessions left or fewer, or the pack ends in 14 days or fewer', () => {
  assert.equal(WARN_SESSIONS, 2)
  assert.equal(WARN_DAYS, 14)
  assert.deepEqual(packState(pack({ done: 6, remaining: 2 }), '2026-11-17').warn, { kind: 'left', n: 2 })
  assert.deepEqual(packState(pack({ done: 7, remaining: 1 }), '2026-11-17').warn, { kind: 'left', n: 1 })
  assert.deepEqual(packState(pack({ done: 8, remaining: 0 }), '2026-11-17').warn, { kind: 'left', n: 0 })
  assert.equal(packState(pack({ done: 5, remaining: 3 }), '2026-11-17').warn, null)                    // 3 left and a long way to go
  assert.deepEqual(packState(pack({ end_date: '2026-12-01' }), '2026-11-17').warn, { kind: 'end', n: 14 })
  assert.equal(packState(pack({ end_date: '2026-12-02' }), '2026-11-17').warn, null)                    // 15 days: still quiet
  assert.deepEqual(packState(pack({ end_date: '2026-11-17' }), '2026-11-17').warn, { kind: 'end', n: 0 })
  assert.deepEqual(packState(pack({ end_date: '2026-11-10' }), '2026-11-17').warn, { kind: 'ended' })
  assert.equal(packState(pack({ end_date: null }), '2026-11-17').warn, null)                            // no end date: only the sessions count
})

test('every warning has a text', () => {
  assert.deepEqual(warnText({ kind: 'left', n: 2 }), { key: 'pk_warn_left', values: { n: 2 } })
  assert.equal(warnText({ kind: 'left', n: 1 }).key, 'pk_warn_left_one')
  assert.equal(warnText({ kind: 'left', n: 0 }).key, 'pk_warn_none')
  assert.equal(warnText({ kind: 'end', n: 5 }).key, 'pk_warn_end')
  assert.equal(warnText({ kind: 'end', n: 1 }).key, 'pk_warn_end_one')
  assert.equal(warnText({ kind: 'end', n: 0 }).key, 'pk_warn_end_today')
  assert.equal(warnText({ kind: 'ended' }).key, 'pk_warn_ended')
  assert.equal(warnText(null), null)
})

test('the packs are ordered by what ends first, three are shown before "View all"', () => {
  const list = [pack({ id: 1, name: 'B', end_date: '2027-01-10' }), pack({ id: 2, name: 'A', end_date: '2026-12-01' }), pack({ id: 3, name: 'C', end_date: null }), pack({ id: 4, name: 'D', end_date: '2026-12-01', remaining: 1 })]
  assert.deepEqual(sortPacks(list).map(item => item.id), [4, 2, 1, 3])                  // same day: the one with fewer sessions left first; no date: last
  assert.deepEqual(list.map(item => item.id), [1, 2, 3, 4])                             // the list given is not changed
  assert.deepEqual(sortPacks(null), [])
  assert.equal(VISIBLE_PACKS, 3)
})

test('the home writes a session the same short way in the three languages, and the end of a pack without the year', () => {
  assert.equal(formatDayTime('2026-11-20', '10:00:00', 'es-ES'), 'vie 20 nov · 10:00')
  assert.equal(formatDayTime('2026-11-20', '10:00', 'en-GB'), 'Fri 20 Nov · 10:00')
  assert.equal(formatDayTime('2026-11-20', '10:00', 'ca-ES'), 'dv 20 nov · 10:00')
  assert.equal(formatMonthDay('2026-12-15', 'es-ES'), '15 dic')
  assert.equal(formatMonthDay('2026-12-15', 'en-GB'), '15 Dec')
  assert.equal(formatMonthDay('2026-12-15', 'ca-ES'), '15 des')
  assert.match(formatDate('2026-12-15', 'es-ES'), /2026/)
})

test('every text of the home exists in English, Spanish and Catalan with the same {placeholders}', () => {
  const keys = ['dash_hello', 'dash_sub', 'dash_next_title', 'dash_none_title', 'dash_none_text', 'dash_nopack_title', 'dash_nopack_text', 'dash_request_pack', 'dash_try_trial',
    'dash_my_pack', 'dash_my_packs', 'dash_upcoming_empty', 'dash_cal_show', 'dash_cal_hide', 'ns_in_days', 'ns_today_at', 'ns_tomorrow', 'ns_type_individual', 'ns_type_dual', 'ns_view_all',
    'pk_done_left', 'pk_ends', 'pk_progress', 'pk_warn_left', 'pk_warn_left_one', 'pk_warn_none', 'pk_warn_end', 'pk_warn_end_one', 'pk_warn_end_today', 'pk_warn_ended', 'pk_renew', 'pk_show_all', 'pk_show_less']
  const holes = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join()
  for (const key of keys) {
    for (const language of ['en', 'es', 'ca']) assert.ok(translations[language][key], `${key} (${language})`)
    assert.equal(holes(translations.es[key]), holes(translations.en[key]), key)
    assert.equal(holes(translations.ca[key]), holes(translations.en[key]), key)
  }
  assert.equal(translations.es.pk_done_left.replace('{done}', '4').replace('{total}', '8').replace('{left}', '4'), '4 de 8 sesiones realizadas · 4 restantes')
  assert.equal(translations.es.ns_today_at.replace('{time}', '10:00'), 'hoy a las 10:00')
  assert.equal(translations.es.ns_in_days.replace('{n}', '2'), 'en 2 días')
  assert.equal(translations.es.pk_ends.replace('{date}', '15 dic'), 'termina el 15 dic')
})
