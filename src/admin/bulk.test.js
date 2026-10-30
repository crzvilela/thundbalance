import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_BULK, fill, pruneSelection, summarize, toggleAllIds } from './bulk.js'

test('only the rows still visible stay selected', () => {
  assert.deepEqual(pruneSelection([1, 2, 3], [2, 3, 4]), [2, 3])
  assert.deepEqual(pruneSelection([], [1]), [])
})

test('select all takes the visible rows, a second time empties it, and never more than the server accepts', () => {
  assert.deepEqual(toggleAllIds([], [1, 2, 3]), [1, 2, 3])
  assert.deepEqual(toggleAllIds([1], [1, 2, 3]), [1, 2, 3])
  assert.deepEqual(toggleAllIds([1, 2, 3], [1, 2, 3]), [])
  assert.deepEqual(toggleAllIds([], []), [])
  const many = Array.from({ length: MAX_BULK + 50 }, (_, index) => index + 1)
  assert.equal(toggleAllIds([], many).length, MAX_BULK)
})

test('the server answer becomes done / failed with the reasons', () => {
  const answer = { total: 3, done: 2, failed: 1, results: [{ id: 1, ok: true }, { id: 2, ok: false, error: 'in use' }, { id: 3, ok: true }] }
  assert.deepEqual(summarize(answer), { total: 3, done: 2, failed: 1, errors: [{ id: 2, ok: false, error: 'in use' }] })
  assert.deepEqual(summarize({}), { total: 0, done: 0, failed: 0, errors: [] })
})

test('placeholders are filled everywhere they appear', () => {
  assert.equal(fill('{n} of {n}: {name}', { n: 3, name: 'x' }), '3 of 3: x')
})
