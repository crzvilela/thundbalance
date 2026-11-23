import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import axe from 'axe-core'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../i18n/I18nContext'
import { RolesContext } from '../roles/rolesContext'
import { setUnread } from '../hooks/useUnreadCount'
import { isClientAreaPath } from '../utils/clientArea'
import BottomNav from './BottomNav'

// The bottom navigation of the client area on a phone: where it shows, what it says in the three languages, the unread count, the active place, the room it leaves.
const roles = (status = 'ready', extra = {}) => ({ status, roles: { is_admin: false, is_trainer: false }, isTrainer: false, isTrainerOnly: false, reload() {}, ...extra })

function show(path, value = roles(), language = 'es') {
  localStorage.setItem('tb_language', language)
  return render(
    <I18nProvider><RolesContext.Provider value={value}><MemoryRouter initialEntries={[path]}><BottomNav /></MemoryRouter></RolesContext.Provider></I18nProvider>
  )
}

beforeEach(() => { localStorage.clear(); setUnread(0) })
afterEach(() => { cleanup(); document.body.className = '' })

describe('BottomNav', () => {
  it('has the four places of the client area, with text, in Spanish', () => {
    show('/dashboard')
    const nav = screen.getByRole('navigation', { name: 'Área de cliente' })
    expect(within(nav).getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Inicio', '/dashboard'], ['Sesiones', '/my-sessions'], ['Mensajes', '/messages'], ['Perfil', '/profile'],
    ])
    expect(nav.className).toContain('md:hidden')                              // from a tablet up the top menu has it all
    expect(nav.className).toContain('env(safe-area-inset-bottom)')            // above the home bar of the phone
  })

  it.each([['en', ['Home', 'Sessions', 'Messages', 'Profile']], ['ca', ['Inici', 'Sessions', 'Missatges', 'Perfil']]])('in %s', (language, labels) => {
    show('/my-sessions', roles(), language)
    expect(within(screen.getByRole('navigation')).getAllByRole('link').map(link => link.textContent)).toEqual(labels)
  })

  it('marks the open place (aria-current) and nothing else', () => {
    show('/my-sessions')
    const links = within(screen.getByRole('navigation')).getAllByRole('link')
    expect(links.map(link => link.getAttribute('aria-current'))).toEqual([null, 'page', null, null])
    expect(links[1].className).toContain('text-emerald-300')
  })

  it('shows the number of unread messages in a badge and says it to a screen reader', () => {
    show('/dashboard')
    expect(within(screen.getByRole('navigation')).queryByText('3')).toBeNull()
    act(() => setUnread(3))
    const messages = screen.getByRole('link', { name: /Mensajes/ })
    expect(within(messages).getByText('3')).toBeTruthy()
    expect(messages.getAttribute('aria-label')).toMatch(/Mensajes, .*3/)
    act(() => setUnread(120))
    expect(within(screen.getByRole('link', { name: /Mensajes/ })).getByText('99+')).toBeTruthy()
  })

  it('leaves room at the bottom of the page while it shows, and gives it back when it goes', () => {
    const { unmount } = show('/dashboard')
    expect(document.body.classList.contains('has-bottom-nav')).toBe(true)
    unmount()
    expect(document.body.classList.contains('has-bottom-nav')).toBe(false)
  })

  it.each(['/', '/login', '/privacy', '/admin', '/trainer', '/trial-session'])('is not on %s', (path) => {
    show(path)
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(document.body.classList.contains('has-bottom-nav')).toBe(false)
  })

  it('is not for a visitor, for somebody whose roles are still loading, or for a trainer who is not the administrator', () => {
    show('/dashboard', roles('signed-out'))
    expect(screen.queryByRole('navigation')).toBeNull()
    cleanup()
    show('/dashboard', roles('loading'))
    expect(screen.queryByRole('navigation')).toBeNull()
    cleanup()
    show('/dashboard', roles('ready', { isTrainer: true, isTrainerOnly: true }))
    expect(screen.queryByRole('navigation')).toBeNull()
    cleanup()
    show('/dashboard', roles('error'))                                          // signed in, roles not known: the client area as always
    expect(screen.getByRole('navigation')).toBeTruthy()
  })

  it('knows the pages of the client area', () => {
    for (const path of ['/dashboard', '/my-sessions', '/messages', '/profile', '/training-request', '/messages/3']) expect(isClientAreaPath(path), path).toBe(true)
    for (const path of ['/', '/login', '/dashboard-admin', '/trainer', '/profile-x']) expect(isClientAreaPath(path), path).toBe(false)
  })

  it('has no serious accessibility violations and every place is at least 44 px high', async () => {
    const { container } = show('/dashboard')
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })
    expect(result.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])
    for (const link of screen.getAllByRole('link')) expect(link.className).toContain('min-h-[56px]')
  })
})
