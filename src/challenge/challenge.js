import { solveChallenge } from './solve.js'

// The anti-robot challenge (backend/challenge.py): the browser asks for a challenge, finds its number in the background and sends the
// whole thing with the form. No cookie, no third party. The pieces here have no React in them so that they can be tested.

export const MIN_AGE_MS = 2500                  // the server refuses a solution younger than 2 s: it is held back instead of being sent too early
export const RENEW_AFTER_MS = 6 * 60 * 1000     // a challenge is valid 10 minutes; a form that stays open gets a new one before that

export function supported() {
  return typeof fetch === 'function' && typeof TextEncoder !== 'undefined'
}

export async function fetchChallenge(api, fetcher = fetch) {
  const response = await fetcher(`${api}/challenge`, { cache: 'no-store' })
  if (!response.ok) throw new Error('challenge_unavailable')
  return response.json()
}

// base64url of the JSON: what the forms send in their `challenge` field
export function pack(solution) {
  const bytes = new TextEncoder().encode(JSON.stringify(solution))
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function obtainSolution(api, fetcher = fetch, solver = solveChallenge) {
  const ch = await fetchChallenge(api, fetcher)
  const number = await solver(ch)
  return { payload: pack({ ...ch, number }), readyAt: Date.now() }
}

export function isChallengeFailure(data) {
  const detail = data && data.detail
  return Boolean(detail && typeof detail === 'object' && detail.code === 'challenge_failed')
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Sends a form with a solved challenge. If the server says the challenge failed it is replaced and the form is sent again (at most
// three times in all) without the person doing anything; "too fast" only waits a moment.
export async function sendWithChallenge(guard, send, wait = sleep) {
  let last
  for (let attempt = 0; attempt < 3; attempt++) {
    let payload
    try {
      payload = await guard.solution()
    } catch (error) {
      if (error instanceof TypeError) throw error                    // no connection: the form says so, as for any other request
      throw new Error('ch_failed', { cause: error })
    }
    const response = await send(payload)
    last = response
    if (response.status !== 400) {
      if (response.ok) guard.spent()
      return response
    }
    const data = await response.clone().json().catch(() => null)
    if (!isChallengeFailure(data)) return response
    if (data.detail.reason === 'too_fast') await wait(MIN_AGE_MS)
    else guard.spent()
  }
  if (last && last.status === 400) throw new Error('ch_failed')       // three solutions in a row were refused
  return last
}
