import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultTrainer, fromStored, isComplete, plannedSessions, setTime, setTrainer, staleDays, toBody, toggleDay, trainerNames, trimTo
} from './packSchedule.js'

const A = { id: 1, name: 'Carles' }
const B = { id: 2, name: 'Marta' }
// Monday: 09:00 A+B, 18:00 only B. Wednesday: 09:00 only A, 10:00 A+B.
const availability = {
  weekdays: {
    Monday: [{ time: '09:00', trainers: [A, B] }, { time: '18:00', trainers: [B] }],
    Tuesday: [],
    Wednesday: [{ time: '09:00', trainers: [A] }, { time: '10:00', trainers: [A, B] }]
  }
}

test('a day is added only while there are fewer days than sessions per week, and removed again', () => {
  let entries = toggleDay([], 'Wednesday', 2)
  entries = toggleDay(entries, 'Monday', 2)
  assert.deepEqual(entries.map(entry => entry.weekday), ['Monday', 'Wednesday'])      // week order
  assert.equal(toggleDay(entries, 'Friday', 2), entries)                                // full: nothing added
  assert.deepEqual(toggleDay(entries, 'Monday', 2).map(entry => entry.weekday), ['Wednesday'])
  assert.deepEqual(trimTo(entries, 1).map(entry => entry.weekday), ['Monday'])
})

test('each day has its own hour; the trainer defaults to the same one on every day when free', () => {
  let entries = toggleDay(toggleDay([], 'Monday', 2), 'Wednesday', 2)
  entries = setTime(entries, 'Monday', '09:00', availability)
  assert.equal(entries[0].trainer_id, 1)                                  // the first free one
  entries = setTime(entries, 'Wednesday', '10:00', availability)
  assert.equal(entries[1].trainer_id, 1)                                  // the same trainer as Monday (free then)
  entries = setTime(entries, 'Monday', '18:00', availability)             // only Marta is free Monday 18:00
  assert.equal(entries[0].trainer_id, 2)
  assert.equal(entries[1].time, '10:00')                                  // the other day keeps ITS hour
  entries = setTrainer(entries, 'Wednesday', 2)
  assert.deepEqual(toBody(entries), [
    { weekday: 'Monday', time: '18:00', trainer_id: 2 },
    { weekday: 'Wednesday', time: '10:00', trainer_id: 2 }
  ])
})

test('an optional trainer stays open unless it was chosen', () => {
  const entries = [{ weekday: 'Monday', time: '', trainer_id: '' }]
  assert.equal(defaultTrainer(entries, 'Monday', '09:00', availability, { optional: true }), '')
  assert.equal(isComplete([{ weekday: 'Monday', time: '09:00', trainer_id: '' }], 1, { trainerRequired: false }), true)
  assert.equal(isComplete([{ weekday: 'Monday', time: '09:00', trainer_id: '' }], 1), false)
  assert.deepEqual(toBody([{ weekday: 'Monday', time: '09:00', trainer_id: '' }]), [{ weekday: 'Monday', time: '09:00', trainer_id: null }])
})

test('complete means exactly one entry per weekly session, each with an hour', () => {
  const day = (weekday, time) => ({ weekday, time, trainer_id: 1 })
  assert.equal(isComplete([day('Monday', '09:00')], 2), false)
  assert.equal(isComplete([day('Monday', '09:00'), day('Wednesday', '')], 2), false)
  assert.equal(isComplete([day('Monday', '09:00'), day('Wednesday', '10:00')], 2), true)
})

test('an hour or trainer that stopped being free is reported', () => {
  const entries = [{ weekday: 'Monday', time: '18:00', trainer_id: 1 }, { weekday: 'Wednesday', time: '09:00', trainer_id: 1 }, { weekday: 'Tuesday', time: '09:00', trainer_id: '' }]
  assert.deepEqual(staleDays(entries, availability).sort(), ['Monday', 'Tuesday'])
})

test('an old single-hour row is only read: every day gets that hour and it is marked legacy', () => {
  const old = fromStored({ days: 'Monday,Wednesday', time: '10:00:00', trainerId: 3 })
  assert.equal(old.legacy, true)
  assert.deepEqual(old.entries, [{ weekday: 'Monday', time: '10:00', trainer_id: 3 }, { weekday: 'Wednesday', time: '10:00', trainer_id: 3 }])
  const stored = fromStored({ schedule: [{ weekday: 'Wednesday', time: '09:00', trainer_id: 2 }, { weekday: 'Monday', time: '18:00', trainer_id: 1 }], days: 'x', time: '10:00' })
  assert.equal(stored.legacy, false)
  assert.deepEqual(stored.entries.map(entry => `${entry.weekday} ${entry.time}`), ['Monday 18:00', 'Wednesday 09:00'])
})

test('the planned sessions follow each day\'s hour and trainer, numbered x/y', () => {
  const entries = [{ weekday: 'Monday', time: '18:00', trainer_id: 1 }, { weekday: 'Wednesday', time: '09:00', trainer_id: 2 }]
  const list = plannedSessions('2030-01-07', entries, 4)                  // 2030-01-07 is a Monday
  assert.deepEqual(list.map(item => [item.number, item.date, item.time, item.trainer_id]), [
    ['1/4', '2030-01-07', '18:00', 1], ['2/4', '2030-01-09', '09:00', 2], ['3/4', '2030-01-14', '18:00', 1], ['4/4', '2030-01-16', '09:00', 2]
  ])
  assert.deepEqual(plannedSessions('', entries, 4), [])
})

test('trainer names come from the availability answer', () => {
  assert.deepEqual([...trainerNames(availability)], [[1, 'Carles'], [2, 'Marta']])
})
