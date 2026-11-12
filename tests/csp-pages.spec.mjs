// Opens the main pages with the REAL Content-Security-Policy and fails if the browser blocks anything.
//
// It needs Playwright, which is NOT a dependency of the project (nothing is installed by default): it is skipped, with a message, when it
// is not there. To run it:
//   1. a build:      VITE_API_URL=http://127.0.0.1:8000 npx vite build --outDir /tmp/csp-dist --emptyOutDir
//   2. the backend:  cd backend && ENV=development python -m uvicorn main:app --port 8000
//   3. the server:   node tests/csp-server.mjs --dist /tmp/csp-dist --api http://127.0.0.1:8000,http://localhost:8000
//   4. the check:    npx --yes -p playwright node tests/csp-pages.spec.mjs         (CSP_BASE_URL=http://127.0.0.1:5173 by default)
// The pages that need a login (client area, admin, editor) are not reachable without a Firebase account: see docs/CSP_CHECK.md.
const BASE = process.env.CSP_BASE_URL || 'http://127.0.0.1:5173'
const PAGES = ['/', '/login', '/register', '/trial-session', '/training-tips', '/privacy', '/cookies', '/legal-notice', '/admin/login', '/no-such-page']

let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  console.log('SKIPPED: Playwright is not installed (see the header of this file).')
  process.exit(0)
}

const browser = await chromium.launch()
const context = await browser.newContext()
await context.addInitScript(() => { try { localStorage.setItem('tb_consent', 'accepted') } catch { /* no storage */ } })   // reviews, maps and videos load
const problems = []
for (const path of PAGES) {
  const page = await context.newPage()
  const refused = []
  page.on('console', message => { if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text().slice(0, 200)) })
  await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {})
  for (let step = 0; step < 6; step++) {                                          // lazy sections (reviews) load when they come into view
    await page.evaluate(fraction => window.scrollTo(0, document.body.scrollHeight * fraction), step / 5)
    await page.waitForTimeout(700)
  }
  await page.waitForTimeout(3000)
  const probe = await page.evaluate(() => window.__cspViolations || [])
  for (const item of probe) problems.push(`${path}: ${item.directive} blocked ${item.blocked}`)
  for (const text of refused) problems.push(`${path}: ${text}`)
  await page.close()
}
await browser.close()

if (problems.length) {
  console.error(`CSP violations (${problems.length}):\n- ${[...new Set(problems)].join('\n- ')}`)
  process.exit(1)
}
console.log(`OK: no Content-Security-Policy violation on ${PAGES.length} pages.`)
