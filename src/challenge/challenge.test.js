import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'
import { findNumber, sha256Hex } from './sha256.js'
import { isChallengeFailure, obtainSolution, pack, sendWithChallenge } from './challenge.js'
import { solveHere } from './solve.js'

const reference = (text) => createHash('sha256').update(text).digest('hex')

test('the SHA-256 of the page is the real one (empty text, short, 55/56/64 bytes, long)', () => {
  for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(200), `${randomBytes(12).toString('hex')}12345`]) {
    assert.equal(sha256Hex(text), reference(text), `length ${text.length}`)
  }
})

function challengeFor(number, max = 3000) {
  const salt = randomBytes(12).toString('hex')
  return { id: 'x', salt, challenge: reference(`${salt}${number}`), max, iat: 1, exp: 2, sig: 'sig', algorithm: 'SHA-256' }
}

test('the number of a challenge is found, at the start, in the middle and at the end of the range', async () => {
  for (const number of [0, 1, 1999, 3000]) {
    const ch = challengeFor(number)
    assert.equal(findNumber(ch), number)
    assert.equal(await solveHere(ch), number)
  }
  assert.equal(findNumber({ ...challengeFor(5), max: 3 }), null)       // outside the range: not found
})

test('the full difficulty (100 000 tries) is a fraction of a second in plain JavaScript', () => {
  const ch = challengeFor(100000, 100000)
  const start = Date.now()
  assert.equal(findNumber(ch), 100000)
  assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`)
})

test('what is sent is the challenge plus the number, as base64url JSON', async () => {
  const ch = challengeFor(42)
  const fetcher = async (url, options) => {
    assert.match(url, /^https:\/\/api\.example\/challenge$/)
    assert.equal(options.cache, 'no-store')                   // no cookie, no credentials
    assert.equal(options.credentials, undefined)
    return { ok: true, json: async () => ch }
  }
  const { payload } = await obtainSolution('https://api.example', fetcher, async (given) => findNumber(given))
  assert.match(payload, /^[A-Za-z0-9_-]+$/)
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), { ...ch, number: 42 })
  assert.equal(pack({ a: 1 }), Buffer.from('{"a":1}').toString('base64url'))
})

test('a server that cannot give a challenge is an error the form can show', async () => {
  await assert.rejects(obtainSolution('https://api.example', async () => ({ ok: false }), async () => 1), /challenge_unavailable/)
})

const answer = (status, body) => ({ status, ok: status >= 200 && status < 300, clone() { return this }, json: async () => body })
const failure = (reason) => answer(400, { detail: { code: 'challenge_failed', reason } })

function fakeGuard() {
  const log = { solutions: 0, spent: 0 }
  return { log, solution: async () => `solution-${++log.solutions}`, spent: () => { log.spent += 1 } }
}

test('a form is sent once with its solution, which is then used up', async () => {
  const guard = fakeGuard()
  const sent = []
  const response = await sendWithChallenge(guard, async (payload) => { sent.push(payload); return answer(200, {}) }, async () => {})
  assert.equal(response.status, 200)
  assert.deepEqual(sent, ['solution-1'])
  assert.equal(guard.log.spent, 1)
})

test('an ordinary error (a typo, a duplicate) keeps the solution for the next try', async () => {
  const guard = fakeGuard()
  const response = await sendWithChallenge(guard, async () => answer(422, { detail: 'bad' }), async () => {})
  assert.equal(response.status, 422)
  assert.equal(guard.log.spent, 0)
})

test('a refused challenge is replaced and the form sent again without the person doing anything', async () => {
  const guard = fakeGuard()
  const replies = [failure('used'), answer(200, {})]
  const response = await sendWithChallenge(guard, async () => replies.shift(), async () => {})
  assert.equal(response.status, 200)
  assert.equal(guard.log.solutions, 2)
  assert.equal(guard.log.spent, 2)
})

test('"too fast" only waits and tries again with the same solution', async () => {
  const guard = fakeGuard()
  const waits = []
  const replies = [failure('too_fast'), answer(200, {})]
  await sendWithChallenge(guard, async () => replies.shift(), async (ms) => { waits.push(ms) })
  assert.deepEqual(waits, [2500])
  assert.equal(guard.log.spent, 1)                        // only the success used it up
})

test('after three refusals the form shows a clear error instead of looping', async () => {
  const guard = fakeGuard()
  await assert.rejects(sendWithChallenge(guard, async () => failure('invalid'), async () => {}), { message: 'ch_failed' })
  assert.equal(guard.log.solutions, 3)
})

test('a challenge that cannot be solved is a clear error; no connection stays a connection error', async () => {
  const unsolved = { solution: async () => { throw new Error('unsolved') }, spent() {} }
  await assert.rejects(sendWithChallenge(unsolved, async () => answer(200, {})), { message: 'ch_failed' })
  const offline = { solution: async () => { throw new TypeError('network') }, spent() {} }
  await assert.rejects(sendWithChallenge(offline, async () => answer(200, {})), TypeError)
})

test('only the stable code counts as a challenge failure', () => {
  assert.equal(isChallengeFailure({ detail: { code: 'challenge_failed' } }), true)
  for (const other of [null, {}, { detail: 'challenge_failed' }, { detail: { code: 'email_not_verified' } }]) assert.equal(isChallengeFailure(other), false)
})
