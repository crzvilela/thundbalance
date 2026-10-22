// node --test src/trainer/
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addDaysKey, calendarEvents, eventTimes, filterByStatus, groupByDay, hourBars, madridToday, periodRange, rangeProblem, resolveRange, weekdayBars
} from './trainerData.js'

test('today, week (Monday first) and month are worked out from the Madrid day', () => {
  assert.deepEqual(periodRange('today', '2026-10-21'), { from: '2026-10-21', to: '2026-10-21' })
  assert.deepEqual(periodRange('week', '2026-10-21'), { from: '2026-10-19', to: '2026-10-25' })      // Wednesday
  assert.deepEqual(periodRange('week', '2026-10-19'), { from: '2026-10-19', to: '2026-10-25' })      // Monday
  assert.deepEqual(periodRange('week', '2026-10-25'), { from: '2026-10-19', to: '2026-10-25' })      // Sunday
  assert.deepEqual(periodRange('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' })
  assert.deepEqual(periodRange('month', '2028-02-10'), { from: '2028-02-01', to: '2028-02-29' })
  assert.equal(periodRange('custom', '2026-10-21'), null)
  assert.equal(addDaysKey('2026-12-31', 1), '2027-01-01')
})

test('the Madrid day does not follow the browser time zone', () => {
  assert.equal(madridToday(new Date('2026-10-20T22:30:00Z')), '2026-10-21')      // 00:30 in Madrid (summer time)
  assert.equal(madridToday(new Date('2026-12-20T22:30:00Z')), '2026-12-20')      // 23:30 in Madrid (winter time)
})

test('a custom range is checked like the server does', () => {
  assert.equal(rangeProblem('', '2026-01-01'), 'tr_range_missing')
  assert.equal(rangeProblem('2026-02-01', '2026-01-01'), 'tr_range_order')
  assert.equal(rangeProblem('2025-01-01', '2026-03-01'), 'tr_range_long')
  assert.equal(rangeProblem('2026-01-01', '2026-12-31'), null)
  assert.equal(rangeProblem('2026-01-01', '2027-01-01'), null)                      // 366 days (both ends counted) is the most
  assert.equal(rangeProblem('2026-01-01', '2027-01-02'), 'tr_range_long')
  assert.equal(rangeProblem('2026-01-01', '2026-12-31'), null)
  assert.deepEqual(resolveRange({ period: 'custom', from: '2026-01-01', to: '2026-01-05' }), { from: '2026-01-01', to: '2026-01-05' })
  assert.equal(resolveRange({ period: 'custom', from: '2026-01-05', to: '2026-01-01' }), null)
})

test('the list shows the coming days first and the past days after, latest first', () => {
  const rows = [
    { date: '2026-10-18', time: '09:00' }, { date: '2026-10-22', time: '10:00' }, { date: '2026-10-22', time: '09:00' },
    { date: '2026-10-21', time: '11:00' }, { date: '2026-10-15', time: '08:00' }
  ]
  const groups = groupByDay(rows, '2026-10-21')
  assert.deepEqual(groups.map(group => group.date), ['2026-10-21', '2026-10-22', '2026-10-18', '2026-10-15'])
  assert.deepEqual(groups[1].items.map(item => item.time), ['09:00', '10:00'])
})

test('filtering by status', () => {
  const rows = [{ status: 'booked' }, { status: 'completed' }, { status: 'cancelled' }, { status: 'booked' }]
  assert.equal(filterByStatus(rows, 'all').length, 4)
  assert.equal(filterByStatus(rows, 'booked').length, 2)
  assert.equal(filterByStatus(rows, 'cancelled').length, 1)
})

test('chart data fills the empty days and hours', () => {
  const days = weekdayBars([{ weekday: 'Wednesday', count: 4 }, { weekday: 'Monday', count: 1 }])
  assert.deepEqual(days.map(day => day.value), [1, 0, 4, 0, 0, 0, 0])
  assert.equal(days[0].key, 'Monday')
  const hours = hourBars([{ hour: 9, count: 3 }, { hour: 21, count: 1 }])
  assert.equal(hours[0].key, 7)
  assert.equal(hours.at(-1).key, 21)
  assert.equal(hours.find(hour => hour.key === 9).value, 3)
  assert.equal(hourBars([]).length, 14)
})

test('calendar events: sessions with the trainer colour, trials marked, free hours quiet; no contact data anywhere', () => {
  assert.deepEqual(eventTimes('2026-10-21', '09:00'), { start: '2026-10-21T09:00:00', end: '2026-10-21T10:00:00' })
  assert.deepEqual(eventTimes('2026-10-21', '23:00'), { start: '2026-10-21T23:00:00', end: '2026-10-22T00:00:00' })
  const sessions = [
    { session_id: 5, client_display_name: 'Ana Lopez', session_number: '3/12', pack_name: 'Mensual', date: '2026-10-21', time: '09:00', status: 'booked', is_trial: false },
    { session_id: 9, client_display_name: 'Lead Perez', session_number: null, pack_name: 'Trial Session', date: '2026-10-21', time: '11:00', status: 'booked', is_trial: true }
  ]
  const events = calendarEvents(sessions, [{ date: '2026-10-21', time: '10:00' }], '#34d399', { trial: 'Trial', free: 'Libre' })
  assert.deepEqual(events.map(event => event.title), ['3/12 Ana Lopez', 'Trial · Lead Perez', 'Libre'])
  assert.deepEqual(events.map(event => event.extendedProps.kind), ['session', 'trial', 'free'])
  assert.equal(events[0].extendedProps.color, '#34d399')
  assert.equal(events[0].id, 's5')
  assert.equal(events[1].id, 't9')
  assert.doesNotMatch(JSON.stringify(events), /@|email|phone|telefon/i)
})
