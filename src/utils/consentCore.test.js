import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CONSENT_VERSION, acceptAll, allows, buildConsent, parseConsent, rejectAll } from './consentCore.js'

test('the choice keeps the version, the date and one true/false per category: nothing else', () => {
  const stored = JSON.stringify(buildConsent({ external: true, tracking: true }, new Date('2026-11-15T10:00:00Z')))
  const choice = parseConsent(stored)
  assert.deepEqual(choice, { v: CONSENT_VERSION, at: '2026-11-15T10:00:00.000Z', external: true })
  assert.equal(allows(choice, 'external'), true)
  assert.equal(allows(choice, 'tracking'), false)               // an unknown category is never allowed
})

test('without a valid choice nothing optional is allowed (the banner asks again)', () => {
  for (const raw of [null, '', 'accepted', '{', '[]', '{"v":1,"external":true}', `{"v":${CONSENT_VERSION + 1},"external":true}`]) {
    assert.equal(parseConsent(raw), null, String(raw))
    assert.equal(allows(parseConsent(raw), 'external'), false)
  }
})

test('accept all, reject all', () => {
  assert.equal(buildConsent(acceptAll()).external, true)
  assert.equal(buildConsent(rejectAll()).external, false)
  assert.equal(buildConsent({}).external, false)                // by default off
  assert.equal(buildConsent({ external: 'yes' }).external, false) // only a real true counts
})

test('the storage is always read inside try/catch', () => {
  const source = readFileSync(new URL('./consent.js', import.meta.url), 'utf8')
  assert.equal((source.match(/window\.localStorage\./g) || []).length, 3)
  assert.equal((source.match(/try \{/g) || []).length, 3)
})
