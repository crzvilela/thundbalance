import { API_URL } from '../config'
import { authFetch } from './authFetch'

// The client's inbox (GET /inbox ...). Every failure becomes an Error whose message is a translation key
// (in_err_*), so the pages show our own sentences and never the server's technical ones.

const CODES = {
  use_booking_email: 'in_err_booking_email',
  action_pending: 'in_err_pending',
  closed: 'in_err_closed',
  expired: 'in_err_closed',
  slot_unavailable: 'in_err_slot',
  session_not_open: 'in_err_closed',
  too_many_requests: 'in_err_busy',
  not_found: 'in_err_gone',
  no_token: 'in_err_closed'
}

async function call(path, options) {
  let response
  try {
    response = await authFetch(`${API_URL}${path}`, options)
  } catch (problem) {
    // fetch could not reach the server (a TypeError), or the person is not signed in any more
    throw new Error(problem instanceof TypeError ? 'in_err_network' : 'in_err_generic', { cause: problem })
  }
  const body = await response.json().catch(() => ({}))
  if (response.ok) return body
  const code = body?.detail?.code
  const error = new Error(CODES[code] || (response.status === 429 ? 'in_err_busy' : 'in_err_generic'), { cause: code })
  error.code = code
  throw error
}

const json = (method, data) => ({ method, headers: { 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) })

// { items, total, page, pages, unread }
export const loadInbox = ({ lang, page = 1, filter = 'all', size = 20 }) => call(
  `/inbox?${new URLSearchParams({ lang, page: String(page), filter, size: String(size) })}`
)

// { unread }: the light request the menu repeats every minute
export const loadUnreadCount = () => call('/inbox/unread-count')

export const markRead = (id) => call(`/inbox/${id}/read`, json('POST'))
export const markAllRead = () => call('/inbox/read-all', json('POST'))
export const deleteMessage = (id) => call(`/inbox/${id}`, json('DELETE'))

// A button inside a message. { outcome, item }: the item comes back with its new live state.
export const runAction = (id, type, lang) => call(`/inbox/${id}/actions/${type}?${new URLSearchParams({ lang })}`, json('POST'))
