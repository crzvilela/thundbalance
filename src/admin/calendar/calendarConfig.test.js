// node --test src/admin/calendar/
import test from 'node:test'
import assert from 'node:assert/strict'
import { GRID_CHROME_PX, MIN_ROW_PX, STUDIO_END, STUDIO_START, slotDurationFor, studioHours } from './calendarConfig.js'

const week = (start, end) => Object.fromEntries(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, index) => [day, index < 5 ? { start, end } : null]))

test('the studio day is the first start and the last end of all the trainers', () => {
  const trainers = [{ hours: week('07:00', '14:00') }, { hours: week('08:00', '21:00') }, { hours: week('07:00', '21:00') }]
  assert.deepEqual(studioHours(trainers), { start: '07:00:00', end: '21:00:00', fromTrainers: true })
  assert.deepEqual(studioHours([{ hours: week('09:00', '17:00') }]), { start: '09:00:00', end: '17:00:00', fromTrainers: true })
})

test('hours that are not whole are widened to whole hours', () => {
  assert.deepEqual(studioHours([{ hours: { Monday: { start: '07:30', end: '13:15' } } }]), { start: '07:00:00', end: '14:00:00', fromTrainers: true })
})

test('with no hours at all the two constants are used', () => {
  const fallback = { start: `${STUDIO_START}:00`, end: `${STUDIO_END}:00`, fromTrainers: false }
  assert.deepEqual(studioHours([]), fallback)
  assert.deepEqual(studioHours(undefined), fallback)
  assert.deepEqual(studioHours([{ hours: { Monday: null, Tuesday: null } }]), fallback)
  assert.deepEqual(studioHours([{ hours: { Monday: { start: '10:00', end: '10:00' } } }]), fallback)       // an empty window is ignored
})

test('rows stay at half an hour while they are tall enough, and go hourly on a short screen', () => {
  const studio = { start: '07:00:00', end: '21:00:00' }                // 14 hours = 28 half-hour rows
  const needed = GRID_CHROME_PX + 28 * MIN_ROW_PX
  assert.equal(slotDurationFor(needed, studio), '00:30:00')
  assert.equal(slotDurationFor(needed - 1, studio), '01:00:00')
  assert.equal(slotDurationFor(374, studio), '01:00:00')               // a 720px window
  assert.equal(slotDurationFor(1000, studio), '00:30:00')
  assert.equal(slotDurationFor(300, { start: '09:00:00', end: '12:00:00' }), '00:30:00')          // a short day fits half hours
})
