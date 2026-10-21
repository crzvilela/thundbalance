import { API_URL } from '../config'

// The panel does not know who is looking at it. It asks a "source" for its three lists, and the source is
// built by the page that shows it:
//   the trainer:  trainerSource(authFetch,  '/trainer-area/me')
//   the admin:    trainerSource(adminFetch, `/admin/trainers/${id}/panel`)
// Both answer the same JSON (no contact data: the server does not send it).

// What went wrong, as a text key the panel shows (never the server's technical message)
export function errorKey(error) {
  return { network: 'tr_error_network', forbidden: 'tr_error_forbidden', range: 'tr_error_range' }[error?.kind] || 'tr_error'
}

class PanelError extends Error {
  constructor(kind) {
    super(kind)
    this.kind = kind
  }
}

export function trainerSource(fetcher, base) {
  const get = async (path, params) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value))
    let response
    try {
      response = await fetcher(`${API_URL}${base}${path}?${query}`)
    } catch {
      throw new PanelError('network')                       // the server is asleep or the connection failed
    }
    if (response.ok) return response.json()
    if (response.status === 401 || response.status === 403) throw new PanelError('forbidden')
    if (response.status === 422) throw new PanelError('range')
    throw new PanelError(response.status >= 500 || response.status === 404 ? 'network' : 'server')
  }

  return {
    summary: ({ period, from, to }) => get('/summary', { period, from, to }),
    sessions: ({ from, to }) => get('/sessions', { from, to }),
    freeSlots: ({ from, to }) => get('/free-slots', { from, to })
  }
}
