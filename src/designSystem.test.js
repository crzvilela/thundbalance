import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

// The quality guard of the design system (docs/DESIGN_SYSTEM.md). The pages and components in MIGRATED already use the base components of
// src/components/ui: in them a raw <button> or one of the old classes is a mistake. Only these files are checked: nothing else is touched.
const MIGRATED = [
  'pages/Login.jsx', 'pages/Register.jsx', 'pages/NotFound.jsx', 'pages/ClientMessages.jsx', 'pages/TrainingRequest.jsx', 'pages/Profile.jsx', 'pages/Dashboard.jsx',
  'components/inbox/MessageCard.jsx', 'components/inbox/ConfirmModal.jsx',
]
// what to use instead: Button, Card, the tokens border-line / border-line-strong, rounded-card / rounded-card-sm / rounded-control
const FORBIDDEN = [
  [/<button[\s>]/, 'a raw <button>: use <Button> (components/ui)'],
  [/<select[\s>]/, 'a raw <select>: use <Select> (components/ui)'],
  [/border-white\/(10|15|20|25)\b/, 'border-white/10|15|20|25: use border-line or border-line-strong'],
  [/rounded-3xl|rounded-2xl/, 'rounded-3xl / rounded-2xl: use <Card> or rounded-card / rounded-card-sm'],
]
const read = (path) => readFileSync(new URL(`./${path}`, import.meta.url), 'utf8')

test('the migrated pages use the base components and none of the old patterns', () => {
  for (const file of MIGRATED) {
    assert.ok(existsSync(new URL(`./${file}`, import.meta.url)), `${file} does not exist (update MIGRATED)`)
    const source = read(file).replace(/\/\/.*$/gm, '')
    assert.match(source, /from '(\.\.\/)+components\/ui'|from '\.\.\/ui'/, `${file} does not import the components of components/ui`)
    for (const [pattern, advice] of FORBIDDEN) assert.doesNotMatch(source, pattern, `${file}: ${advice}`)
  }
})

test('every token of the design system is defined once in index.css with the value it replaces written next to it', () => {
  const css = read('index.css')
  for (const token of ['accent', 'accent-hover', 'accent-text', 'accent-soft', 'accent-line', 'danger', 'danger-hover', 'danger-text', 'danger-soft', 'danger-line',
    'warn', 'warn-text', 'warn-soft', 'warn-line', 'info', 'info-text', 'info-soft', 'info-line', 'line', 'line-strong']) {
    assert.equal((css.match(new RegExp(`--color-${token}:`, 'g')) || []).length, 1, `--color-${token}`)
  }
  for (const token of ['radius-control', 'radius-card', 'radius-card-sm', 'radius-pill', 'text-display', 'text-display-lg', 'text-h1', 'text-h2', 'text-h3', 'text-eyebrow']) {
    assert.equal((css.match(new RegExp(`--${token}:`, 'g')) || []).length, 1, `--${token}`)
  }
  const doc = readFileSync(new URL('../docs/DESIGN_SYSTEM.md', import.meta.url), 'utf8')
  for (const token of ['--color-accent', '--color-line', '--color-line-strong', '--radius-control', '--radius-card', '--text-display', '--text-eyebrow']) assert.ok(doc.includes(token), `${token} is not documented`)
})

test('the values of the tokens are the ones of the classes they replace (so a migrated page looks the same)', () => {
  const css = read('index.css')
  assert.match(css, /--color-accent: oklch\(76\.5% \.177 163\.223\)/)            // emerald-400
  assert.match(css, /--color-line: color-mix\(in oklab, #fff 10%, transparent\)/)    // border-white/10
  assert.match(css, /--color-line-strong: color-mix\(in oklab, #fff 20%, transparent\)/)
  assert.match(css, /--radius-control: \.75rem/)                                  // rounded-xl
  assert.match(css, /--radius-card: 1\.5rem/)                                     // rounded-3xl
  assert.match(css, /--text-display: 3rem/)                                       // text-5xl
})

test('the landing, the admin and the rest of the client area are not part of this phase: they do not import the base components yet', () => {
  for (const file of ['components/Hero.jsx', 'components/Pricing.jsx', 'components/Contact.jsx', 'pages/MySessions.jsx', 'admin/pages/Plans.jsx']) {
    assert.doesNotMatch(read(file), /components\/ui'/, `${file} was migrated by accident (or move it to MIGRATED)`)
  }
})
