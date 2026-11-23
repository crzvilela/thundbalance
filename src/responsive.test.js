import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// The responsive foundations (docs/DESIGN_SYSTEM.md, "Responsive rules"): what must stay true in the code. The behaviour in a real browser is checked by
// `npm run test:responsive` (tests/responsive/responsive.mjs).
const src = fileURLToPath(new URL('./', import.meta.url))
const root = fileURLToPath(new URL('../', import.meta.url))
const css = readFileSync(join(src, 'index.css'), 'utf8')
const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? files(path) : [path]
})

test('the viewport covers the notch, never blocks zoom and lets the keyboard resize the page', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8')
  const viewport = /<meta name="viewport" content="([^"]*)"/.exec(html)?.[1] || ''
  assert.match(viewport, /width=device-width/)
  assert.match(viewport, /initial-scale=1/)
  assert.match(viewport, /viewport-fit=cover/)
  assert.match(viewport, /interactive-widget=resizes-content/)
  assert.doesNotMatch(viewport, /user-scalable\s*=\s*(no|0)|maximum-scale/)           // whoever zooms to 200 % can
})

test('fields are 16 px on a phone, targets 44 px, hover-only things are visible on touch, safe areas are used', () => {
  assert.match(css, /@media \(max-width: 767px\) \{\s*input:not\(\[type="checkbox"\]\)[^{]*select, textarea \{ font-size: 16px; \}/)
  assert.match(css, /min-height: 44px; min-width: 44px;/)
  assert.match(css, /label:has\(> input\[type="checkbox"\]\)[^{]*\{ min-height: 44px; \}/)
  assert.match(css, /@media \(hover: none\) \{\s*\[class\*="group-hover:opacity-"\]/)
  assert.match(css, /env\(safe-area-inset-left\)/)
  assert.match(css, /text-wrap: balance/)
  assert.match(css, /body\.has-bottom-nav \{ padding-bottom: calc\(4\.5rem \+ env\(safe-area-inset-bottom\)\)/)
})

test('heights use dvh / svh: no vh, no h-screen', () => {
  for (const path of files(src).filter(file => /\.(jsx?|css)$/.test(file) && !/\.(test|spec)\./.test(file))) {
    const text = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(text, /[^a-z]\d+vh\b/, `${relative(root, path)} uses vh`)
    assert.doesNotMatch(text, /(^|[^-\w])(min-)?h-screen\b/, `${relative(root, path)} uses h-screen`)
  }
})

test('the dialogs of the panel and of the client area are bottom sheets on a phone', () => {
  for (const file of ['admin/ui.jsx', 'admin/RestoreSessionDialog.jsx', 'admin/BulkBar.jsx', 'admin/calendar/EventDetail.jsx', 'components/ui/Modal.jsx', 'components/sessions/SessionModal.jsx']) {
    const text = readFileSync(join(src, file), 'utf8')
    assert.match(text, /items-end[^"]*sm:items-center/, `${file}: anchored to the bottom on a phone`)
    assert.match(text, /rounded-t-(3xl|card)/, `${file}: rounded on top`)
    assert.match(text, /90dvh/, `${file}: at most 90 dvh`)
    assert.match(text, /h-1 w-10[^"]*rounded-full/, `${file}: the handle`)
  }
})

test('the page title is fluid, the keyboard scroll exists and the bottom navigation is wired', () => {
  assert.match(css, /--text-display: clamp\(2\.25rem, 9vw, 3rem\)/)
  assert.match(readFileSync(join(src, 'main.jsx'), 'utf8'), /installKeyboardScroll\(\)/)
  assert.match(readFileSync(join(src, 'routes/AppRoutes.jsx'), 'utf8'), /<BottomNav \/>/)
  assert.match(readFileSync(join(src, 'components/Navbar.jsx'), 'utf8'), /pt-\[max\(1rem,env\(safe-area-inset-top\)\)\]/)         // the top bar clears the notch
})
