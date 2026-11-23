import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// adminFetch: a "this does not exist for you" 404 during an active session renews the token and tries ONCE more; then the session is over. Never a loop.
const store = vi.hoisted(() => ({ tokenCalls: [], signOut: vi.fn(), answers: [] }))
vi.mock('../firebase/session', () => ({
  loadAuthModule: async () => ({
    auth: { currentUser: { getIdToken: async (force) => { store.tokenCalls.push(Boolean(force)); return force ? 'fresh-token' : 'old-token' } } },
    signOut: store.signOut,
  }),
}))

const generic = () => ({ status: 404, ok: false, clone() { return this }, json: async () => ({ detail: { code: 'not_found', message: 'No encontrado. / Not found.' } }) })
const own = () => ({ status: 404, ok: false, clone() { return this }, json: async () => ({ detail: 'Client not found' }) })
const fine = () => ({ status: 200, ok: true, clone() { return this }, json: async () => ({ ok: true }) })

beforeEach(() => {
  store.tokenCalls = []
  store.signOut.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => store.answers.shift()()))
  vi.spyOn(window, 'location', 'get').mockReturnValue({ assign: vi.fn() })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('adminFetch', () => {
  it('sends the token and does nothing else when the answer is fine', async () => {
    store.answers = [fine]
    const { adminFetch } = await import('./admin')
    const response = await adminFetch('/admin/stats')
    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(store.tokenCalls).toEqual([false])
    expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer old-token')
  })

  it('renews the token and repeats the request once when the generic 404 arrives, and then it works', async () => {
    store.answers = [generic, fine]
    const { adminFetch } = await import('./admin')
    const response = await adminFetch('/admin/stats')
    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(store.tokenCalls).toEqual([false, true])                         // the second time the token is forced to refresh
    expect(fetch.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer fresh-token')
    expect(store.signOut).not.toHaveBeenCalled()
  })

  it('a second generic 404 ends the session (one retry, no loop)', async () => {
    store.answers = [generic, generic, generic]
    const { adminFetch } = await import('./admin')
    const response = await adminFetch('/admin/stats')
    expect(response.status).toBe(404)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(store.signOut).toHaveBeenCalledTimes(1))
  })

  it('a 404 with its own text is a normal answer: no retry, no sign out', async () => {
    store.answers = [own]
    const { adminFetch } = await import('./admin')
    const response = await adminFetch('/admin/clients/9')
    expect(response.status).toBe(404)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(store.signOut).not.toHaveBeenCalled()
  })
})
