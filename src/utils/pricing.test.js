// node --test src/utils/
import test from 'node:test'
import assert from 'node:assert/strict'
import { formatMoney, packPricePerSession, packQuote, sessionTypeBody, totalPrice, trialPricePerSession } from './pricing.js'

// the answer of GET /pricing (the server owns the numbers; these are only test data)
const PRICES = {
  packs: { individual: { 1: 65, 3: 60, 6: 55 }, dual: { 1: 80, 3: 75, 6: 70 } },
  trial: { individual: 40, dual: 50 },
  months: [1, 3, 6]
}

test('a pack costs the price of its type and duration, per session and in total', () => {
  assert.equal(packPricePerSession(PRICES, 'individual', 3), 60)
  assert.equal(packPricePerSession(PRICES, 'dual', 3), 75)
  assert.deepEqual(packQuote(PRICES, 'individual', 3, 24), { perSession: 60, sessions: 24, total: 1440 })
  assert.deepEqual(packQuote(PRICES, 'dual', 3, 24), { perSession: 75, sessions: 24, total: 1800 })
})

test('a duration without a price has no figures instead of an invented one', () => {
  assert.equal(packPricePerSession(PRICES, 'individual', 7), null)
  assert.equal(packQuote(PRICES, 'dual', 7, 10).total, null)
  assert.equal(packPricePerSession(null, 'dual', 3), null)
  assert.equal(formatMoney(null), '—')
})

test('the trial costs 40 individual and 50 dual', () => {
  assert.equal(trialPricePerSession(PRICES, 'individual'), 40)
  assert.equal(trialPricePerSession(PRICES, 'dual'), 50)
})

test('money is written without noise', () => {
  assert.equal(formatMoney(60), '€60')
  assert.equal(formatMoney(62.5), '€62.50')
  assert.equal(totalPrice(65.1, 3), 195.3)
})

test('only a dual body carries the second person', () => {
  assert.deepEqual(sessionTypeBody({ type: 'individual', name: 'x', email: 'y' }), { session_type: 'individual' })
  assert.deepEqual(sessionTypeBody({ type: 'dual', name: ' Beatriz ', email: ' BEA@Example.org ' }),
    { session_type: 'dual', second_person_name: 'Beatriz', second_person_email: 'bea@example.org' })
})
