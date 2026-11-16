import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from './i18n/I18nContext'
import { useModalFocus } from './hooks/useModalFocus'

vi.mock('firebase/auth', () => ({
  signInWithPopup: vi.fn(),
  signInWithEmailAndPassword: vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'auth/invalid-email' }) }),
  createUserWithEmailAndPassword: vi.fn(),
  updateProfile: vi.fn(),
  sendEmailVerification: vi.fn(),
}))
vi.mock('./firebase/auth', () => ({ auth: { currentUser: null }, googleProvider: {} }))

import Login from './pages/Login'
import Register from './pages/Register'
import LanguageSwitcher from './components/LanguageSwitcher'

// jsdom has no layout: every element would count as hidden for the focus trap (it skips controls without an offsetParent)
Object.defineProperty(HTMLElement.prototype, 'offsetParent', { get() { return this.parentNode } })

afterEach(() => { cleanup(); localStorage.clear() })

const page = (ui) => render(<MemoryRouter><I18nProvider>{ui}</I18nProvider></MemoryRouter>)

// Structural rules only: contrast and layout need a real browser.
async function violations(container) {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })
  return result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes.map(n => n.target).join(' | ')}`)
}

describe('axe: no serious or critical problems', () => {
  it('login', async () => {
    const { container } = page(<Login />)
    expect(await violations(container)).toEqual([])
  })
  it('registration', async () => {
    const { container } = page(<Register />)
    expect(await violations(container)).toEqual([])
  })
})

describe('forms', () => {
  it('after a failed login the focus goes to the first field to fix, and the error is announced', async () => {
    const user = userEvent.setup()
    page(<Login />)
    await user.type(screen.getByLabelText('Email address'), 'ana@example.test')
    await user.type(screen.getByLabelText('Password'), 'secret')
    await user.click(screen.getByRole('button', { name: /sign in|login/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Email address')))
    expect(screen.getByLabelText('Email address').getAttribute('aria-describedby')).toBe(alert.id)
  })
})

function Menu() {
  return <LanguageSwitcher />
}

function Dialog() {
  const [open, setOpen] = useState(false)
  const ref = useModalFocus(open, () => setOpen(false))
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      {open && (
        <div ref={ref} role="dialog" aria-modal="true" aria-label="Test dialog" tabIndex={-1}>
          <button>one</button>
          <button>two</button>
        </div>
      )}
    </>
  )
}

describe('keyboard', () => {
  it('the language menu opens from the keyboard and tells its state', async () => {
    const user = userEvent.setup()
    page(<Menu />)
    const button = screen.getByRole('button', { name: 'Change language' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    await user.tab()
    expect(document.activeElement).toBe(button)
    await user.keyboard('{Enter}')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    await user.tab()
    expect(document.activeElement.textContent).toContain('English')
  })

  it('a dialog takes the focus, keeps Tab inside, closes with Esc and gives the focus back', async () => {
    const user = userEvent.setup()
    render(<Dialog />)
    const opener = screen.getByText('open')
    opener.focus()
    await user.keyboard('{Enter}')
    expect(document.activeElement.textContent).toBe('one')
    await user.tab(); expect(document.activeElement.textContent).toBe('two')
    await user.tab(); expect(document.activeElement.textContent).toBe('one')      // the loop: it does not leave the dialog
    await user.tab({ shift: true }); expect(document.activeElement.textContent).toBe('two')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})
