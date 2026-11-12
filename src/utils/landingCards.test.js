import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MAX_CARDS, addCard, blankCard, cardProblem, cardsOf, duplicateCard, listProblem, patchCard, removeCard, reorder, setVisible, textOf, textProblem, visibleEntries, withText } from './landingCards.js'

const ids = (cards) => cards.map(card => card.id)
const cards = [blankCard('a'), blankCard('b'), blankCard('c')]

test('a section without cards draws nothing; hidden cards are not drawn and keep their index', () => {
  assert.deepEqual(cardsOf(undefined), [])
  assert.deepEqual(visibleEntries({}), [])
  const section = { cards: setVisible(cards, 1, false) }
  assert.deepEqual(visibleEntries(section).map(entry => [entry.card.id, entry.index]), [['a', 0], ['c', 2]])
})

test('adding a pack makes a blank card at the end with its own id', () => {
  const added = addCard(cards)
  assert.equal(added.length, 4)
  assert.deepEqual(added[3].benefits, [])
  assert.equal(added[3].name, '')
  assert.equal(new Set(ids(added)).size, 4)
  const full = Array.from({ length: MAX_CARDS }, (_item, n) => blankCard(`x${n}`))
  assert.equal(addCard(full), full)
})

test('editing a card changes only that card', () => {
  const edited = patchCard(cards, 1, { name: 'Pack', price: '45 € / sesión' })
  assert.equal(edited[1].name, 'Pack')
  assert.equal(edited[0].name, '')
  assert.equal(edited[2], cards[2])
})

test('duplicating puts a copy with a new id right after, and the copy is independent', () => {
  const base = patchCard(cards, 0, { name: 'Pack', benefits: ['Uno'] })
  const duplicated = duplicateCard(base, 0)
  assert.equal(duplicated.length, 4)
  assert.equal(duplicated[1].name, 'Pack')
  assert.notEqual(duplicated[1].id, 'a')
  duplicated[1].benefits.push('Dos')
  assert.deepEqual(duplicated[0].benefits, ['Uno'])
})

test('removing, reordering and hiding', () => {
  assert.deepEqual(ids(removeCard(cards, 1)), ['a', 'c'])
  assert.deepEqual(ids(reorder(cards, 0, 2)), ['b', 'c', 'a'])
  assert.deepEqual(ids(reorder(cards, 2, 1)), ['a', 'c', 'b'])
  assert.equal(reorder(cards, 1, 1), cards)
  assert.equal(reorder(cards, 0, 7), cards)
  assert.equal(setVisible(cards, 0, false)[0].visible, false)
})

test('validation: no HTML, sizes and number of benefits', () => {
  assert.equal(textProblem('x'.repeat(60), 60), '')
  assert.equal(textProblem('x'.repeat(61), 60), 'lp_err_len')
  assert.equal(textProblem('<b>', 60), 'lp_err_html')
  assert.equal(textProblem({ en: 'ok', es: 'a > b' }, 60), 'lp_err_html')               // every language is checked
  assert.equal(textProblem({ en: 'ok', es: 'x'.repeat(61) }, 60), 'lp_err_len')
  assert.equal(listProblem(Array.from({ length: 10 }, (_item, n) => `b${n}`)), '')
  assert.equal(listProblem(Array.from({ length: 11 }, (_item, n) => `b${n}`)), 'lp_err_list_max')
  assert.equal(listProblem(['x'.repeat(101)]), 'lp_err_len')
  assert.deepEqual(cardProblem(patchCard(cards, 0, { price: 'x'.repeat(41) })[0]), { field: 'price', key: 'lp_err_len' })
  assert.deepEqual(cardProblem(patchCard(cards, 0, { objective: 'x'.repeat(201) })[0]), { field: 'objective', key: 'lp_err_len' })
  assert.deepEqual(cardProblem(patchCard(cards, 0, { benefits: ['<i>'] })[0]), { field: 'benefits', key: 'lp_err_html' })
  assert.equal(cardProblem(blankCard('z')), null)
})

test('a text written in the form keeps the language shape of the field', () => {
  assert.equal(withText('old', 'es', 'new'), 'new')
  assert.deepEqual(withText({ en: 'a', es: 'b' }, 'es', 'c'), { en: 'a', es: 'c' })
  assert.equal(textOf({ en: 'a', es: 'b' }, 'es'), 'b')
})

test('the landing page does not read the catalogue of packs', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const pricing = read('../components/Pricing.jsx')
  assert.doesNotMatch(pricing, /usePricing|\/pricing|packsOfType|plan_id|planItems|prices/)
  assert.match(pricing, /visibleEntries/)
  assert.doesNotMatch(read('../components/editor/PricingCardsFields.jsx'), /usePricing|planItems|plan_id/)
})
