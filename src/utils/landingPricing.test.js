import test from 'node:test'
import assert from 'node:assert/strict'
import { addPack, availablePacks, entriesFor, itemsOf, removeAt, reorder, setVisible } from './landingPricing.js'

const packs = [
  { id: 1, name: 'A', session_type: 'individual' },
  { id: 2, name: 'B', session_type: 'individual' },
  { id: 3, name: 'C', session_type: 'dual' },
  { id: 4, name: 'New pack', session_type: 'individual' },
]
const section = {
  plans: [{ highlighted: false }, { highlighted: true }],
  planItems: [{ plan_id: 2, visible: true, card: 1 }, { plan_id: 1, visible: true, card: 0 }, { plan_id: 3, visible: true, card: 0 }],
}

test('the page draws only the packs of the list, in the order of the list, for the chosen type', () => {
  assert.deepEqual(entriesFor(section, packs, 'individual').map(entry => entry.pack.id), [2, 1])
  assert.deepEqual(entriesFor(section, packs, 'dual').map(entry => entry.pack.id), [3])
})

test('a new pack of the catalogue is NOT on the page until it is added', () => {
  assert.equal(entriesFor(section, packs, 'individual').some(entry => entry.pack.id === 4), false)
  assert.deepEqual(availablePacks(packs, section).map(pack => pack.id), [4])
})

test('a section without a list draws nothing', () => {
  assert.deepEqual(entriesFor({ plans: [{}] }, packs, 'individual'), [])
  assert.deepEqual(itemsOf(undefined), [])
})

test('a deleted or archived pack disappears in silence and comes back with the pack', () => {
  const without = packs.filter(pack => pack.id !== 1)
  assert.deepEqual(entriesFor(section, without, 'individual').map(entry => entry.pack.id), [2])
  assert.deepEqual(entriesFor(section, packs, 'individual').map(entry => entry.pack.id), [2, 1])
})

test('hidden items are not drawn; the card of an item is its own', () => {
  const hidden = { ...section, planItems: setVisible(section.planItems, 0, false) }
  assert.deepEqual(entriesFor(hidden, packs, 'individual').map(entry => entry.pack.id), [1])
  assert.equal(entriesFor(section, packs, 'individual')[0].cardIndex, 1)
  assert.equal(entriesFor({ ...section, planItems: [{ plan_id: 1, visible: true, card: 9 }] }, packs, 'individual')[0].cardIndex, null)
})

test('adding a pack appends it with a new card; adding twice does nothing; removing takes it out of the list only', () => {
  const added = addPack(section, 4, { name: '' })
  assert.deepEqual(added.planItems.at(-1), { plan_id: 4, visible: true, card: 2 })
  assert.equal(added.plans.length, 3)
  assert.equal(addPack({ ...section, planItems: added.planItems, plans: added.plans }, 4, {}), null)
  const removed = removeAt(added.planItems, 3)
  assert.equal(removed.some(item => item.plan_id === 4), false)
  assert.equal(removed.length, 3)
})

test('reorder moves an item to a place and ignores impossible moves', () => {
  const ids = (items) => items.map(item => item.plan_id)
  assert.deepEqual(ids(reorder(section.planItems, 0, 2)), [1, 3, 2])
  assert.deepEqual(ids(reorder(section.planItems, 2, 1)), [2, 3, 1])
  assert.equal(reorder(section.planItems, 0, 5), section.planItems)
  assert.equal(reorder(section.planItems, 1, 1), section.planItems)
})

test('the goal and the benefits are drawn on the landing card only, not on the request page', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
  assert.match(read('../components/Pricing.jsx'), /PackExtras/)
  assert.doesNotMatch(read('../pages/TrainingRequest.jsx'), /PackExtras|objective|benefits/)
  assert.doesNotMatch(read('../pages/Dashboard.jsx'), /PackExtras|objective|benefits/)
})
