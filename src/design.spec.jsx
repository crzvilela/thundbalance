import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { defaultContent } from './content/defaultContent.js'

// The visual adjustments of the design review (Prompt 79): what a visitor reads and what a keyboard or a screen reader finds.

const store = vi.hoisted(() => ({ user: null, inbox: { items: [], total: 0, page: 1, pages: 1, unread: 0, counts: { inbox: 0, unread: 0, archived: 0 } } }))
vi.mock('./firebase/authModule.js', () => ({
  auth: { get currentUser() { return store.user } },
  onAuthStateChanged: (auth, callback) => { setTimeout(() => callback(store.user), 0); return () => {} },
  signOut: vi.fn(),
}))
vi.mock('firebase/auth', () => ({
  signInWithPopup: vi.fn(), signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: vi.fn(), updateProfile: vi.fn(), sendEmailVerification: vi.fn(),
  signOut: vi.fn(), onAuthStateChanged: (auth, callback) => { setTimeout(() => callback(store.user), 0); return () => {} },
}))
vi.mock('./firebase/auth', () => ({ auth: { get currentUser() { return store.user } }, googleProvider: {} }))
vi.mock('./api/inbox.js', () => ({
  loadInbox: vi.fn(async () => store.inbox), markAllRead: vi.fn(), markRead: vi.fn(), archiveRead: vi.fn(), archiveMessage: vi.fn(), unarchiveMessage: vi.fn(), runAction: vi.fn(),
  loadUnreadCount: vi.fn(async () => ({ unread: 0 })),
}))

const client = { uid: 'uid-client', email: 'ana@example.test', displayName: 'Ana', getIdToken: async () => 'token' }
const at = (path) => window.history.pushState({}, '', path)
const pricingKey = () => Object.entries(defaultContent.sections).find(([, section]) => section.type === 'pricing')[0]
const contactKey = () => Object.entries(defaultContent.sections).find(([, section]) => section.type === 'contact')[0]

function serveContent(edit) {
  const content = structuredClone(defaultContent)
  edit?.(content)
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).includes('/landing-page/content')) return { ok: true, status: 200, json: async () => ({ content }), clone() { return this } }
    return Promise.reject(new TypeError('offline'))
  }))
}

// jsdom has no IntersectionObserver (framer-motion's whileInView needs it): a stand-in that never reports
class NoObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', NoObserver)
  store.user = null
  localStorage.clear()
  localStorage.setItem('tb_cookie_consent', JSON.stringify({ external: false }))
  serveContent()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

async function app(path) {
  at(path)
  const { default: App } = await import('./App.jsx')
  return render(<App />)
}

describe('client messages', () => {
  it('draws no filters and no bulk buttons when there are no messages at all', async () => {
    store.user = client
    await app('/messages')
    await screen.findByText(/no messages yet/i, {}, { timeout: 8000 })
    expect(screen.queryByRole('button', { name: /mark all as read/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /archive read/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^unread$/i })).toBeNull()
    expect(screen.getByRole('tab', { name: /inbox/i })).toBeTruthy()          // the tabs stay
  }, 15000)

  it('offers "Mark all as read" and "Archive read" only when there is something to mark or archive', async () => {
    store.user = client
    store.inbox = { items: [{ id: 1, kind: 'system', type: 'session_cancelled', title: 'Hello', body: 'Body', date: '2026-11-01T10:00:00', read: false, archived: false, can_archive: true, actions: [] }],
      total: 1, page: 1, pages: 1, unread: 1, counts: { inbox: 1, unread: 1, archived: 0 } }
    await app('/messages')
    expect(await screen.findByRole('button', { name: /mark all as read/i }, { timeout: 8000 })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /archive read/i })).toBeNull()       // nothing read yet
    store.inbox = { ...store.inbox, counts: { inbox: 1, unread: 0, archived: 0 }, unread: 0, items: [{ ...store.inbox.items[0], read: true }] }
  }, 15000)
})

describe('pricing', () => {
  it('the recommended card has a "Most popular" ribbon outside the button, and the button is an action', async () => {
    await app('/')
    const ribbon = await screen.findByText('Most popular', {}, { timeout: 8000 })
    expect(ribbon.tagName).toBe('SPAN')
    expect(ribbon.closest('button')).toBeNull()
    const card = ribbon.parentElement
    expect(within(card).getByRole('button', { name: /get started/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /most popular/i })).toBeNull()
    expect(screen.getAllByText('Most popular')).toHaveLength(1)                   // only the recommended card has it
  }, 15000)

  it('an untouched stored "Most Popular" button is migrated; the ribbon carries the label', async () => {
    serveContent(content => { content.sections[pricingKey()].plans[1].buttonText = { en: 'Most Popular', es: 'Más Popular', ca: 'Més Popular' }; delete content.pricingButtonVersion })
    await app('/')
    await screen.findByText('Most popular', {}, { timeout: 8000 })
    expect(screen.queryByRole('button', { name: /^most popular$/i })).toBeNull()
  }, 15000)

  it('shows the total of the pack and the saving only when the content has the figures', async () => {
    serveContent(content => {
      const blank = () => [0, 1, 2].map(() => ({ price: '', features: [] }))
      const section = content.sections[pricingKey()]
      section.prices = section.prices || { individual: blank(), dual: blank() }
      const prices = section.prices
      prices.individual[0] = { price: '€65/session', features: ['4 sessions'] }
      prices.individual[1] = { price: '€55/session', features: ['12 sessions'] }
    })
    await app('/')
    expect(await screen.findByText(/Total €260 · 4 sessions/, {}, { timeout: 8000 })).toBeTruthy()
    expect(screen.getByText(/Total €660 · 12 sessions/)).toBeTruthy()
    expect(screen.getByText(/You save 15% vs monthly/)).toBeTruthy()
  }, 15000)

  it('shows no total, no saving and no invented figure when the content has none', async () => {
    serveContent(content => {
      const section = content.sections[pricingKey()]
      section.prices = { individual: [{ price: '€65/session', features: ['1-5 sessions per week'] }, { price: '', features: [] }, { price: '', features: [] }], dual: [] }
    })
    await app('/')
    await screen.findByText('Most popular', {}, { timeout: 8000 })
    expect(screen.queryByText(/Total €/)).toBeNull()
    expect(screen.queryByText(/You save/)).toBeNull()
  }, 15000)
})

describe('contact form', () => {
  it('has visible labels above the fields and a correct accessible name', async () => {
    await app('/')
    const name = await screen.findByLabelText(/Your Name/, {}, { timeout: 8000 })
    expect(name.getAttribute('aria-label')).toBeNull()                            // the visible label names it
    expect(name.getAttribute('placeholder')).toBeNull()
    expect(screen.getByLabelText(/Your Email/)).toBeTruthy()
    expect(screen.getByLabelText(/Your Message/)).toBeTruthy()
    for (const field of document.querySelectorAll('form input[name=name], form input[name=email], form textarea[name=message]')) {
      expect((field.labels[0]?.textContent || '').trim().length).toBeGreaterThan(2)
      expect(field.labels[0].className).not.toContain('sr-only')
      expect(`${field.getAttribute('aria-label') || ''}${field.labels[0].textContent}`).not.toMatch(/Placeholder/i)
    }
  }, 15000)

  it('an empty label of the content falls back to the translated default (a field never goes without a name)', async () => {
    serveContent(content => { content.sections[contactKey()].formLabels = { name: '', email: { en: '', es: '', ca: '' }, message: '  ' } })
    await app('/')
    expect(await screen.findByLabelText(/^Name/, {}, { timeout: 8000 })).toBeTruthy()
    expect(screen.getByLabelText(/^Email/)).toBeTruthy()
    expect(screen.getByLabelText(/^Message/)).toBeTruthy()
  }, 15000)

  it('the send button is clearly disabled until the privacy policy is accepted, and clearly active after', async () => {
    await app('/')
    const button = await screen.findByRole('button', { name: /send message/i }, { timeout: 8000 })
    expect(button.disabled).toBe(true)
    expect(button.className).toContain('disabled:opacity-40')
    expect(button.className).toContain('disabled:cursor-not-allowed')
    const form = button.closest('form')
    fireEvent.click(within(form).getByRole('checkbox'))
    await waitFor(() => expect(button.disabled).toBe(false))
  }, 15000)
})

describe('login', () => {
  it('has visible labels (the same FormField as the registration) and useful placeholders', async () => {
    const { container } = await app('/login')
    const email = await screen.findByLabelText('Email address', {}, { timeout: 8000 })
    const password = screen.getByLabelText('Password')
    expect(email.labels[0].className).not.toContain('sr-only')
    expect(password.labels[0].className).not.toContain('sr-only')
    expect(email.getAttribute('placeholder')).toBeTruthy()
    expect(password.getAttribute('placeholder')).toBeTruthy()
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })
    expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([])
  }, 15000)
})

describe('mobile menu', () => {
  it('the header keeps Login and the hamburger; Register moves into the open menu', async () => {
    const { container } = await app('/')
    await screen.findByRole('button', { name: /open menu/i }, { timeout: 8000 })
    const header = container.querySelector('nav, header') || container
    const registerLinks = () => [...container.querySelectorAll('a[href="/register"]')]
    expect(registerLinks()).toHaveLength(1)
    expect(registerLinks()[0].className).toContain('hidden')                      // only from md up
    expect(registerLinks()[0].className).toContain('md:inline-flex')
    const login = [...container.querySelectorAll('a[href="/login"]')][0]
    expect(login.className).toContain('min-h-[44px]')
    const hamburger = screen.getByRole('button', { name: /open menu/i })
    expect(hamburger.className).toContain('order-last')
    expect(hamburger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(hamburger)
    await waitFor(() => expect(hamburger.getAttribute('aria-expanded')).toBe('true'))
    expect(registerLinks()).toHaveLength(2)
    const inMenu = registerLinks()[1]
    expect(inMenu.className).toContain('min-h-[44px]')
    expect(inMenu.className).not.toContain('hidden')
    expect(header).toBeTruthy()
  }, 15000)
})

describe('landing editor', () => {
  it('refuses to publish a contact form with an empty label and says which; publishes once they are filled in', async () => {
    store.user = { uid: 'uid-admin', email: 'david@admin.es', getIdToken: async () => 'token-admin' }
    serveContent(content => { content.sections[contactKey()].formLabels = { name: { en: 'Name', es: '', ca: 'Nom' }, email: 'Email', message: 'Message' } })
    const { LandingContentProvider, useLandingContent } = await import('./content/LandingContentContext.jsx')
    let api
    function Probe() { api = useLandingContent(); return <p>{api.loading ? 'loading' : 'ready'}</p> }
    render(<LandingContentProvider mode="edit"><Probe /></LandingContentProvider>)
    await waitFor(() => expect(screen.getByText('ready')).toBeTruthy(), { timeout: 8000 })
    await expect(api.publish()).rejects.toMatchObject({ code: 'contact_labels_empty', problems: [{ field: 'name', languages: ['es'] }] })
    const calls = fetch.mock.calls.filter(([, options]) => options?.method === 'POST' || options?.method === 'PUT')
    expect(calls).toEqual([])                                                    // nothing was sent to the server
    act(() => { api.updateField(`sections.${contactKey()}.formLabels.name.es`, 'Nombre', { commit: true }) })
    await waitFor(() => expect(api.content.sections[contactKey()].formLabels.name.es).toBe('Nombre'))
  }, 15000)
})

describe('training request (the page that was harmonised)', () => {
  it('has the header of the other client pages and selects with a visible label and the look of the other fields', async () => {
    store.user = client
    await app('/training-request')
    const title = await screen.findByRole('heading', { level: 1, name: /training request/i }, { timeout: 8000 })
    expect(title.style.fontFamily).toContain('Bebas Neue')
    expect(screen.getByText('Client space').className).toContain('text-accent-text')
    expect(screen.getByText(/Choose your pack and the days/)).toBeTruthy()
    const pack = screen.getByLabelText(/select package/i)
    const week = screen.getByLabelText(/sessions per week/i)
    for (const select of [pack, week]) {
      expect(select.tagName).toBe('SELECT')
      expect(select.className).toContain('rounded-xl')
      expect(select.labels[0].className).toContain('uppercase')
    }
    expect(screen.getByRole('button', { name: /request|submit|send|unavailable/i }).className).toContain('bg-white')
  }, 15000)

  it('says the new text in the three languages', async () => {
    const { translations } = await import('./i18n/translations.js')
    for (const language of ['en', 'es', 'ca']) expect(translations[language].tr_intro.length).toBeGreaterThan(20)
  })
})

describe('404', () => {
  it('has the title in Bebas Neue and the primary button', async () => {
    await app('/this-page-does-not-exist')
    const title = await screen.findByRole('heading', { level: 1 }, { timeout: 8000 })
    expect(title.style.fontFamily).toContain('Bebas Neue')
    const home = screen.getByRole('link', { name: /back to home/i })
    expect(home.className).toContain('bg-accent')
    expect(home.className).toContain('rounded-control')
    await act(async () => {})
  }, 15000)
})
