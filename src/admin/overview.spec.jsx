import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useAdminText } from './useAdminText.js'

// The "Hoy" Overview and the grouped menu (Prompt 81), through the real AdminLayout and Overview with a fake server.
const store = vi.hoisted(() => ({ today: null, todayStatus: 200, settings: {}, calls: [] }))
vi.mock('../firebase/session', () => ({ loadAuthModule: async () => ({ auth: { currentUser: { email: 'david@admin.es', getIdToken: async () => 'token' } } }) }))
vi.mock('../firebase/auth', () => ({ auth: { currentUser: { email: 'david@admin.es' } } }))
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }))

const TODAY = {
  date: '2026-11-17', sessions_today: { total: 2, items: [
    { id: 's1', kind: 'session', time: '09:00', client: 'Ana Prueba', trainer: 'Leo', status: 'booked' },
    { id: 't2', kind: 'trial', time: '11:30', client: 'Bruno Prueba', trainer: 'Mia', status: 'pending' }
  ] },
  pending_requests: 3, pending_trials: 1, unread_messages: 2, pending_deletions: 0, expiring_packs: 4, email: { ready: false, reason: 'unauthorized' }, new_errors: 2, legal_needs_attention: true
}
const CLEAR = { ...TODAY, sessions_today: { total: 0, items: [] }, pending_requests: 0, pending_trials: 0, unread_messages: 0, expiring_packs: 0, email: { ready: true, reason: '' }, new_errors: 0, legal_needs_attention: false }

const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data })
function server() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    store.calls.push(path)
    if (path.startsWith('/admin/overview/today')) return json(store.today, store.todayStatus)
    if (path.startsWith('/admin/ui-settings')) return json(store.settings)
    if (path.startsWith('/admin/stats')) return json({ users: 12, trainers: 3, sessions: 40 })
    if (path.startsWith('/admin/contact-messages/count')) return json({ inbox: 2, unread: 2, archived: 0 })
    if (path.startsWith('/admin/reschedule-requests/count')) return json({ pending: 0, counter_proposed: 0, open: 0 })
    if (path.startsWith('/admin/deletion-requests')) return json({ items: [] })
    return json([])
  }))
}

class NoObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }

// the admin language is a module-level value: a tiny component sets it for the test
function Language({ code }) {
  const { setLanguage } = useAdminText()
  useEffect(() => { setLanguage(code) }, [code, setLanguage])
  return null
}

async function open(language = 'es') {
  const { default: AdminLayout } = await import('./AdminLayout.jsx')
  const { default: Overview } = await import('./pages/Overview.jsx')
  const view = render(
    <MemoryRouter initialEntries={['/admin']}>
      <Language code={language} />
      <Routes><Route path="/admin" element={<AdminLayout />}><Route index element={<Overview />} /></Route></Routes>
    </MemoryRouter>
  )
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return view
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', NoObserver)
  vi.stubGlobal('matchMedia', (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
  Element.prototype.scrollBy = vi.fn()
  store.today = structuredClone(TODAY)
  store.todayStatus = 200
  store.settings = {}
  store.calls = []
  localStorage.clear()
  server()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const serious = (result) => result.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')
const rules = { 'color-contrast': { enabled: false }, region: { enabled: false } }          // jsdom has no layout: contrast is audited in a real browser

describe('Overview "Hoy"', () => {
  it('opens with Hoy, the date in full and what to do today, before everything else', async () => {
    const { container } = await open('es')
    expect(await screen.findByRole('heading', { level: 1, name: 'Hoy' })).toBeTruthy()
    expect(container.querySelector('main h1 + p')?.textContent).toMatch(/^[a-záéíóú]+, \d{1,2} de [a-z]+$/)
    const strip = await screen.findByRole('list', { name: 'Qué hacer hoy' })
    const cards = within(strip).getAllByRole('link')
    expect(cards.map(card => card.textContent)).toEqual([
      expect.stringContaining('3Pedidos pendientes'), expect.stringContaining('1Pruebas por aprobar'), expect.stringContaining('2Sesiones de hoy'), expect.stringContaining('2Mensajes sin leer')
    ])
    expect(cards.map(card => card.getAttribute('href'))).toEqual(['/admin/requests', '/admin/trials', '/admin/calendar?view=timeGridDay&date=2026-11-17', '/admin/messages'])
    // the order of the page: header, strip, today's sessions, warnings, KPIs, ...
    const headings = [...container.querySelectorAll('main h2')].map(heading => heading.textContent.replace(/\s+/g, ' ').trim())
    expect(headings.slice(0, 3)).toEqual(['Qué hacer hoy', expect.stringMatching(/^Sesiones de hoy/), expect.stringMatching(/^Avisos \(\d\)/)])
    expect(headings.indexOf('Sesiones de esta semana')).toBeGreaterThan(2)
  })

  it('in English: Today, What to do today, Today\'s sessions, Warnings', async () => {
    await open('en')
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeTruthy()
    expect(await screen.findByRole('list', { name: 'What to do today' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Today's sessions/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Warnings \(\d\)/ })).toBeTruthy()
  })

  it('lists today\'s sessions with hour, client, trainer and state, and says so when there are none', async () => {
    await open('es')
    const list = await screen.findByRole('list', { name: 'Sesiones de hoy' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('09:00')
    expect(rows[0].textContent).toContain('Ana Prueba')
    expect(rows[0].textContent).toContain('Leo')
    expect(rows[1].textContent).toContain('Bruno Prueba')
    expect(rows[1].textContent).toMatch(/Prueba · Pendiente/)
    const card = list.closest('div.p-6')
    expect(within(card).getByRole('link', { name: /Ver todas/ }).getAttribute('href')).toBe('/admin/calendar?view=timeGridDay&date=2026-11-17')
    cleanup()
    store.today = structuredClone(CLEAR)
    await open('es')
    const empty = await screen.findByText('Hoy no hay sesiones')
    expect(within(empty.closest('div.p-6')).queryByRole('link', { name: /Ver todas/ })).toBeNull()
  })

  it('shows at most 8 sessions and says how many more there are', async () => {
    store.today.sessions_today = { total: 11, items: Array.from({ length: 11 }, (_, index) => ({ id: `s${index}`, kind: 'session', time: `${String(8 + index).padStart(2, '0')}:00`, client: `Cliente ${index}`, trainer: 'Leo', status: 'booked' })) }
    await open('es')
    const list = await screen.findByRole('list', { name: 'Sesiones de hoy' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(8)
    expect(screen.getByText(/\+3 más hoy/)).toBeTruthy()
  })

  it('everything at zero says "Todo al día" and the cards are neutral with "Sin pendientes"', async () => {
    store.today = structuredClone(CLEAR)
    await open('es')
    const clear = await screen.findByText('Todo al día', { selector: '#ov-strip-title ~ div p' })
    expect(clear.closest('section').querySelector('ul')).toBeNull()             // no cards: the positive empty state
    cleanup()
    store.today = { ...structuredClone(CLEAR), pending_requests: 0, unread_messages: 1 }
    await open('es')
    const strip = await screen.findByRole('list', { name: 'Qué hacer hoy' })
    const links = within(strip).getAllByRole('link')
    expect(links[0].textContent).toContain('Sin pendientes')                         // zero: neutral
    expect(links[0].className).not.toContain('amber')
    expect(links[3].className).toContain('amber')                                    // something waiting: highlighted
  })

  it('the deletion requests card is there only when there is one, and the warnings link to it', async () => {
    await open('es')
    const strip = await screen.findByRole('list', { name: 'Qué hacer hoy' })
    expect(within(strip).queryByText('Eliminaciones pendientes')).toBeNull()
    cleanup()
    store.today.pending_deletions = 2
    await open('es')
    const again = await screen.findByRole('list', { name: 'Qué hacer hoy' })
    const card = within(again).getByText('Eliminaciones pendientes').closest('a')
    expect(card.getAttribute('href')).toBe('/admin#deletion-requests')
  })

  it('the warnings are ONE collapsed line: the count and the most serious one; open they list every warning with its link', async () => {
    const user = userEvent.setup()
    await open('es')
    const toggle = await screen.findByRole('button', { name: /Mostrar los avisos/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('heading', { name: /Avisos \(4\)/ })).toBeTruthy()      // email, errors, legal, packs
    expect(toggle.textContent).toContain('El envío de emails no funciona')         // the most serious one
    expect(screen.queryByRole('list', { name: 'Avisos' })).toBeNull()
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const list = screen.getByRole('list', { name: 'Avisos' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items.map(item => within(item).getByRole('link').getAttribute('href'))).toEqual(['/admin/trials', '/admin/system', '/admin/legal', '/admin/clients'])
    expect(items[0].textContent).toContain('El envío de emails no funciona')
    expect(items[1].textContent).toContain('2 error(es) nuevo(s)')
    expect(items[3].textContent).toContain('4 cliente(s)')
    // there are no loose banners at the top any more
    expect(screen.queryByText('Completa y revisa los textos legales.')).toBeNull()
    await user.click(toggle)
    expect(screen.queryByRole('list', { name: 'Avisos' })).toBeNull()
  })

  it('with no warnings: a quiet "Todo en orden" and nothing to open', async () => {
    store.today = structuredClone(CLEAR)
    await open('es')
    expect(await screen.findByText('Todo en orden')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /avisos/i })).toBeNull()
  })

  it('a failing summary shows a clear error with "Reintentar" and the rest of the page stays', async () => {
    store.todayStatus = 500
    store.today = { detail: 'boom' }
    await open('es')
    const alerts = await screen.findAllByText('No pudimos cargar el resumen de hoy.')
    expect(alerts.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('heading', { name: 'Sesiones de esta semana' })).toBeTruthy()      // the old blocks are still there
    store.todayStatus = 200
    store.today = structuredClone(TODAY)
    const retry = screen.getAllByRole('button', { name: 'Reintentar' })[0]
    await act(async () => { fireEvent.click(retry) })
    expect(await screen.findByRole('list', { name: 'Qué hacer hoy' })).toBeTruthy()
  })

  it('while it loads there are skeletons, no spinners', async () => {
    let release
    vi.stubGlobal('fetch', vi.fn((url) => (String(url).includes('/admin/overview/today') ? new Promise(resolve => { release = () => resolve(json(TODAY)) }) : Promise.resolve(json([])))))
    const { container } = await open('es')
    await waitFor(() => expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(3))
    expect(container.querySelector('.animate-spin')).toBeNull()
    await act(async () => { release?.() })
  })

  it('has no serious accessibility violations', async () => {
    const { container } = await open('es')
    await screen.findByRole('list', { name: 'Qué hacer hoy' })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    const result = await axe.run(container, { rules })
    expect(serious(result).map(violation => `${violation.id}: ${violation.nodes[0]?.html?.slice(0, 120)}`)).toEqual([])
  })

  it('an old saved configuration keeps its names and what it hid; the new blocks appear at their default place', async () => {
    store.settings = { version: 3, overview: [{ key: 'stat_clients' }, { key: 'stat_sessions', hidden: true }, { key: 'stat_pending' }, { key: 'week', title: 'Mi semana' }, { key: 'pending' }, { key: 'business' }, { key: 'upcoming' }, { key: 'quick', hidden: true }] }
    const { container } = await open('es')
    await screen.findByRole('list', { name: 'Qué hacer hoy' })
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Mi semana' })).toBeTruthy())
    const headings = [...container.querySelectorAll('main h2')].map(heading => heading.textContent)
    expect(headings[0]).toBe('Qué hacer hoy')
    expect(screen.queryByRole('heading', { name: 'Atajos' })).toBeNull()
  })
})

describe('grouped menu', () => {
  const groupsOf = (nav) => [...nav.querySelectorAll('ul[aria-label]')].map(list => [list.getAttribute('aria-label'), [...list.querySelectorAll('a')].map(link => link.getAttribute('href'))])

  it('is split into Hoy, Personas, Agenda, Oferta and Sistema, each a labelled list', async () => {
    await open('es')
    const nav = (await screen.findAllByRole('navigation', { name: 'Admin' }))[0]
    expect(groupsOf(nav)).toEqual([
      ['Hoy', ['/admin', '/admin/requests', '/admin/trials', '/admin/messages', '/admin/sent-messages']],
      ['Personas', ['/admin/clients', '/admin/trainers']],
      ['Agenda', ['/admin/calendar', '/admin/schedule']],
      ['Oferta', ['/admin/plans', '/admin/videos', '/admin/landing-editor']],
      ['Sistema', ['/admin/system', '/admin/legal']]
    ])
    // the small titles are in capitals (CSS) and are not read twice
    const titles = [...nav.querySelectorAll('p[aria-hidden="true"]')].map(title => title.textContent)
    expect(titles).toEqual(['Hoy', 'Personas', 'Agenda', 'Oferta', 'Sistema'])
  })

  it('in English: Today, People, Agenda, Offer, System', async () => {
    await open('en')
    const nav = (await screen.findAllByRole('navigation', { name: 'Admin' }))[0]
    expect(groupsOf(nav).map(([name]) => name)).toEqual(['Today', 'People', 'Agenda', 'Offer', 'System'])
  })

  it('a group whose entries are all hidden loses its title too; an old crossed order is put in its groups', async () => {
    store.settings = { version: 2, menu: ['videos', 'schedule', 'legal', 'clients', 'overview', 'landing', 'calendar', 'requests', 'system', 'trainers', 'plans', 'messages', 'trials', 'sent-messages'].map(key => ({ key, ...(key === 'clients' || key === 'trainers' ? { hidden: true } : {}) })) }
    await open('es')
    const nav = (await screen.findAllByRole('navigation', { name: 'Admin' }))[0]
    await waitFor(() => expect(groupsOf(nav).map(([name]) => name)).toEqual(['Hoy', 'Agenda', 'Oferta', 'Sistema']))
    expect(groupsOf(nav)[0][1]).toEqual(['/admin', '/admin/requests', '/admin/messages', '/admin/trials', '/admin/sent-messages'])
    expect(nav.textContent).not.toContain('Personas')
  })

  it('the phone drawer has the same groups', async () => {
    const user = userEvent.setup()
    await open('es')
    await screen.findAllByRole('navigation', { name: 'Admin' })
    await user.click(screen.getByRole('button', { name: /menu|menú/i }))
    const navs = await screen.findAllByRole('navigation', { name: 'Admin' })
    expect(navs.length).toBe(2)                                          // the side panel and the drawer
    expect(groupsOf(navs[1]).map(([name]) => name)).toEqual(['Hoy', 'Personas', 'Agenda', 'Oferta', 'Sistema'])
    expect(groupsOf(navs[1])).toEqual(groupsOf(navs[0]))
  })

  it('keyboard: Tab goes through every link in the order of the groups', async () => {
    const user = userEvent.setup()
    await open('es')
    const nav = (await screen.findAllByRole('navigation', { name: 'Admin' }))[0]
    const expected = [...nav.querySelectorAll('a')].map(link => link.getAttribute('href'))
    nav.querySelector('a').focus()
    const visited = [nav.querySelector('a').getAttribute('href')]
    for (let step = 1; step < expected.length; step += 1) { await user.tab(); visited.push(document.activeElement.getAttribute('href')) }
    expect(visited).toEqual(expected)
    expect(expected).toHaveLength(14)
  })

  it('has no serious accessibility violations', async () => {
    await open('es')
    const nav = (await screen.findAllByRole('navigation', { name: 'Admin' }))[0]
    const result = await axe.run(nav, { rules })
    expect(serious(result).map(violation => violation.id)).toEqual([])
  })
})

describe('customising: groups and protected blocks', () => {
  const groupLinks = (nav, title) => [...nav.querySelector(`ul[aria-label="${title}"]`).querySelectorAll('li > a')].map(link => link.getAttribute('href'))

  async function edit() {
    const user = userEvent.setup()
    await open('es')
    await screen.findByRole('list', { name: 'Qué hacer hoy' })
    await user.click(screen.getByRole('button', { name: /Personalizar panel/ }))
    const nav = (await screen.findAllByRole('navigation', { name: 'Admin' }))[0]
    return { user, nav }
  }

  it('in edit mode the buttons reorder only inside the group: the first of a group cannot go up, the last cannot go down', async () => {
    const { user, nav } = await edit()
    const button = (name) => within(nav).getByRole('button', { name })
    expect(button('Subir: Clientes').disabled).toBe(true)                    // first of Personas: the group above is Hoy
    expect(button('Bajar: Clientes').disabled).toBe(false)
    expect(button('Bajar: Mensajes enviados').disabled).toBe(true)           // last of Hoy: not into Personas
    expect(button('Bajar: Textos legales').disabled).toBe(true)              // last of the last group: not past the fixed button
    await user.click(button('Bajar: Clientes'))
    expect(groupLinks(nav, 'Personas')).toEqual(['/admin/trainers', '/admin/clients'])
    expect(groupLinks(nav, 'Hoy')).toHaveLength(5)                           // nothing moved between groups
    expect(button('Subir: Clientes').disabled).toBe(false)
    expect(nav.textContent).toContain('Personas')
    expect(within(nav).queryByRole('button', { name: /Renombrar: Personas/ })).toBeNull()      // the titles of the groups are fixed
  })

  it('the Overview and the editor entry cannot be hidden; the protected blocks of the Overview show a lock instead of the eye', async () => {
    const { user } = await edit()
    expect(screen.queryByRole('button', { name: /Ocultar: Resumen/ })).toBeNull()
    expect(screen.getAllByRole('img', { name: /No se puede ocultar|no se puede ocultar|Este elemento no se puede ocultar/ }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('img', { name: /Este elemento no se puede ocultar.: Qué hacer hoy/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Ocultar: Qué hacer hoy/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Ocultar: Avisos/ })).toBeNull()
    const hide = screen.getByRole('button', { name: /Ocultar: Sesiones de hoy/ })                  // this one can be hidden
    await user.click(hide)
    expect(screen.getByRole('button', { name: /Mostrar: Sesiones de hoy/ })).toBeTruthy()
  })

  it('the advanced editor lists the menu by group, with a title and a list each, and the protected blocks of the Overview locked', async () => {
    const { user } = await edit()
    await user.click(screen.getByRole('button', { name: 'Abrir el editor avanzado' }))
    const drawer = await screen.findByRole('dialog')
    const titles = [...drawer.querySelectorAll('h3')].map(title => title.textContent)
    expect(titles).toEqual(['Hoy', 'Personas', 'Agenda', 'Oferta', 'Sistema'])
    const people = within(drawer).getByRole('list', { name: 'Personas' })
    expect(within(people).getByRole('button', { name: 'Subir: Clientes' }).disabled).toBe(true)
    expect(within(people).getByRole('button', { name: 'Bajar: Clientes' }).disabled).toBe(false)
    await user.click(within(people).getByRole('button', { name: 'Bajar: Clientes' }))
    expect([...people.querySelectorAll('li p.font-medium, li p span.truncate')].map(node => node.textContent)).toContain('Entrenadores')
    await user.click(within(drawer).getByRole('tab', { name: /Resumen|Overview|Panel inicial/i }))
    const overview = within(drawer).getByRole('list', { name: /Resumen|Overview|Panel inicial/i })
    const strip = within(overview).getByText('Qué hacer hoy').closest('li')
    expect(within(strip).queryByRole('button', { name: /Ocultar/ })).toBeNull()                    // locked
    await user.click(within(overview).getByText('Sesiones de hoy').closest('li').querySelector('button[aria-label^="Ocultar"]'))
    expect(within(overview).getByText('Sesiones de hoy').closest('li').querySelector('button[aria-label^="Mostrar"]')).toBeTruthy()
  })
})
