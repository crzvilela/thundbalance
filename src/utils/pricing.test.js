// node --test src/utils/
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatMoney, isPriceText, monthsEquivalent, packQuote, packsOfType, priceFromText, sessionTypeBody,
  totalPrice, trialPricePerSession
} from './pricing.js'

// the answer of GET /pricing (the server owns the numbers; these are only test data)
const MANY = { id: 3, name: '3 Months Pack', session_type: 'individual', weeks: 12, months: 3, sessions_per_week_options: [1, 2, 3], price_per_session: 60, price_per_pack: null }
const ONE = { id: 9, name: 'Pack 8 semanas Individual', session_type: 'individual', weeks: 8, months: 2, sessions_per_week_options: [2], price_per_session: 62.5, price_per_pack: 960 }
const DUAL = { id: 5, name: 'Dual 3 Months Pack', session_type: 'dual', weeks: 12, months: 3, sessions_per_week_options: [1, 2, 3], price_per_session: 75, price_per_pack: null }
const PRICES = { packs: [MANY, ONE, DUAL], trial: { individual: 40, dual: 50 } }

test('the packs of a type come from the catalogue, in its order', () => {
  assert.deepEqual(packsOfType(PRICES, 'individual').map(pack => pack.id), [3, 9])
  assert.deepEqual(packsOfType(PRICES, 'dual').map(pack => pack.id), [5])
  assert.deepEqual(packsOfType(null, 'dual'), [])
})

test('with several options the total is price per session x weeks x the sessions chosen', () => {
  assert.deepEqual(packQuote(MANY, 2), { perSession: 60, sessions: 24, total: 1440 })
  assert.deepEqual(packQuote(DUAL, 3), { perSession: 75, sessions: 36, total: 2700 })
})

test('with one option the pack price is the total, and without it the total is worked out', () => {
  assert.deepEqual(packQuote(ONE, 2), { perSession: 62.5, sessions: 16, total: 960 })
  assert.equal(packQuote({ ...ONE, price_per_pack: null }, 2).total, 1000)
  assert.deepEqual(packQuote(null, 2), { perSession: null, sessions: 0, total: null })
})

test('weeks have an equivalence in months only when it is exact', () => {
  assert.equal(monthsEquivalent(4), 1)
  assert.equal(monthsEquivalent(12), 3)
  assert.equal(monthsEquivalent(24), 6)
  assert.equal(monthsEquivalent(8), null)
})

test('a price typed in a form is a number with at most two decimals', () => {
  for (const good of ['0', '65', '62.5', '62,50', ' 10.99 ']) assert.equal(isPriceText(good), true, good)
  for (const bad of ['', '-1', '10.999', 'abc', '1e3']) assert.equal(isPriceText(bad), false, bad)
  assert.equal(priceFromText('62,5'), 62.5)
})

test('the trial costs 40 individual and 50 dual', () => {
  assert.equal(trialPricePerSession(PRICES, 'individual'), 40)
  assert.equal(trialPricePerSession(PRICES, 'dual'), 50)
  assert.equal(trialPricePerSession(null, 'dual'), null)
})

test('money is written without noise', () => {
  assert.equal(formatMoney(null), '—')
  assert.equal(formatMoney(60), '€60')
  assert.equal(formatMoney(62.5), '€62.50')
  assert.equal(totalPrice(65.1, 3), 195.3)
})

test('only a dual body carries the second person', () => {
  assert.deepEqual(sessionTypeBody({ type: 'individual', name: 'x', email: 'y' }), { session_type: 'individual' })
  assert.deepEqual(sessionTypeBody({ type: 'dual', name: ' Beatriz ', email: ' BEA@Example.org ' }),
    { session_type: 'dual', second_person_name: 'Beatriz', second_person_email: 'bea@example.org' })
})
