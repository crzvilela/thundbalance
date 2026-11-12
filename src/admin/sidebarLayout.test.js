import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { scrollDelta } from './sidebarScroll.js'

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')
const layout = read('./AdminLayout.jsx')
const nav = read('./SidebarNav.jsx')
const css = read('./admin.css')

test('the side panel has three zones in a column of the full dynamic height (desktop and phone drawer)', () => {
  assert.match(layout, /<aside className="fixed left-0 top-0 z-30 hidden h-dvh w-64/)                  // desktop column
  assert.match(layout, /<div className="fixed inset-x-0 top-0 z-50 h-dvh lg:hidden">/)                // phone: not hidden behind the browser bar
  assert.match(layout, /<aside className="admin-drawer absolute left-0 top-0 h-dvh/)
  assert.match(layout, /<div className="flex h-full min-h-0 flex-col">/)
  assert.match(layout, /<div className="shrink-0 pb-3 pl-5 pr-12 pt-4 lg:pr-5">/)                    // fixed top
  assert.match(layout, /<SidebarNav /)                                                                  // the scrolling middle
  assert.match(layout, /className="admin-nav-scroll max-h-\[50dvh\] shrink-0 [^"]*overflow-y-auto/)    // fixed footer
})

test('the list scrolls inside the menu, in normal and in edit mode, and the footer keeps the main buttons', () => {
  assert.equal((nav.match(/\$\{NAV_SCROLL\}/g) || []).length, 2)                                        // both navs use the scrolling zone
  assert.match(nav, /const NAV_SCROLL = 'admin-nav-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3'/)
  assert.match(layout, /<CustomizeButton /)                                                             // Personalizar panel is in the footer
  assert.doesNotMatch(nav.slice(nav.indexOf('if (!edit?.isEditing)'), nav.indexOf('const rename')), /edit\.start\(\)/)   // not inside the list any more
  for (const part of ['chooseTheme(mode)', 'setLanguage(code)', "t('nav_site')", "t('nav_logout')"]) assert.ok(layout.indexOf(part) > layout.indexOf('admin-nav-scroll max-h-'), part)
})

test('touch targets stay at 40 px or more and the scrollbar is quiet with its space reserved', () => {
  assert.match(layout, /group flex min-h-10 items-center/)                                              // menu items
  assert.match(nav, /const TOOL = 'flex h-10 w-10/)                                                     // edit-mode handles, eye, pencil
  assert.match(css, /\.admin-nav-scroll \{[^}]*scrollbar-gutter: stable/)
  assert.match(css, /\.admin-nav-scroll \{[^}]*scrollbar-width: thin/)
})

test('keyboard focus is visible on the menu entries', () => {
  assert.match(layout, /focus-visible:outline-emerald-400/)
  assert.match(nav, /focus-visible:outline-emerald-400/)
})

test('the active item is scrolled into view only when it is outside the menu', () => {
  const box = { top: 100, bottom: 400 }
  assert.equal(scrollDelta(box, { top: 150, bottom: 190 }), 0)                  // already visible
  assert.equal(scrollDelta(box, { top: 380, bottom: 420 }), 28)                 // below: move down, keeping the margin
  assert.equal(scrollDelta(box, { top: 60, bottom: 100 }), -48)                 // above: move up
  assert.equal(scrollDelta(box, { top: 100, bottom: 140 }, 0), 0)
  assert.match(nav, /scrollBy\(\{ top: delta, behavior: calm \? 'auto' : 'smooth' \}\)/)               // smooth unless the person asked for less motion
})
