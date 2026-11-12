import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TIERS, TYPES, blankPrices, featuresProblem, hasContent, textOf, textProblem, tierOf, tierProblem, withText, withTier } from './landingPrices.js'

const section = {
  prices: {
    individual: [{ price: '€65/session', features: ['a'] }, { price: '€60/session', features: [] }, { price: '', features: [] }],
    dual: [{ price: '€80/session', features: ['d1'] }, { price: '€75/session', features: ['d2'] }, { price: '€70/session', features: ['d3'] }],
  },
}

test('the three tiers of each type are Monthly, Quarterly and Semiannual, in that order', () => {
  assert.deepEqual(TIERS, ['monthly', 'quarterly', 'semiannual'])
  assert.deepEqual(TYPES, ['individual', 'dual'])
  assert.equal(blankPrices().individual.length, 3)
  assert.equal(blankPrices().dual.length, 3)
})

test('each box shows only its own tiers: nothing of one type ever appears in the other', () => {
  const individual = TIERS.map((_tier, index) => tierOf(section, 'individual', index).price)
  const dual = TIERS.map((_tier, index) => tierOf(section, 'dual', index).price)
  assert.deepEqual(individual, ['€65/session', '€60/session', ''])
  assert.deepEqual(dual, ['€80/session', '€75/session', '€70/session'])
  assert.ok(individual.every(price => !dual.includes(price) || price === ''))
})

test('a missing or odd tier is an empty tier, never a crash', () => {
  assert.deepEqual(tierOf(undefined, 'dual', 0), { price: '', features: [] })
  assert.deepEqual(tierOf({ prices: { dual: [null] } }, 'dual', 0), { price: '', features: [] })
  assert.deepEqual(tierOf({ prices: { individual: [] } }, 'individual', 2), { price: '', features: [] })
  assert.equal(hasContent(undefined, 'es'), false)
  assert.equal(hasContent({ prices: blankPrices() }, 'es'), false)
  assert.equal(hasContent(section, 'es'), true)
})

test('editing one tier leaves every other tier and the other type untouched', () => {
  const edited = withTier(section, 'dual', 1, { price: '99 €', features: ['x', 'y'] })
  assert.deepEqual(edited.dual[1], { price: '99 €', features: ['x', 'y'] })
  assert.deepEqual(edited.dual[0], section.prices.dual[0])
  assert.deepEqual(edited.dual[2], section.prices.dual[2])
  assert.deepEqual(edited.individual, section.prices.individual)
  const fromNothing = withTier({}, 'individual', 2, { price: '1 €' })
  assert.equal(fromNothing.individual.length, 3)
  assert.equal(fromNothing.individual[2].price, '1 €')
  assert.equal(fromNothing.dual.length, 3)
})

test('validation: price 60, features 0 to 10 of 100, no < or >', () => {
  assert.equal(textProblem('x'.repeat(60), 60), '')
  assert.equal(tierProblem({ price: 'x'.repeat(61), features: [] }), 'lp_err_len')
  assert.equal(tierProblem({ price: '<b>', features: [] }), 'lp_err_html')
  assert.equal(tierProblem({ price: { en: 'ok', es: 'a > b' }, features: [] }), 'lp_err_html')
  assert.equal(featuresProblem(Array.from({ length: 10 }, (_item, n) => `f${n}`)), '')
  assert.equal(featuresProblem(Array.from({ length: 11 }, (_item, n) => `f${n}`)), 'lp_err_list_max')
  assert.equal(featuresProblem(['x'.repeat(101)]), 'lp_err_len')
  assert.equal(featuresProblem(['<i>']), 'lp_err_html')
  assert.equal(tierProblem({ price: '45 € / sesión', features: ['Uno'] }), '')
})

test('a text written in the form keeps the language shape of the field', () => {
  assert.equal(withText('old', 'es', 'new'), 'new')
  assert.deepEqual(withText({ en: 'a', es: 'b' }, 'es', 'c'), { en: 'a', es: 'c' })
  assert.equal(textOf({ en: 'a', es: 'b' }, 'es'), 'b')
})

test('the landing does not depend on the catalogue, on a token or on a role', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = (text) => text.replace(/\/\/.*$/gm, '')                                        // the comments may talk about tokens
  const page = code(read('../components/Pricing.jsx'))
  assert.doesNotMatch(page, /usePricing|\/pricing|packsOfType|plan_id|planItems|\bprices\b\s*[=,)]|useRoles|auth|token|role/i)
  assert.match(page, /tierOf\(section/)
  assert.doesNotMatch(code(read('../components/editor/PricingTiersFields.jsx')), /usePricing|planItems|plan_id|auth|token/i)
  const api = read('../api/landingPage.js')
  assert.match(api, /version === 'draft' \? await adminFetch\(url\) : await fetch\(url\)/)      // the published landing is fetched without a token
})

test('the three labels exist in Spanish, English and Catalan for the two boxes', () => {
  const texts = read('../i18n/pageText.js')
  for (const key of ['pr_monthly', 'pr_quarterly', 'pr_semiannual', 'pr_empty']) assert.equal((texts.match(new RegExp(`${key}: '`, 'g')) || []).length, 3, key)
  for (const [key, es, en, ca] of [['pr_monthly', 'Mensual', 'Monthly', 'Mensual'], ['pr_quarterly', 'Trimestral', 'Quarterly', 'Trimestral'], ['pr_semiannual', 'Semestral', 'Semiannual', 'Semestral']]) {
    for (const label of new Set([es, en, ca])) assert.ok(texts.includes(`${key}: '${label}'`), `${key} ${label}`)
  }
  function read(path) { return readFileSync(new URL(path, import.meta.url), 'utf8') }
})
