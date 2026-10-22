import { canRequestChange } from './sessionDates'

// What the client can do about the date of ONE session, from the requests they already made.
// The numbers come from the server (GET /me/reschedule-requests), never from the page:
//   limit  how many requests a session may ever have      hours  notice needed before the session
export const OPEN = ['pending', 'counter_proposed']

// { sessionId -> [requests, newest first] }
export function bySession(items = []) {
  const map = new Map()
  for (const request of items) {
    if (!map.has(request.session_id)) map.set(request.session_id, [])
    map.get(request.session_id).push(request)
  }
  return map
}

// state: 'pending' (waiting for the studio) | 'proposal' (the studio proposed another date: the client answers)
//        | 'used' (nothing more can be requested, for ever) | 'too_late' (less than `hours` left) | 'available'
export function changeState(session, requests = [], { limit = 1, hours } = {}, now = new Date()) {
  const open = requests.find(request => OPEN.includes(request.status))
  if (open) return { state: open.status === 'pending' ? 'pending' : 'proposal', request: open }
  if (requests.length >= limit) return { state: 'used', request: requests[0] }
  if (!canRequestChange(session, now, hours)) return { state: 'too_late' }
  return { state: 'available' }
}
