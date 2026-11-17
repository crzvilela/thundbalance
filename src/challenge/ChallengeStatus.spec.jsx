import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { I18nProvider } from '../i18n/I18nContext'
import ChallengeStatus from './ChallengeStatus'
import { useChallenge } from './useChallenge'
import { findNumber } from './sha256.js'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })

function Form() {
  const guard = useChallenge({ auto: true })
  return <form><label htmlFor="x">Name</label><input id="x" /><ChallengeStatus guard={guard} /><button type="submit">Send</button></form>
}

const page = () => render(<I18nProvider><Form /></I18nProvider>)

describe('the automatic check under a form', () => {
  it('says nothing when the check is ready, in a polite status region that takes no room', async () => {
    const salt = 'abcdef0123456789abcdef01'
    const { createHash } = await import('node:crypto')
    const ch = { id: 'i', salt, challenge: createHash('sha256').update(`${salt}77`).digest('hex'), max: 500, iat: 1, exp: 2, sig: 's' }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ch })))
    expect(findNumber(ch)).toBe(77)
    const { container } = page()
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    await waitFor(() => expect(status.className).toContain('sr-only'))
    expect(status.textContent).toBe('')                         // nothing at all: no "ready" line
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  })

  it('only speaks when the check takes more than 3 seconds, and then it says it is checking', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))          // the server never answers
    page()
    const status = screen.getByRole('status')
    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(status.textContent).toBe('')
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(status.textContent).toContain('Checking that you are a person')
    vi.useRealTimers()
  })

  it('shows an error with a Retry button that works with the keyboard and tries again', async () => {
    const user = userEvent.setup()
    const fetcher = vi.fn(() => Promise.reject(new TypeError('offline')))
    vi.stubGlobal('fetch', fetcher)
    page()
    const retry = await screen.findByRole('button', { name: 'Retry' })
    const before = fetcher.mock.calls.length
    retry.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThan(before))
    expect(screen.getByRole('status').textContent).toContain('could not be completed')
  })

  it('a browser without what it needs gets a clear message', async () => {
    vi.stubGlobal('TextEncoder', undefined)
    page()
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('JavaScript turned on'))
  })
})
