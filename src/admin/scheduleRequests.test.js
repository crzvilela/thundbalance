// node --test src/admin/
import test from 'node:test'
import assert from 'node:assert/strict'
import { readParams, shortDate, tabCount, tabOfStatus, statusesOf, timeUntil } from './scheduleRequests.js'

const at = (text) => new Date(`${text}Z`)        // a wall clock written as UTC, like madridWallClock()

test('time left: minutes, hours and days', () => {
  const now = at('2026-10-19T10:00:00')
  assert.deepEqual(timeUntil('2026-10-19', '10:30', now), { unit: 'minute', n: 30 })
  assert.deepEqual(timeUntil('2026-10-19', '15:00', now), { unit: 'hour', n: 5 })
  assert.deepEqual(timeUntil('2026-10-20', '10:00', now), { unit: 'hour', n: 24 })
  assert.deepEqual(timeUntil('2026-10-21', '12:00', now), { unit: 'day', n: 2 })
  assert.deepEqual(timeUntil('2026-10-19', '10:00', now), { past: true })
  assert.deepEqual(timeUntil('2026-10-18', '10:00', now), { past: true })
})

test('tabs group the statuses and count them', () => {
  const counts = { pending: 2, counter_proposed: 1, approved: 3, accepted: 1, rejected: 1, declined: 2, expired: 4 }
  assert.equal(tabCount('pending', counts), 2)
  assert.equal(tabCount('approved', counts), 4)
  assert.equal(tabCount('rejected', counts), 3)
  assert.equal(tabCount('all', counts), 14)
  assert.equal(tabCount('expired', {}), 0)
  assert.equal(tabOfStatus('accepted'), 'approved')
  assert.equal(tabOfStatus('declined'), 'rejected')
  assert.equal(statusesOf('approved'), 'approved,accepted')
  assert.equal(statusesOf('all'), '')
})

test('the URL state is read safely', () => {
  const read = (query) => readParams(new URLSearchParams(query))
  assert.deepEqual(read(''), { tab: 'pending', q: '', trainers: [], request: null, page: 1 })
  assert.deepEqual(read('tab=counter&q=ana&trainers=1,3,x,-2&request=12&page=3'), { tab: 'counter', q: 'ana', trainers: [1, 3], request: 12, page: 3 })
  assert.deepEqual(read('tab=nonsense&request=abc&page=0'), { tab: 'pending', q: '', trainers: [], request: null, page: 1 })
})

test('short dates', () => {
  assert.equal(shortDate('2026-10-21'), '21/10')
})
