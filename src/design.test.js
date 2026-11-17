import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { formatDate, formatDayTime } from './utils/sessionDates.js'
import { packFacts, pricePerSession, sessionsInFeatures } from './utils/landingPrices.js'
import { emptyContactLabels } from './utils/contactLabels.js'
import { migratePricingButton } from './content/pricingMigration.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('a session is written the same way in the three languages: weekday, day, month, hour without seconds', () => {
  assert.equal(formatDayTime('2026-11-20', '10:00:00', 'en-GB'), 'Fri 20 Nov · 10:00')
  assert.equal(formatDayTime('2026-11-20', '10:00:00', 'es-ES'), 'vie 20 nov · 10:00')
  assert.equal(formatDayTime('2026-11-20', '10:00:00', 'ca-ES'), 'dv 20 nov · 10:00')
  assert.equal(formatDayTime('2026-04-02', '09:30', 'ca-ES'), 'dj 2 abr · 09:30')            // "d'abr." loses its article
  assert.equal(formatDayTime('2026-11-20', '', 'es-ES'), 'vie 20 nov')                       // no hour: only the day
  assert.match(formatDate('2026-11-20', 'es-ES'), /20 nov.* 2026/)
})

test('the day never slips to the neighbour whatever the time zone of the browser', () => {
  const original = process.env.TZ
  try {
    for (const zone of ['America/Los_Angeles', 'Pacific/Auckland']) {
      process.env.TZ = zone
      assert.equal(formatDayTime('2026-11-20', '23:30', 'en-GB'), 'Fri 20 Nov · 23:30')
    }
  } finally { process.env.TZ = original }
})

test('the total of a pack is worked out only from a price per session and a number of sessions in the plan text', () => {
  assert.deepEqual(pricePerSession('€65/session'), { amount: 65, currency: '€' })
  assert.deepEqual(pricePerSession('65,50 € / sesión'), { amount: 65.5, currency: '€' })
  assert.equal(pricePerSession('€65'), null)                               // no "per session": nothing is guessed
  assert.equal(sessionsInFeatures(['8 sessions', 'Personal training'], 'en'), 8)
  assert.equal(sessionsInFeatures(['1-5 sessions per week'], 'en'), null)  // a range per week is not a number of sessions
  assert.equal(sessionsInFeatures(['3 Training Plan Reviews'], 'en'), null)
  assert.deepEqual(packFacts({ price: '€65/session', features: ['8 sessions'] }, null, 'en', true), { total: '€520', sessions: 8, saving: null })
  assert.equal(packFacts({ price: '€65/session', features: ['1-5 sessions per week'] }, null, 'en', true), null)
  assert.equal(packFacts({ price: '', features: [] }, null, 'en'), null)
})

test('the saving against the monthly plan is shown only when both prices exist and the plan is really cheaper', () => {
  const monthly = { price: '€65/session', features: [] }
  assert.equal(packFacts({ price: '€55/session', features: ['24 sessions'] }, monthly, 'en').saving, 15)
  assert.equal(packFacts({ price: '€70/session', features: ['24 sessions'] }, monthly, 'en').saving, null)
  assert.equal(packFacts({ price: '€55/session', features: ['24 sessions'] }, { price: '', features: [] }, 'en').saving, null)
})

test('the old "Most Popular" button of the recommended plan becomes "Get Started"; a text the admin wrote stays', () => {
  const content = (text) => ({ sections: { pricing: { type: 'pricing', plans: [{ buttonText: 'Get Started', highlighted: false }, { buttonText: text, highlighted: true }] } } })
  const old = { en: 'Most Popular', es: 'Más Popular', ca: 'Més Popular' }
  assert.deepEqual(migratePricingButton(content(old)).sections.pricing.plans[1].buttonText, { en: 'Get Started', es: 'Empezar', ca: 'Començar' })
  assert.deepEqual(migratePricingButton(content('Most Popular')).sections.pricing.plans[1].buttonText, { en: 'Get Started', es: 'Empezar', ca: 'Començar' })
  assert.equal(migratePricingButton(content('Reserve now')).sections.pricing.plans[1].buttonText, 'Reserve now')
  assert.equal(migratePricingButton(content(old)).sections.pricing.plans[0].buttonText, 'Get Started')
  assert.equal(migratePricingButton(content(old)).pricingButtonVersion, 1)
  const done = { ...content(old), pricingButtonVersion: 1 }
  assert.equal(migratePricingButton(done), done)                           // once: later edits are never touched
})

test('the editor refuses a contact form with an empty label, in any language', () => {
  const form = (labels) => ({ sections: { contact: { type: 'contact', visible: true, formLabels: labels } } })
  const full = { name: { en: 'Name', es: 'Nombre', ca: 'Nom' }, email: 'Email', message: { en: 'Message', es: 'Mensaje', ca: 'Missatge' } }
  assert.deepEqual(emptyContactLabels(form(full)), [])
  assert.deepEqual(emptyContactLabels(form({ ...full, name: { en: 'Name', es: '', ca: 'Nom' } })), [{ section: 'contact', field: 'name', languages: ['es'] }])
  assert.equal(emptyContactLabels(form({ ...full, message: '   ' })).length, 1)
  assert.equal(emptyContactLabels(form({})).length, 3)
  assert.deepEqual(emptyContactLabels({ sections: { contact: { type: 'contact', visible: false, formLabels: {} } } }), [])    // a hidden form is not published anyway
  const context = read('./content/LandingContentContext.jsx')
  assert.match(context, /emptyContactLabels\(content\)/)
  assert.match(context, /contact_labels_empty/)
})

test('the 404 title is in Bebas Neue and its button is the usual primary one', () => {
  const page = read('./pages/NotFound.jsx')
  assert.match(page, /<h1 style=\{\{ fontFamily: 'Bebas Neue' \}\}/)
  assert.match(page, /<Button as=\{Link\} to="\/" variant="primary" size="lg">/)
})

test('the admin page does not fade in for long: 120 ms at most, no delay, and never from an empty page', () => {
  const css = read('./admin/admin.css')
  const rule = /\.admin-fade \{ animation: admin-fade ([\d.]+)(m?s) [\w-]+ backwards;/.exec(css)
  assert.ok(rule, 'the .admin-fade rule changed')
  const milliseconds = rule[2] === 's' ? Number(rule[1]) * 1000 : Number(rule[1])
  assert.ok(milliseconds <= 120, `${milliseconds} ms`)
  assert.doesNotMatch(css, /\.admin-fade[^}]*animation-delay/)
  assert.match(css, /@keyframes admin-fade \{ from \{ opacity: 0\.[1-9]/)
  assert.match(css, /\.admin-fade[^}]*\{ animation: none; \}|\.admin-fade, \.bulk-in \{ animation: none; \}/)       // prefers-reduced-motion
})

test('"Delete pack" is in the secondary menu of the pack card, and still asks before deleting', () => {
  const page = read('./admin/pages/Plans.jsx')
  assert.match(page, /<MoreMenu quiet[^>]*items=\{\[\{ label: t\('cat_delete'\), danger: true/)
  assert.doesNotMatch(page, /<button type="button" onClick=\{onDelete\}/)
  assert.match(page, /onDelete=\{\(\) => setDeleting\(pack\)\}/)                // the button of the menu only opens the confirmation
  assert.match(page, /removePack\(deleting\)|onConfirm=\{\(\) => removePack/)
  assert.match(page, /grid-cols-\[auto_minmax\(0,1fr\)\]/)                      // the values in a grid that does not break into two lines
})

test('the mobile menu has the Register link and the header only keeps Login and the hamburger', () => {
  const navbar = read('./components/Navbar.jsx')
  assert.match(navbar, /className="hidden md:inline-flex items-center min-h-\[44px\][^"]*"[\s\S]{0,200}sections\.navbar\.labels\.register|to="\/register"\s*\n\s*\{\.\.\.prefetchHandlers\('register'\)\}\s*\n\s*className="hidden md:inline-flex/)
  assert.match(navbar, /order-last md:hidden w-11 h-11/)                          // the hamburger is the last of the group on a phone
  assert.match(navbar, /aria-expanded=\{mobileMenuOpen\}/)
})

test('the footer writes the address, the e-mail and the phone next to their icons, only from data that exists', () => {
  const footer = read('./components/Footer.jsx')
  assert.match(footer, /addressText && \{/)
  assert.match(footer, /emailText && \{/)
  assert.match(footer, /phoneText && \{/)
  assert.match(footer, /company\?\.phone/)
})
