import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPendingRequests } from './pendingRequests.js'
import { formatSentAt } from './sessionDates.js'

const sessions = [{ id: 1, status: 'Booked' }, { id: 2, status: 'Booked' }, { id: 3, status: 'Cancelled' }]

test('only the open change requests of live sessions are listed, the studio proposals first', () => {
  const requests = [
    { id: 10, session_id: 1, status: 'pending', created_at: '2026-11-03T10:00:00' },
    { id: 11, session_id: 2, status: 'counter_proposed', created_at: '2026-11-01T09:00:00' },
    { id: 12, session_id: 1, status: 'approved', created_at: '2026-10-01T09:00:00' },
    { id: 13, session_id: 3, status: 'pending', created_at: '2026-11-02T09:00:00' },
    { id: 14, session_id: 99, status: 'pending', created_at: '2026-11-02T09:00:00' }
  ]
  const items = buildPendingRequests({ requests, sessions, isLive: session => session.status !== 'Cancelled' })
  assert.deepEqual(items.map(item => item.key), ['reschedule-11', 'reschedule-10'])
  assert.equal(items[0].counter, true)
})

test('a pack request and an open trial session are listed; a confirmed or missing one is not', () => {
  const pack = { id: 5, package: 'Pack 10', created_at: '2026-11-04T08:00:00' }
  const both = buildPendingRequests({ packRequest: pack, trial: { id: 7, status: 'approved', created_at: '2026-11-02T08:00:00' } })
  assert.deepEqual(both.map(item => item.key), ['pack-5', 'trial-7'])
  assert.deepEqual(buildPendingRequests({ trial: { id: 7, status: 'confirmed' } }), [])
  assert.deepEqual(buildPendingRequests({}), [])
})

test('the sending date is shown in the Madrid day and in the language of the site', () => {
  // 23:30 UTC on 3 November is already 4 November in Madrid
  assert.match(formatSentAt('2026-11-03T23:30:00', 'es-ES'), /4/)
  assert.match(formatSentAt('2026-11-03T23:30:00', 'en-GB'), /4 Nov/)
  assert.equal(formatSentAt('', 'es-ES'), '')
  assert.equal(formatSentAt(null, 'es-ES'), '')
})
