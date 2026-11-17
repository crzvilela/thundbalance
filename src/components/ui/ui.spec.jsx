import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { MemoryRouter, Link } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, FormField, Input, Modal, PageHeader, Select, Skeleton, SkeletonCard, SkeletonList } from './index.js'

// The base components of the design system (docs/DESIGN_SYSTEM.md).
afterEach(cleanup)

describe('Button', () => {
  it('has a variant and a size, a default type of "button" and a visible focus ring', () => {
    render(<Button variant="primary" size="lg">Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.getAttribute('type')).toBe('button')
    expect(button.className).toContain('bg-accent')
    expect(button.className).toContain('rounded-control')
    expect(button.className).toContain('min-h-[44px]')                                 // a touch target of 44 px
    expect(button.className).toContain('focus-visible:outline-accent')
  })

  it.each([['primary', 'bg-accent'], ['light', 'bg-white'], ['secondary', 'border-line-strong'], ['ghost', 'text-gray-300'], ['danger', 'bg-danger'], ['outline', 'hover:bg-white']])('variant %s', (variant, expected) => {
    render(<Button variant={variant}>x</Button>)
    expect(screen.getByRole('button').className).toContain(expected)
  })

  it('loading: spinner, aria-busy, disabled, and it does not fire a second click', async () => {
    const onClick = vi.fn()
    const { rerender } = render(<Button onClick={onClick}>Send</Button>)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(<Button onClick={onClick} loading>Send</Button>)
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.disabled).toBe(true)
    expect(button.querySelector('.animate-spin')).toBeTruthy()
    expect(button.className).toContain('cursor-wait')
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disabled looks disabled and does nothing', async () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>Off</Button>)
    const button = screen.getByRole('button')
    expect(button.disabled).toBe(true)
    expect(button.className).toContain('disabled:opacity-50')
    expect(button.className).toContain('disabled:cursor-not-allowed')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('works with the keyboard: Tab reaches it, Enter and Space activate it', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button'))
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('draws a link when it is given one (as={Link}): a real <a>, with aria-disabled and no navigation while blocked', async () => {
    const { rerender } = render(<MemoryRouter><Button as={Link} to="/profile" variant="secondary">Profile</Button></MemoryRouter>)
    const link = screen.getByRole('link', { name: 'Profile' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/profile')
    expect(link.getAttribute('type')).toBeNull()
    expect(link.getAttribute('aria-disabled')).toBeNull()
    rerender(<MemoryRouter><Button as={Link} to="/profile" disabled>Profile</Button></MemoryRouter>)
    const blocked = screen.getByRole('link', { name: 'Profile' })
    expect(blocked.getAttribute('aria-disabled')).toBe('true')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    blocked.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('plain + none draws nothing of its own (tabs, toggles) but keeps the behaviour', () => {
    render(<Button variant="plain" size="none" className="custom" aria-pressed="true">Tab</Button>)
    const button = screen.getByRole('button')
    expect(button.className).not.toContain('inline-flex')
    expect(button.className).not.toContain('bg-accent')
    expect(button.className).toContain('custom')
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('Card, Badge, PageHeader, EmptyState, Skeleton', () => {
  it('Card has the radius of the tokens, and a highlighted border for what needs attention', () => {
    const { rerender } = render(<Card data-testid="card">x</Card>)
    expect(screen.getByTestId('card').className).toContain('rounded-card')
    expect(screen.getByTestId('card').className).toContain('border-line')
    rerender(<Card data-testid="card" highlight radius="sm" as="article">x</Card>)
    expect(screen.getByTestId('card').tagName).toBe('ARTICLE')
    expect(screen.getByTestId('card').className).toContain('border-accent-line')
    expect(screen.getByTestId('card').className).toContain('rounded-card-sm')
    rerender(<Card data-testid="card" plain>x</Card>)
    expect(screen.getByTestId('card').className).not.toContain('bg-white/[0.025]')
  })

  it.each([['success', 'text-accent-text'], ['warn', 'text-warn-text'], ['danger', 'text-danger-text'], ['info', 'text-info-text'], ['neutral', 'text-gray-300']])('Badge %s', (tone, expected) => {
    render(<Badge tone={tone}>State</Badge>)
    expect(screen.getByText('State').className).toContain(expected)
  })

  it('PageHeader: eyebrow, h1 in Bebas Neue, subtitle and an action on the right', () => {
    render(<PageHeader eyebrow="Client space" title="Messages" subtitle="News" actions={<button>Do</button>} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Messages' }).style.fontFamily).toContain('Bebas Neue')
    expect(screen.getByText('Client space').className).toContain('text-accent-text')
    expect(screen.getByText('News')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Do' })).toBeTruthy()
    cleanup()
    render(<PageHeader title="Only a title" />)
    expect(screen.queryByText('Client space')).toBeNull()
  })

  it('EmptyState: a text, an optional action, and an alert role for errors', () => {
    render(<EmptyState role="alert" text="It failed" action={<Button>Retry</Button>} />)
    expect(screen.getByRole('alert').textContent).toContain('It failed')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('Skeleton pulses (and the global rule stops it for prefers-reduced-motion); the list is a labelled status', () => {
    render(<><Skeleton className="h-4" /><SkeletonCard /><SkeletonList label="Loading" count={2} /></>)
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(4)
    expect(screen.getByRole('status', { name: 'Loading' }).children).toHaveLength(2)
  })
})

describe('Modal', () => {
  function Harness({ busy = false }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>open</button>
        {open && <Modal title="Are you sure?" description="This cannot be undone." busy={busy} onClose={() => setOpen(false)} actions={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger">Delete</Button></>} />}
      </>
    )
  }
  // jsdom has no layout: the focus trap skips what has no offsetParent
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.parentNode } })

  it('is a named, described alertdialog; the focus goes in, Tab stays inside, Esc closes it and the focus goes back', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByText('open')
    opener.focus()
    await user.keyboard('{Enter}')
    const dialog = screen.getByRole('alertdialog', { name: 'Are you sure?' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    expect(dialog.contains(document.activeElement)).toBe(true)
    for (let i = 0; i < 4; i += 1) { await user.tab(); expect(dialog.contains(document.activeElement)).toBe(true) }      // it never leaves
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('does not close while an answer is being sent (busy), and closes with a click outside otherwise', async () => {
    const { unmount } = render(<Harness busy />)
    fireEvent.click(screen.getByText('open'))
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    unmount()
    render(<Harness />)
    fireEvent.click(screen.getByText('open'))
    fireEvent.click(screen.getByRole('alertdialog').parentElement)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('has no serious accessibility problems', async () => {
    const { container } = render(<Modal title="Title" description="Text" onClose={() => {}} actions={<Button>OK</Button>} />)
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })
    expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  })
})

describe('form fields', () => {
  it('FormField + Input + Select: visible label, error tied to the field, and the same look', async () => {
    render(
      <>
        <FormField label="Email" required error="Not valid">{({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} />}</FormField>
        <FormField label="Package" id="pack">{({ id }) => <Select id={id}><option>Monthly</option></Select>}</FormField>
      </>,
    )
    const email = screen.getByLabelText(/Email/)
    expect(email.getAttribute('aria-invalid')).toBe('true')
    expect(email.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Not valid')
    const select = screen.getByLabelText('Package')
    expect(select.tagName).toBe('SELECT')
    expect(select.className).toContain('rounded-xl')                              // the corners of the other fields
    expect(select.className).toContain('appearance-none')
    expect(select.style.backgroundImage).toContain('data:image/svg+xml')
    expect(email.className.split(' ').filter(name => /^(w-full|rounded-xl|px-4|py-3\.5|text-base)$/.test(name)).sort()).toEqual(select.className.split(' ').filter(name => /^(w-full|rounded-xl|px-4|py-3\.5|text-base)$/.test(name)).sort())
    await act(async () => {})
  })
})
