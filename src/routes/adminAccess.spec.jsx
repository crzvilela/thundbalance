import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { textsFor } from '../i18n/errorPages'
import { isGenericNotFound } from '../api/admin'

// The hiding of the admin panel (docs/ADMIN_ACCESS.md): what a visitor, a client and the administrator see at /admin, at the secret path and at an
// unknown one, and that the code of the panel is requested only for the administrator. Every path here is made up: the real one is a secret.
vi.setConfig({ testTimeout: 30000 })                     // the first load of a lazy page can be slow when the whole suite runs at once
const FAKE = 'fakepath0123ab'
const OTHER = 'otherpath4567c'
const store = vi.hoisted(() => ({ user: null, roles: null, routeChecks: [], adminLoaded: 0, adminBase: '', match: false, adminChunkRequests: [] }))

vi.mock('../firebase/authModule.js', () => ({
  auth: { get currentUser() { return store.user } },
  onAuthStateChanged: (auth, callback) => { setTimeout(() => callback(store.user), 0); return () => {} },
  signOut: vi.fn(),
}))
vi.mock('firebase/auth', () => ({
  signInWithPopup: vi.fn(), signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: vi.fn(), updateProfile: vi.fn(), sendEmailVerification: vi.fn(),
  signOut: vi.fn(), onAuthStateChanged: (auth, callback) => { setTimeout(() => callback(store.user), 0); return () => {} },
}))
vi.mock('../firebase/auth', () => ({ auth: { get currentUser() { return store.user } }, googleProvider: {} }))
// the panel itself: replaced by a marker. The factory runs only when the module is requested: that is what is counted.
vi.mock('../admin/AdminApp.jsx', () => {
  store.adminLoaded += 1
  return { default: ({ base }) => { store.adminBase = base; return <div data-testid="admin-panel">panel</div> } }
})

const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, clone() { return this } })
function server() {
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    if (path.startsWith('/route-check')) {
      store.routeChecks.push(JSON.parse(options.body || '{}'))
      return json({ match: store.match })
    }
    if (path.startsWith('/me/roles')) return json(store.roles || { is_admin: false, is_trainer: false })
    return json({})
  }))
}

class NoObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
const admin = { uid: 'uid-admin', email: 'david@admin.es', getIdToken: async () => 'token' }
const client = { uid: 'uid-client', email: 'ana@example.test', getIdToken: async () => 'token' }

async function visit(path) {
  window.history.pushState({}, '', path)
  const { default: App } = await import('../App.jsx')
  const view = render(<App />)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)) })
  return view
}
const notFound = () => screen.queryByText(textsFor('en').notFoundTitle)
const findNotFound = () => screen.findByText(textsFor('en').notFoundTitle, {}, { timeout: 8000 })

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', NoObserver)
  store.user = null
  store.roles = null
  store.routeChecks = []
  store.match = false
  store.adminBase = ''
  localStorage.clear()
  localStorage.setItem('tb_cookie_consent', JSON.stringify({ external: false }))
  localStorage.setItem('tb_language', 'en')
  server()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('a visitor', () => {
  it.each(['/admin', '/admin/clients', '/admin/login', '/administrator', '/wp-admin', '/dashboard-admin', '/admin/calendar/anything'])('sees the ordinary 404 at %s, with no redirect to the login', async (path) => {
    await visit(path)
    expect(await findNotFound()).toBeTruthy()
    expect(window.location.pathname).toBe(path)                         // nothing redirected
    expect(screen.queryByTestId('admin-panel')).toBeNull()
    expect(store.routeChecks).toEqual([])                               // not even a question to the server
  })

  it('sees exactly the same 404 at /admin as at any other unknown path', async () => {
    const { container, unmount } = await visit('/admin/clients')
    await findNotFound()
    const normalise = (html) => html.replace(/:r[0-9a-z]+:/g, ':id:')                   // React's generated ids differ between two renders
    const adminHtml = normalise(container.querySelector('main').outerHTML)          // the page itself (the cookie banner comes and goes with its own timer)
    unmount()
    const other = await visit('/zzz-unknown')
    await findNotFound()
    expect(normalise(other.container.querySelector('main').outerHTML)).toBe(adminHtml)
  })

  it('at a segment that could be the secret one the server is asked, and a wrong guess is the ordinary 404', async () => {
    await visit(`/${OTHER}/clients`)
    await waitFor(() => expect(store.routeChecks).toEqual([{ segment: OTHER }]))
    expect(await findNotFound()).toBeTruthy()
    expect(screen.queryByTestId('admin-panel')).toBeNull()
  })

  it('with the right bookmark the login shows (not the panel) at the same address', async () => {
    store.match = true
    await visit(`/${FAKE}/clients`)
    await waitFor(() => expect(store.routeChecks).toEqual([{ segment: FAKE }]))
    expect(screen.queryByTestId('admin-panel')).toBeNull()
    expect(await screen.findByRole('button', { name: /^login$|sign in|iniciar/i }, { timeout: 8000 })).toBeTruthy()
    expect(notFound()).toBeNull()
    expect(window.location.pathname).toBe(`/${FAKE}/clients`)           // it will come back here after signing in
  })

  it('never downloads the panel: not on the home page, not on the login, not on an unknown path', async () => {
    for (const path of ['/', '/login', '/register', '/privacy', '/nothing-here']) {
      const { unmount } = await visit(path)
      unmount()
    }
    expect(store.adminLoaded).toBe(0)
  })
})

describe('a client or a trainer', () => {
  beforeEach(() => { store.user = client; store.roles = { is_admin: false, is_trainer: false } })

  it('sees the ordinary 404 at /admin and at any segment, is never told the secret one and never downloads the panel', async () => {
    for (const path of ['/admin', '/admin/clients', `/${FAKE}`, `/${OTHER}/x`]) {
      const { unmount } = await visit(path)
      expect(await findNotFound(), path).toBeTruthy()
      unmount()
    }
    expect(screen.queryByTestId('admin-panel')).toBeNull()
    expect(store.adminLoaded).toBe(0)
    expect(store.routeChecks).toEqual([])                                 // a signed-in client is not even asked
  })

  it('a trainer who is not the administrator is no different', async () => {
    store.roles = { is_admin: false, is_trainer: true, trainer_id: 4, trainer_name: 'Trainer Test' }
    await visit('/admin/clients')
    expect(await findNotFound()).toBeTruthy()
    expect(store.adminLoaded).toBe(0)
  })
})

describe('the administrator', () => {
  beforeEach(() => { store.user = admin; store.roles = { is_admin: true, is_trainer: false, admin_path: FAKE }; localStorage.setItem('tb_auth_hint', '1') })

  it('is sent from the old address to the new one, keeping the page, the query and the hash', async () => {
    await visit('/admin/clients?client=3#top')
    expect(window.location.pathname).toBe(`/${FAKE}/clients`)
    expect(window.location.search).toBe('?client=3')
    expect(window.location.hash).toBe('#top')
    expect(await screen.findByTestId('admin-panel', {}, { timeout: 8000 })).toBeTruthy()
    expect(store.adminBase).toBe(FAKE)
  })

  it('opens the panel at the secret path and requests its code only now', async () => {
    await visit(`/${FAKE}`)
    expect(await screen.findByTestId('admin-panel', {}, { timeout: 8000 })).toBeTruthy()
    expect(store.adminLoaded).toBeGreaterThanOrEqual(1)               // (the tests above, in this file, show it is 0 for everybody else)
  })

  it('an old (rotated) path is a 404 again', async () => {
    await visit(`/${OTHER}/clients`)
    expect(await findNotFound()).toBeTruthy()
    expect(screen.queryByTestId('admin-panel')).toBeNull()
  })

  it('/admin alone goes to the panel', async () => {
    await visit('/admin')
    expect(window.location.pathname).toBe(`/${FAKE}`)
    expect(await screen.findByTestId('admin-panel', {}, { timeout: 8000 })).toBeTruthy()
  })
})

describe('the answer of the API that means "this does not exist for you"', () => {
  it('only the generic not found counts: a 404 with its own text is a normal answer', () => {
    expect(isGenericNotFound(404, { detail: { code: 'not_found', message: 'No encontrado. / Not found.' } })).toBe(true)
    expect(isGenericNotFound(404, { detail: 'Client not found' })).toBe(false)
    expect(isGenericNotFound(404, { detail: { code: 'request_not_found' } })).toBe(false)
    expect(isGenericNotFound(404, null)).toBe(false)
    expect(isGenericNotFound(401, { detail: { code: 'not_found' } })).toBe(false)
  })
})
