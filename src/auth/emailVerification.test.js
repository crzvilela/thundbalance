import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RESEND_PAUSE_SECONDS, gateReducer, isNotVerifiedAnswer, markSent, readLastSent, reportIfNotVerified, secondsUntilResend
} from './emailVerification.js'
import { pageText } from '../i18n/pageText.js'

const memory = () => {
  const data = new Map()
  return { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)) }
}
const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

test('only the 403 with the code email_not_verified means "verify your email"', () => {
  assert.equal(isNotVerifiedAnswer(403, { detail: { code: 'email_not_verified' } }), true)
  assert.equal(isNotVerifiedAnswer(403, { detail: 'Administrator access required' }), false)
  assert.equal(isNotVerifiedAnswer(401, { detail: { code: 'email_not_verified' } }), false)
  assert.equal(isNotVerifiedAnswer(403, null), false)
})

test('the verification screen appears with that answer and nothing else opens it', async () => {
  let opened = 0
  const open = () => { opened += 1 }
  assert.equal(await reportIfNotVerified(answer(403, { detail: { code: 'email_not_verified', message: 'x' } }), open), true)
  assert.equal(opened, 1)
  assert.equal(await reportIfNotVerified(answer(403, { detail: 'This belongs to another account' }), open), false)
  assert.equal(await reportIfNotVerified(answer(200, { ok: true }), open), false)
  assert.equal(await reportIfNotVerified(answer(401, { detail: { code: 'email_not_verified' } }), open), false)
  assert.equal(await reportIfNotVerified(new Response('not json', { status: 403 }), open), false)        // never throws
  assert.equal(await reportIfNotVerified(null, open), false)
  assert.equal(opened, 1)
})

test('the page can still read the answer after it was looked at', async () => {
  const response = answer(403, { detail: { code: 'email_not_verified' } })
  await reportIfNotVerified(response, () => {})
  assert.equal((await response.json()).detail.code, 'email_not_verified')
})

test('the screen opens on "not verified" and closes once the address is verified', () => {
  let state = { open: false }
  state = gateReducer(state, 'not_verified')
  assert.equal(state.open, true)
  state = gateReducer(state, 'not_verified')                      // a second failing call keeps it open
  assert.equal(state.open, true)
  state = gateReducer(state, 'verified')
  assert.equal(state.open, false)
  assert.deepEqual(gateReducer(state, 'something else'), state)
})

test('the email can be resent only after the pause of 60 seconds', () => {
  assert.equal(RESEND_PAUSE_SECONDS, 60)
  const sent = 1_000_000
  assert.equal(secondsUntilResend(0, sent), 0)
  assert.equal(secondsUntilResend(sent, sent), 60)
  assert.equal(secondsUntilResend(sent, sent + 15_000), 45)
  assert.equal(secondsUntilResend(sent, sent + 59_001), 1)
  assert.equal(secondsUntilResend(sent, sent + 60_000), 0)
})

test('the time of the last email is remembered for the same account only', () => {
  const storage = memory()
  assert.equal(readLastSent('uid-1', storage), 0)
  markSent('uid-1', 123456, storage)
  assert.equal(readLastSent('uid-1', storage), 123456)
  assert.equal(readLastSent('uid-2', storage), 0)
})

test('the screen has its text in the three languages', () => {
  const keys = Object.keys(pageText.en).filter(key => key.startsWith('ve_'))
  assert.ok(keys.length >= 10)
  for (const language of ['es', 'ca']) {
    for (const key of keys) assert.ok(pageText[language][key], `${language} is missing ${key}`)
  }
  for (const language of ['en', 'es', 'ca']) assert.match(pageText[language].ve_text, /\{email\}/)
  for (const language of ['en', 'es', 'ca']) assert.match(pageText[language].ve_resend_wait, /\{s\}/)
})
