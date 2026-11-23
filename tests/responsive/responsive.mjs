// Responsive checks (docs/DESIGN_SYSTEM.md, "Responsive rules"): the main pages at 320, 390 and 768 px must not scroll sideways, must not clip or overlap text,
// must have touch targets of at least 44 x 44 px and must not hide content under a fixed bar. Spanish and Catalan (the longest texts) are checked at 320 and 390 px.
//
//   (the audit backend and the build made with tests/a11y/vite.config.mjs, served by tests/csp-server.mjs)
//   VITE_API_URL=http://127.0.0.1:8010 npx vite build --config tests/a11y/vite.config.mjs --outDir <dist> --emptyOutDir
//   node tests/csp-server.mjs --dist <dist> --port 5173 --api http://127.0.0.1:8010
//   npm run test:responsive -- [--base http://localhost:5173] [--api http://127.0.0.1:8010] [--only <page name>] [--widths 320,390,768]
//
// Playwright (playwright-core) drives the Chrome that is installed (CHROME_PATH to point at another one). It prints only what fails; the secret path of the admin
// panel is read from the API with the administrator's test token and is never printed.
import { chromium } from 'playwright-core'
import process from 'node:process'

const args = process.argv.slice(2)
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const base = option('--base', 'http://localhost:5173')
const api = option('--api', 'http://127.0.0.1:8010')
const only = option('--only', '')
const WIDTHS = option('--widths', '320,390,768').split(',').map(Number)
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const secret = (await (await fetch(`${api}/me/roles`, { headers: { Authorization: 'Bearer test-admin' } })).json()).admin_path
if (!/^[a-z0-9]{14}$/.test(secret || '')) { console.log('FAIL the administrator was not given a panel path (is the audit backend running?)'); process.exit(1) }

// [name, path, who]. The landing editor is a desktop canvas and is not part of this.
const PAGES = [
  ['landing', '/', 'none'], ['login', '/login', 'none'], ['register', '/register', 'none'], ['trial-session', '/trial-session', 'none'], ['privacy', '/privacy', 'none'],
  ['terms', '/terms', 'none'], ['not-found', '/zzz-nothing', 'none'],
  ['c:dashboard', '/dashboard', 'client'], ['c:my-sessions', '/my-sessions', 'client'], ['c:messages', '/messages', 'client'], ['c:profile', '/profile', 'client'],
  ['c:training-request', '/training-request', 'client'],
  ...['', '/requests', '/trials', '/messages', '/sent-messages', '/clients', '/trainers', '/calendar', '/schedule', '/plans', '/videos', '/system', '/legal']
    .map(path => [`a:${path.slice(1) || 'overview'}`, `/${secret}${path}`, 'admin']),
]

// What the page itself tells us (runs in the browser).
function inspect() {
  const vw = window.innerWidth
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false
    return !el.closest('[aria-hidden="true"], [hidden], .sr-only, [inert]')
  }
  const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('href') || '').trim().replace(/\s+/g, ' ').slice(0, 40)
  const sig = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ').filter(Boolean).slice(0, 3).join('.') : '')

  // 1. nothing wider than the screen that is not inside something that scrolls or clips by design
  const wide = []
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.right <= vw + 1 && r.left >= -1) continue
    let held = false
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) { held = true; break } }
    if (!held && getComputedStyle(el).position !== 'fixed') wide.push(`${sig(el)} "${name(el)}" right=${Math.round(r.right)}`)
  }

  // 2. touch targets of 44 x 44 (a checkbox or radio counts through its label; a link inside a sentence is not a target)
  const small = []
  for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=link], summary')) {
    if (!visible(el) || el.closest('.fc, .sr-only')) continue
    const s = getComputedStyle(el)
    if (el.tagName === 'A' && s.display === 'inline' && el.closest('p, li, span, h1, h2, h3, dd, dt, small, label')) continue
    let target = el
    if (el.tagName === 'INPUT' && /^(checkbox|radio)$/.test(el.type)) target = el.closest('label') || el
    const r = target.getBoundingClientRect()
    if (r.width < 43.5 || r.height < 43.5) small.push(`${sig(el)} "${name(el)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
  }

  // 3. a line of text cut by its box (not an ellipsis on purpose)
  const clipped = []
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.closest('.pointer-events-none, .fc')) continue
    const s = getComputedStyle(el)
    if (!/(hidden|clip)/.test(s.overflowX) || s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none' && s.display === '-webkit-box') continue
    const box = el.getBoundingClientRect()
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || (node.parentElement && !visible(node.parentElement))) continue
      let truncated = false                                                      // a line that ends in an ellipsis on purpose is not cut
      for (let p = node.parentElement; p && p !== el.parentElement; p = p.parentElement) { if (getComputedStyle(p).textOverflow === 'ellipsis') { truncated = true; break } }
      if (truncated) continue
      const range = document.createRange(); range.selectNodeContents(node)
      const r = range.getBoundingClientRect()
      if (r.width > 0 && (r.right > box.right + 2 || r.left < box.left - 2)) { clipped.push(`${sig(el)} "${node.textContent.trim().slice(0, 30)}"`); break }
    }
  }

  // 4. what a fixed bar at the bottom covers (after scrolling down: the last things on the page must be reachable)
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })          // (the site scrolls smoothly: measure after the jump)
  const bars = [...document.querySelectorAll('body *')].filter(el => {
    const s = getComputedStyle(el)
    if (s.position !== 'fixed' || !visible(el)) return false
    const r = el.getBoundingClientRect()
    return Math.abs(r.bottom - innerHeight) < 2 && r.width > vw * 0.5 && r.height < 200 && !el.closest('[role=dialog], [role=alertdialog]') && !/cookie|privacidad|privacy|cookies/i.test(el.getAttribute('aria-label') || '')
  })
  const covered = []
  for (const bar of bars) {
    const top = bar.getBoundingClientRect().top
    for (const el of document.querySelectorAll('main a[href], main button, main input, main select, main textarea, main [role=button]')) {
      if (!visible(el) || bar.contains(el)) continue
      const r = el.getBoundingClientRect()
      if (r.bottom > top + 1 && r.top < innerHeight) covered.push(`${sig(el)} "${name(el)}" under ${sig(bar)}`)
    }
  }
  window.scrollTo({ top: 0, behavior: 'instant' })
  return { over: document.documentElement.scrollWidth - vw, wide: wide.slice(0, 5), small, clipped: clipped.slice(0, 5), covered: covered.slice(0, 5) }
}

const browser = await chromium.launch({ executablePath: chromePath, headless: true })
let failures = 0
let checked = 0
for (const lang of ['es', 'ca']) {
  for (const width of WIDTHS) {
    if (lang === 'ca' && width > 390) continue              // the long Catalan texts matter on a phone
    const context = await browser.newContext({ viewport: { width, height: width < 700 ? 800 : 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    await context.addInitScript(({ language }) => {
      try { localStorage.setItem('tb_language', language); localStorage.setItem('tb_admin_language', language === 'ca' ? 'es' : language) } catch { /* private mode */ }
    }, { language: lang })
    for (const [pageName, path, who] of PAGES) {
      if (only && !pageName.includes(only)) continue
      if (lang === 'ca' && pageName.startsWith('a:')) continue          // the panel speaks Spanish and English
      const page = await context.newPage()
      await page.goto(`${base}${path}${path.includes('?') ? '&' : '?'}as=${who}`, { waitUntil: 'load' })
      await page.waitForTimeout(2600)
      for (const label of [/^(rechazar todo|reject all|rebutja(r)?(-ho)? tot)/i]) {
        if (!pageName.startsWith('a:')) await page.getByRole('button', { name: label }).first().click({ timeout: 600 }).catch(() => {})
      }
      await page.waitForTimeout(300)
      const result = await page.evaluate(inspect)
      const problems = []
      if (result.over > 0) problems.push(`scrolls sideways by ${result.over}px ${result.wide.join(' | ')}`)
      if (result.small.length) problems.push(`${result.small.length} touch target(s) under 44x44: ${result.small.slice(0, 4).join(' | ')}`)
      if (result.clipped.length) problems.push(`text cut: ${result.clipped.join(' | ')}`)
      if (result.covered.length) problems.push(`covered by a fixed bar: ${result.covered.join(' | ')}`)
      checked += 1
      if (problems.length) { failures += 1; console.log(`FAIL ${pageName} @${width} ${lang}: ${problems.join(' ; ')}`) }
      await page.close()
    }
    await context.close()
  }
}
// a phone held sideways (844 x 390): the main screens
const MAIN = ['landing', 'login', 'c:dashboard', 'c:my-sessions', 'c:messages', 'a:overview', 'a:requests', 'a:calendar']
{
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await context.addInitScript(() => { try { localStorage.setItem('tb_language', 'es'); localStorage.setItem('tb_admin_language', 'es') } catch { /* private mode */ } })
  for (const [pageName, path, who] of PAGES.filter(([name]) => MAIN.includes(name))) {
    if (only && !pageName.includes(only)) continue
    const page = await context.newPage()
    await page.goto(`${base}${path}${path.includes('?') ? '&' : '?'}as=${who}`, { waitUntil: 'load' })
    await page.waitForTimeout(2600)
    if (!pageName.startsWith('a:')) await page.getByRole('button', { name: /^(rechazar todo|reject all|rebutja(r)?(-ho)? tot)/i }).first().click({ timeout: 600 }).catch(() => {})
    await page.waitForTimeout(300)
    const result = await page.evaluate(inspect)
    const problems = []
    if (result.over > 0) problems.push(`scrolls sideways by ${result.over}px ${result.wide.join(' | ')}`)
    if (result.small.length) problems.push(`${result.small.length} touch target(s) under 44x44: ${result.small.slice(0, 4).join(' | ')}`)
    if (result.clipped.length) problems.push(`text cut: ${result.clipped.join(' | ')}`)
    if (result.covered.length) problems.push(`covered by a fixed bar: ${result.covered.join(' | ')}`)
    checked += 1
    if (problems.length) { failures += 1; console.log(`FAIL ${pageName} @844x390 landscape: ${problems.join(' ; ')}`) }
    await page.close()
  }
  await context.close()
}
await browser.close()
console.log(failures ? `${failures} of ${checked} checks failed` : `all ${checked} checks passed`)
process.exit(failures ? 1 : 0)
