import { API_URL } from '../config'
import { authFetch } from './authFetch'

// Change requests: the client asks, the studio decides. Every error becomes an Error whose message
// is a translation key (ms_err_*), so the pages never show the server's own words.

const CODES = {
  limit_reached: 'ms_err_limit', open_request: 'ms_err_open', too_late: 'ms_err_late', slot_unavailable: 'ms_err_taken',
  session_not_open: 'ms_err_past', trainer_unavailable: 'ms_err_trainer', closed: 'ms_err_closed', expired: 'ms_err_closed', note_too_long: 'ms_err_note', invalid_slot: 'ms_err_taken'
}

async function read(response, fallback) {
  const body = await response.json().catch(() => ({}))
  if (response.ok) return body
  const code = body?.detail?.code
  const error = new Error(CODES[code] || fallback, { cause: code })
  error.code = code
  throw error
}

function wrap(promise, fallback) {
  return promise.catch(problem => {
    if (problem?.message?.startsWith('ms_err_') || problem?.message?.startsWith('rr_')) throw problem
    // fetch could not reach the server (a TypeError): say so, not "something technical"
    throw new Error(problem instanceof TypeError ? 'ms_err_network' : fallback, { cause: problem })
  })
}

// { items: [...], max_per_session, notice_hours, note_max }
export const loadMyRequests = () => wrap(authFetch(`${API_URL}/me/reschedule-requests`).then(r => read(r, 'ms_err_request')), 'ms_err_request')

export const createRescheduleRequest = (sessionId, { date, time, note, lang, trainerId }) => wrap(
  authFetch(`${API_URL}/me/sessions/${sessionId}/reschedule-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requested_date: date, requested_time: time, note: note || null, lang, trainer_id: trainerId || null })
  }).then(r => read(r, 'ms_err_request')),
  'ms_err_request'
)

export const answerMyProposal = (requestId, accept) => wrap(
  authFetch(`${API_URL}/me/reschedule-requests/${requestId}/${accept ? 'accept' : 'decline'}`, { method: 'POST' }).then(r => read(r, 'ms_err_answer')),
  'ms_err_answer'
)

// ---- public page, by token (no login): GET only reads; the POSTs are the answer
export const loadProposal = (token) => fetch(`${API_URL}/reschedule-response/${encodeURIComponent(token)}`).then(async response => {
  if (response.status === 404) return { state: 'notfound' }
  if (!response.ok) throw new Error('rr_error')
  return response.json()
})

export const answerProposal = (token, accept) => fetch(`${API_URL}/reschedule-response/${encodeURIComponent(token)}/${accept ? 'accept' : 'decline'}`, { method: 'POST' }).then(async response => {
  const body = await response.json().catch(() => ({}))
  if (response.status === 404) return { outcome: 'notfound' }
  if (response.status === 409) return { outcome: body?.detail?.code === 'slot_unavailable' ? 'slot_taken' : 'unavailable' }
  if (!response.ok) throw new Error('rr_error')
  return body
})
