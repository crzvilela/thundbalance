import test from 'node:test'
import assert from 'node:assert/strict'
import { benefitsProblem, cleanBenefits, cleanObjective, moveItem, objectiveProblem } from './packFields.js'

test('objective: 160 characters, no < or >, empty is fine', () => {
  assert.equal(objectiveProblem(''), '')
  assert.equal(objectiveProblem('x'.repeat(160)), '')
  assert.equal(objectiveProblem('x'.repeat(161)), 'cat_err_objective_len')
  assert.equal(objectiveProblem('<b>fuerza</b>'), 'cat_err_objective_html')
  assert.equal(objectiveProblem('a > b'), 'cat_err_objective_html')
  assert.equal(cleanObjective('  Ganar   fuerza '), 'Ganar fuerza')
})

test('benefits: up to 8, 80 characters each, no markup, no repeats, blanks ignored', () => {
  assert.equal(benefitsProblem([]), '')
  assert.equal(benefitsProblem(['Uno', '', '  ', 'Dos']), '')
  assert.equal(benefitsProblem(['x'.repeat(81)]), 'cat_err_benefit_len')
  assert.equal(benefitsProblem(['<script>']), 'cat_err_benefit_html')
  assert.equal(benefitsProblem(['Uno', ' uno ']), 'cat_err_benefit_dup')
  assert.equal(benefitsProblem(Array.from({ length: 8 }, (_, n) => `b${n}`)), '')
  assert.equal(benefitsProblem(Array.from({ length: 9 }, (_, n) => `b${n}`)), 'cat_err_benefit_max')
  assert.deepEqual(cleanBenefits([' Uno ', '', 'Dos  tres']), ['Uno', 'Dos tres'])
})

test('moveItem swaps neighbours and never leaves the list', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c'])
  assert.deepEqual(moveItem(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b'])
  const same = ['a', 'b']
  assert.equal(moveItem(same, 0, -1), same)
  assert.equal(moveItem(same, 1, 1), same)
})
