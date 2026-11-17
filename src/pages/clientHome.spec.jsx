import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../i18n/I18nContext'
import { translations } from '../i18n/translations'
import NextSessionCard from '../components/sessions/NextSessionCard'

// The client's home (Dashboard) and My Sessions: the next session card, the pack progress and the states of the home.
// Today is Tuesday 17 November 2026, 10:00 in Madrid (the clock is fixed); the server is a fake.
const store = vi.hoisted(() => ({ workflow: null, workflowStatus: 200, sessions: [], requests: [], trial: null, user: null }))
vi.mock('../firebase/authModule.js', () => ({ auth: { get currentUser() { return store.user } }, onAuthStateChanged: () => () => {}, signOut: vi.fn() }))
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), onAuthStateChanged: (auth, callback) => { setTimeout(() => callback(store.user), 0); return () => {} } }))
vi.mock('../firebase/auth', () => ({ auth: { get currentUser() { return store.user } } }))
vi.mock('../firebase/session', () => ({ loadAuthModule: async () => ({ auth: { get currentUser() { return store.user } } }), currentUser: () => store.user }))
vi.mock('../components/Navbar', () => ({ default: () => null }))
vi.mock('../components/TempPasswordNotice', () => ({ default: () => null }))
vi.mock('../components/CalendarSubscribe', () => ({ default: () => null }))

const NOW = new Date('2026-11-17T09:00:00Z')                    // 10:00 in Madrid
const day = (offset) => new Date(Date.UTC(2026, 10, 17 + offset, 12)).toISOString().slice(0, 10)
const row = (id, offset, time, packId = 1, extra = {}) => [id, day(offset), `${time}:00`, 'Leo Trainer', extra.status || 'Booked', false, extra.number || `${id}/8`, packId, extra.packName || 'Monthly Plan']
const pack = (changes = {}) => ({ id: 1, name: 'Monthly Plan', trainer: 'Leo Trainer', start_date: day(-14), end_date: '2026-12-15', done: 4, total: 8, remaining: 4, session_type: 'individual', ...changes })
const ACTIVE = (plans = [pack()]) => ({ state: 'active', plans, plan: { name: plans[0]?.name }, sessions: [], sessions_remaining: 4 })

const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, clone() { return this } })
function server() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    if (path.startsWith('/features')) return json({ client_calendar: false, reschedule_min_hours_before: 24 })
    if (path.startsWith('/users/email')) return json({ id: 7 })
    if (path.startsWith('/trainers')) return json([[1, 'Leo Trainer', '']])
    if (path.startsWith('/sessions/user')) return json(store.sessions)
    if (path.startsWith('/me/reschedule-requests')) return json({ items: store.requests, max_per_session: 1, notice_hours: 24, note_max: 300 })
    if (path.startsWith('/client/trial')) return json({ trial: store.trial })
    if (path.startsWith('/client/workflow')) return json(store.workflow, store.workflowStatus)
    return json({})
  }))
}

class NoObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
const text = (language, key, values = {}) => Object.entries(values).reduce((out, [name, value]) => out.replace(`{${name}}`, value), translations[language][key])

async function home(language = 'es', page = 'dashboard') {
  localStorage.setItem('tb_language', language)
  const module = page === 'dashboard' ? await import('./Dashboard.jsx') : await import('./MySessions.jsx')
  const Page = module.default
  const view = render(<I18nProvider><MemoryRouter><Page /></MemoryRouter></I18nProvider>)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  return view
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('IntersectionObserver', NoObserver)
  vi.stubGlobal('matchMedia', (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
  store.user = { uid: 'u', email: 'ana@example.test', displayName: 'Ana Prueba', getIdToken: async () => 'token' }
  store.workflow = ACTIVE()
  store.workflowStatus = 200
  store.sessions = [row(11, 1, '10:00'), row(12, 4, '10:00'), row(13, 8, '18:30')]
  store.requests = []
  store.trial = null
  localStorage.clear()
  server()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

const serious = (result) => result.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')
const rules = { 'color-contrast': { enabled: false }, region: { enabled: false } }

describe('NextSessionCard', () => {
  const session = { id: 1, date: '2026-11-19', time: '10:00', trainer: 'Leo Trainer', number: '2/8', packName: '' }
  const card = (props = {}) => render(<I18nProvider><MemoryRouter><NextSessionCard session={session} status="upcoming" change={{ state: 'available' }} hours={24} onOpen={() => {}} onRequest={() => {}} onCancel={() => {}} {...props} /></MemoryRouter></I18nProvider>)

  it('with only the old props it is the card My Sessions always had: no countdown, no type, no "view all" link', () => {
    localStorage.setItem('tb_language', 'en')
    card()
    expect(screen.getByRole('heading', { name: 'Next session' })).toBeTruthy()
    expect(screen.getByText('Thursday 19 November')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Request a date change' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel session' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /View all my sessions/ })).toBeNull()
    expect(screen.queryByText(/Dual|Individual/)).toBeNull()
  })

  it('shows the countdown, the type and the link when it is given them', () => {
    localStorage.setItem('tb_language', 'es')
    card({ countdown: 'en 2 días', typeLabel: 'Sesión dual', allLink: '/my-sessions', heading: 'Tu próxima sesión' })
    expect(screen.getByText('en 2 días')).toBeTruthy()
    expect(screen.getByText(/Sesión dual/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Ver todas mis sesiones/ }).getAttribute('href')).toBe('/my-sessions')
    expect(screen.getByRole('heading', { name: 'Tu próxima sesión' })).toBeTruthy()
  })

  it('inside the notice hours the change is off and says why; with a change pending it is off and says so; cancel stays as it was', () => {
    localStorage.setItem('tb_language', 'es')
    const { unmount } = card({ change: { state: 'too_late' } })
    expect(screen.getByRole('button', { name: text('es', 'ms_request_change') }).disabled).toBe(true)
    expect(screen.getByText(text('es', 'ms_too_late', { hours: 24 }))).toBeTruthy()
    expect(screen.getByRole('button', { name: text('es', 'ms_cancel_session') }).disabled).toBe(false)
    unmount()
    card({ change: { state: 'pending' }, status: 'change_pending' })
    expect(screen.getByRole('button', { name: text('es', 'ms_request_change') }).disabled).toBe(true)
    expect(screen.getAllByText('Cambio pendiente de aprobación').length).toBeGreaterThanOrEqual(1)
  })

  it('the actions call back with the session, and work with the keyboard', async () => {
    localStorage.setItem('tb_language', 'en')
    const user = userEvent.setup()
    const onRequest = vi.fn(); const onCancel = vi.fn(); const onOpen = vi.fn()
    card({ onRequest, onCancel, onOpen, allLink: '/my-sessions' })
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Request a date change' }))
    await user.keyboard('{Enter}')
    await user.tab(); await user.keyboard(' ')
    await user.tab(); await user.keyboard('{Enter}')
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /View all my sessions/ }))
    expect(onRequest).toHaveBeenCalledWith(session)
    expect(onCancel).toHaveBeenCalledWith(session)
    expect(onOpen).toHaveBeenCalledWith(session)
  })
})

describe('the client home: the four states of "Your next session"', () => {
  it('with a future session: the card with the day, the hour, the countdown, the type and the actions', async () => {
    await home('es')
    const heading = await screen.findByRole('heading', { name: 'Tu próxima sesión' })
    const section = heading.closest('section')
    expect(within(section).getByText(/miércoles,? 18 de noviembre/)).toBeTruthy()
    expect(within(section).getByText('mañana')).toBeTruthy()                         // the countdown
    expect(within(section).getByText(/Sesión individual/)).toBeTruthy()
    expect(within(section).getByRole('button', { name: 'Pedir cambio de fecha' })).toBeTruthy()
    expect(within(section).getByRole('button', { name: 'Cancelar sesión' })).toBeTruthy()
    expect(within(section).getByRole('link', { name: /Ver todas mis sesiones/ }).getAttribute('href')).toBe('/my-sessions')
    expect(screen.getByRole('heading', { level: 1, name: 'Hola, Ana' })).toBeTruthy()
  })

  it('today the countdown gives the hour; in two days it counts days', async () => {
    store.sessions = [row(11, 0, '18:00')]
    await home('es')
    expect(await screen.findByText('hoy a las 18:00')).toBeTruthy()
    cleanup()
    store.sessions = [row(11, 2, '10:00')]
    await home('es')
    expect(await screen.findByText('en 2 días')).toBeTruthy()
  })

  it('inside the 24 hours the change is off and the line under the buttons says why', async () => {
    store.sessions = [row(11, 0, '16:00')]
    await home('es')
    const button = await screen.findByRole('button', { name: 'Pedir cambio de fecha' })
    expect(button.disabled).toBe(true)
    expect(screen.getByText(text('es', 'ms_too_late', { hours: 24 }))).toBeTruthy()
  })

  it('with a change waiting for the studio: the state "Cambio pendiente de aprobación" and the change button off', async () => {
    store.requests = [{ id: 5, session_id: 11, status: 'pending', requested_date: day(2), requested_time: '10:00' }]
    await home('es')
    const section = (await screen.findByRole('heading', { name: 'Tu próxima sesión' })).closest('section')
    expect(within(section).getAllByText('Cambio pendiente de aprobación').length).toBeGreaterThanOrEqual(1)
    expect(within(section).getByRole('button', { name: 'Pedir cambio de fecha' }).disabled).toBe(true)
  })

  it('an active pack and nothing booked: one clear action, "Reservar una sesión"', async () => {
    store.sessions = []
    await home('es')
    expect(await screen.findByText('No tienes ninguna sesión reservada')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Reservar una sesión' }).getAttribute('href')).toBe('/training-request')
    expect(screen.queryByRole('button', { name: 'Cancelar sesión' })).toBeNull()
  })

  it('no active pack: "Solicitar un pack" and, if there is no trial session yet, the trial session', async () => {
    store.workflow = { state: 'new', plans: [], sessions: [], sessions_remaining: 0 }
    store.sessions = []
    await home('es')
    expect((await screen.findByRole('link', { name: 'Solicitar un pack' })).getAttribute('href')).toBe('/training-request')
    expect(screen.getByRole('link', { name: 'Reservar una sesión de prueba' }).getAttribute('href')).toBe('/trial-session')
    cleanup()
    store.trial = { status: 'pending', session_date: day(3), session_time: '10:00:00', trainer: null }
    await home('es')
    await screen.findByRole('link', { name: 'Solicitar un pack' })
    expect(screen.queryByRole('link', { name: 'Reservar una sesión de prueba' })).toBeNull()      // it already has one
  })

  it('a request waiting for the studio keeps its own card', async () => {
    store.workflow = { state: 'pending', request: { id: 9, package: 'Monthly Plan', sessions_per_week: 2 }, plans: [], sessions: [], sessions_remaining: 0 }
    await home('es')
    expect(await screen.findByText(text('es', 'dash_pending'))).toBeTruthy()
  })
})

describe('"My pack"', () => {
  it('one pack: "4 de 8 sesiones realizadas · 4 restantes", the end date and a visible bar', async () => {
    await home('es')
    const section = (await screen.findByRole('heading', { name: 'Mi pack' })).closest('section')
    expect(within(section).getByText('4 de 8 sesiones realizadas · 4 restantes')).toBeTruthy()
    expect(within(section).getByText('termina el 15 dic')).toBeTruthy()
    const bar = within(section).getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('4')
    expect(bar.getAttribute('aria-valuemax')).toBe('8')
    expect(bar.className).toContain('h-3')
    expect(bar.firstChild.className).toContain('bg-accent')
    expect(bar.firstChild.style.width).toBe('50%')
    expect(within(section).queryByRole('link', { name: 'Renovar pack' })).toBeNull()                     // far from the end: quiet
  })

  it('two sessions left or fewer: a gentle warning and "Renovar pack" that opens the pack request', async () => {
    store.workflow = ACTIVE([pack({ done: 6, remaining: 2 })])
    await home('es')
    const section = (await screen.findByRole('heading', { name: 'Mi pack' })).closest('section')
    expect(within(section).getByText('Quedan solo 2 sesiones')).toBeTruthy()
    expect(within(section).getByRole('link', { name: 'Renovar pack' }).getAttribute('href')).toBe('/training-request')
  })

  it('the pack ends in 14 days or fewer: the warning says when', async () => {
    store.workflow = ACTIVE([pack({ end_date: day(10) })])
    await home('es')
    const section = (await screen.findByRole('heading', { name: 'Mi pack' })).closest('section')
    expect(within(section).getByText('Termina en 10 días')).toBeTruthy()
    expect(within(section).getByRole('link', { name: 'Renovar pack' })).toBeTruthy()
  })

  it('several packs: one compact block each, the one that ends first on top, three at most and "Ver todos"', async () => {
    store.workflow = ACTIVE([
      pack({ id: 1, name: 'Pack C', end_date: '2027-02-01' }), pack({ id: 2, name: 'Pack A', end_date: '2026-12-20', session_type: 'dual' }),
      pack({ id: 3, name: 'Pack B', end_date: '2027-01-10' }), pack({ id: 4, name: 'Pack D', end_date: '2027-03-01' })
    ])
    const user = userEvent.setup()
    await home('es')
    const section = (await screen.findByRole('heading', { name: 'Mis packs' })).closest('section')
    const list = within(section).getByRole('list', { name: 'Paquete' })
    expect(within(list).getAllByRole('listitem').map(item => within(item).getByRole('heading').textContent)).toEqual(['Pack A', 'Pack B', 'Pack C'])
    expect(within(list).getAllByText('Dual').length).toBe(1)
    const all = within(section).getByRole('button', { name: 'Ver todos (4)' })
    expect(all.getAttribute('aria-expanded')).toBe('false')
    await user.click(all)
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    await user.click(within(section).getByRole('button', { name: 'Ver menos' }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
  })
})

describe('upcoming sessions and the calendar', () => {
  it('the list does not repeat the first session, has at most 5, and writes "vie 20 nov · 10:00"', async () => {
    store.sessions = [1, 2, 3, 4, 5, 6, 7, 8].map(index => row(20 + index, index, '10:00'))
    await home('es')
    const section = (await screen.findByRole('heading', { name: 'Próximas sesiones' })).closest('section')
    const items = within(section).getAllByRole('listitem')
    expect(items).toHaveLength(5)
    expect(items[0].textContent).toContain('jue 19 nov · 10:00')                       // the first one (Wednesday 18) is the big card
    expect(items.map(item => item.textContent).join('')).not.toContain('mié 18 nov')
    expect(within(section).getByRole('link', { name: 'Ver todas las sesiones' }).getAttribute('href')).toBe('/my-sessions')
  })

  it('the three languages: day, hour and countdown', async () => {
    store.sessions = [row(11, 1, '10:00'), row(12, 3, '10:00')]
    await home('en')
    expect(await screen.findByText('tomorrow')).toBeTruthy()
    expect(screen.getByText('Fri 20 Nov · 10:00')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Your next session' })).toBeTruthy()
    cleanup()
    await home('ca')
    expect(await screen.findByText('demà')).toBeTruthy()
    expect(screen.getByText('dv 20 nov · 10:00')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'La teva propera sessió' })).toBeTruthy()
    expect(screen.getByText('acaba el 15 des')).toBeTruthy()
  })

  it('a phone keeps the calendar closed until it is asked for; the button says so and is reachable', async () => {
    const user = userEvent.setup()
    await home('es')
    const button = await screen.findByRole('button', { name: 'Mostrar el calendario' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById('dash-calendar').className).toContain('hidden')
    await user.click(button)
    expect(screen.getByRole('button', { name: 'Ocultar el calendario' }).getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById('dash-calendar').className).not.toContain('hidden lg:block')
  })
})

describe('loading and errors', () => {
  it('while loading there are skeletons (card, bar and list), not a spinner and not a line of text', async () => {
    let release
    vi.stubGlobal('fetch', vi.fn((url) => (String(url).includes('/client/workflow') ? new Promise(resolve => { release = () => resolve(json(store.workflow)) }) : Promise.resolve(json({})))))
    const { container } = await home('es')
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(6)
    expect(screen.getByRole('status', { name: translations.es.dash_loading })).toBeTruthy()
    expect(container.querySelector('.animate-spin')).toBeNull()
    await act(async () => { release?.() })
  })

  it('an error says it clearly with "Reintentar", keeps the header and recovers', async () => {
    store.workflowStatus = 500
    await home('es')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(translations.es.dash_unavailable)
    expect(screen.getByRole('heading', { level: 1, name: 'Hola, Ana' })).toBeTruthy()             // the rest of the page stays
    store.workflowStatus = 200
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: translations.es.pg_try_again }))
    expect(await screen.findByRole('heading', { name: 'Tu próxima sesión' })).toBeTruthy()
  })

  it('has no serious accessibility violations, in the three languages', async () => {
    for (const language of ['es', 'en', 'ca']) {
      const { container, unmount } = await home(language)
      await screen.findByRole('heading', { name: text(language, 'dash_next_title') })
      const result = await axe.run(container, { rules })
      expect(serious(result).map(violation => `${language} ${violation.id}: ${violation.nodes[0]?.html?.slice(0, 100)}`)).toEqual([])
      unmount()
    }
  })

  it('the cancel action opens the confirmation (the same flow as My Sessions) and the keyboard reaches every action', async () => {
    const user = userEvent.setup()
    await home('es')
    const cancel = await screen.findByRole('button', { name: 'Cancelar sesión' })
    cancel.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })
})

describe('My Sessions keeps its card and gets the better progress', () => {
  it('the same card (no countdown, no "view all" link), the progress in the new format', async () => {
    store.sessions = [row(10, -3, '10:00'), row(11, -1, '10:00'), row(12, 1, '10:00'), row(13, 3, '10:00')]
    store.workflow = ACTIVE([pack({ end_date: '2026-12-15' })])
    await home('es', 'mysessions')
    const heading = await screen.findByRole('heading', { name: 'Próxima sesión' })
    const card = heading.closest('section')
    expect(within(card).queryByRole('link', { name: /Ver todas mis sesiones/ })).toBeNull()
    expect(within(card).queryByText('mañana')).toBeNull()
    expect(within(card).getByRole('button', { name: 'Pedir cambio de fecha' })).toBeTruthy()
    expect(await screen.findByText('2 de 4 sesiones realizadas · 2 restantes')).toBeTruthy()
    expect(screen.getByText('termina el 15 dic')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Tu progreso' }).className).toContain('h-3')
  })
})
