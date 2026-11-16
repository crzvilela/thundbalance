import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

// Loading less must not change what the site does. These tests cover the parts that moved: the Firebase SDK that now arrives as a
// separate file (visitor, client, admin, reloading a private page), the roles, the wake-up notice, and that every route still loads.

const store = vi.hoisted(() => ({ user: null, listeners: [] }))
vi.mock('./firebase/authModule.js', () => ({
  auth: { get currentUser() { return store.user } },
  onAuthStateChanged: (auth, callback) => { store.listeners.push(callback); setTimeout(() => callback(store.user), 0); return () => {} },
  signOut: vi.fn(async () => { store.user = null }),
}))
vi.mock('firebase/auth', () => ({
  signInWithPopup: vi.fn(), signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: vi.fn(), updateProfile: vi.fn(), sendEmailVerification: vi.fn(),
  signOut: vi.fn(), onAuthStateChanged: (auth, callback) => { setTimeout(() => callback(store.user), 0); return () => {} },
}))
vi.mock('./firebase/auth', () => ({ auth: { get currentUser() { return store.user } }, googleProvider: {} }))

const client = { uid: 'uid-client', email: 'ana@example.test', displayName: 'Ana', getIdToken: async () => 'token-client' }
const admin = { uid: 'uid-admin', email: 'david@admin.es', displayName: 'Admin', getIdToken: async () => 'token-admin' }

beforeEach(() => {
  store.user = null
  store.listeners = []
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules() })

const at = (path) => window.history.pushState({}, '', path)
const freshSession = async () => import('./firebase/session.js')

describe('the Firebase session arrives as a separate file', () => {
  it('on a private page it is loaded at once and a visitor is recognised as signed out', async () => {
    at('/dashboard')
    const { onUserChange } = await freshSession()
    const seen = []
    onUserChange(user => seen.push(user))
    await waitFor(() => expect(seen).toEqual([null]))
  })

  it('on the landing page it waits for the first paint, unless this browser has signed in before', async () => {
    at('/')
    vi.useFakeTimers()
    let { onUserChange } = await freshSession()
    const seen = []
    onUserChange(user => seen.push(user))
    await vi.advanceTimersByTimeAsync(10)
    expect(seen).toEqual([])                                     // not before the first paint
    await vi.advanceTimersByTimeAsync(3000)
    expect(seen).toEqual([null])                                 // and it does arrive

    vi.resetModules()
    localStorage.setItem('tb_auth_hint', '1')                    // a returning client: no waiting
    ;({ onUserChange } = await freshSession())
    const known = []
    onUserChange(user => known.push(user))
    await vi.advanceTimersByTimeAsync(10)
    expect(known).toEqual([null])
  })

  it.each([['a client', client], ['the admin', admin]])('%s with a session is recognised, and the browser remembers it', async (name, user) => {
    store.user = user
    at('/messages')
    const { onUserChange } = await freshSession()
    const seen = []
    onUserChange(person => seen.push(person?.email))
    await waitFor(() => expect(seen).toEqual([user.email]))
    expect(localStorage.getItem('tb_auth_hint')).toBe('1')
    store.user = null
    store.listeners.forEach(callback => callback(null))          // signing out forgets it
    expect(localStorage.getItem('tb_auth_hint')).toBeNull()
  })

  it('reloading a private page: the guards wait ("loading") until Firebase has said who is signed in', async () => {
    store.user = client
    at('/my-sessions')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ is_admin: false, is_trainer: false }), clone() { return this } })))
    const { default: RolesProvider } = await import('./roles/RolesProvider.jsx')
    const { useRoles } = await import('./roles/rolesContext.js')
    const seen = []
    function Probe() { const { status } = useRoles(); seen.push(status); return <p>{status}</p> }
    render(<RolesProvider><Probe /></RolesProvider>)
    expect(seen[0]).toBe('loading')                              // never "signed-out" before Firebase has answered
    await waitFor(() => expect(screen.getByText('ready')).toBeTruthy())
    expect(seen).not.toContain('signed-out')
  })

  it('a visitor on a private page ends as signed out (the page decides what to do)', async () => {
    at('/my-sessions')
    const { default: RolesProvider } = await import('./roles/RolesProvider.jsx')
    const { useRoles } = await import('./roles/rolesContext.js')
    function Probe() { return <p>{useRoles().status}</p> }
    render(<RolesProvider><Probe /></RolesProvider>)
    await waitFor(() => expect(screen.getByText('signed-out')).toBeTruthy())
  })

  it('the fetch helper waits for the SDK, sends the token of the signed-in person and refuses when nobody is', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options) => { calls.push(options.headers.get('Authorization')); return { status: 200, ok: true, clone() { return this } } }))
    const { authFetch } = await import('./api/authFetch.js')
    await expect(authFetch('http://api.test/x')).rejects.toThrow(/sign in/i)
    store.user = admin
    await authFetch('http://api.test/x')
    expect(calls).toEqual(['Bearer token-admin'])
  })
})

describe('every route still loads', () => {
  const routes = ['/', '/login', '/register', '/privacy', '/cookies', '/legal-notice', '/terms', '/cancellations', '/training-tips', '/trial-session', '/this-page-does-not-exist']
  it.each(routes)('%s renders without errors', async (path) => {
    at(path)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { default: App } = await import('./App.jsx')
    const { container } = render(<App />)
    await waitFor(() => expect(container.querySelector('main, [role=status], h1')).toBeTruthy(), { timeout: 8000 })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    const real = errors.mock.calls.filter(call => !/Not implemented|offline|Failed to load|act\(/.test(String(call[0])))
    expect(real).toEqual([])
    expect(screen.queryByText(/something went wrong|algo salió mal/i)).toBeNull()
    errors.mockRestore()
  }, 15000)
})

describe('the server is waking up', () => {
  it('shows the friendly notice only after 3 seconds, in the visitor language', async () => {
    vi.useFakeTimers()
    const { default: WakeNotice } = await import('./components/WakeNotice.jsx')
    const { I18nProvider } = await import('./i18n/I18nContext.jsx')
    localStorage.setItem('tb_language', 'es')
    render(<I18nProvider><WakeNotice /></I18nProvider>)
    expect(screen.getByRole('status').textContent).toBe('')
    await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    expect(screen.getByRole('status').textContent).toBe('Estamos despertando el servidor, un momento…')
  })

  it('the content request is tried again while the host answers 503, then it gives the answer', async () => {
    const { fetchAwake } = await import('./api/landingPage.js')
    const answers = [{ status: 503 }, { status: 502 }, { status: 200, ok: true }]
    vi.stubGlobal('fetch', vi.fn(async () => answers.shift()))
    const waits = []
    const response = await fetchAwake('http://api.test/x', async (ms) => { waits.push(ms) })
    expect(response.status).toBe(200)
    expect(waits).toEqual([2000, 4000])
  })
})
