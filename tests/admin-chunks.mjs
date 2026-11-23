// A visitor or a client must never download the code of the admin panel (docs/ADMIN_ACCESS.md). Checked in a real browser (Chromium over the DevTools protocol):
//
//   node tests/csp-server.mjs --dist <dist built with tests/a11y/vite.config.mjs> --port 5173 --api http://127.0.0.1:8010     (and the audit backend on 8010)
//   node tests/admin-chunks.mjs --dist <dist> [--base http://localhost:5173] [--api http://127.0.0.1:8010]
//
// It prints only PASS / FAIL lines: the secret path of the panel is fetched from the server with the administrator's test token and kept in memory, never printed.
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const dist = option('--dist', 'dist')
const base = option('--base', 'http://localhost:5173')
const api = option('--api', 'http://127.0.0.1:8010')
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// the files of the panel: the chunks whose name is that of a page or a part of the panel (their names come from the build)
const ADMIN_CHUNK = /^(AdminApp|AdminLayout|AdminNotFound|Overview|Requests|Clients|TrialSessions|Calendar|Schedule|SentMessages|Trainers|Plans|Videos|Messages|SystemStatus|LegalTexts|TrainerPanelView|LandingPageEditor)-[\w-]+\.js$/
const adminFiles = readdirSync(join(dist, 'assets')).filter(name => ADMIN_CHUNK.test(name))
if (adminFiles.length < 10) { console.log('FAIL the build has no admin chunks to look for', adminFiles.length); process.exit(1) }

const profile = join(process.env.TEMP || '.', `tb-admin-chunks-${Date.now()}`)
const browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=9336', `--user-data-dir=${profile}`, '--disable-gpu', '--no-first-run', 'about:blank'], { stdio: 'ignore' })
let targets
for (let i = 0; i < 40; i += 1) { try { targets = await (await fetch('http://127.0.0.1:9336/json/list')).json(); if (targets.length) break } catch { /* not up yet */ } await sleep(250) }
const ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
await new Promise(resolve => { ws.onopen = resolve })
let id = 0
const waiting = new Map()
let requested = []
ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id && waiting.has(message.id)) { waiting.get(message.id)(message); waiting.delete(message.id) }
  if (message.method === 'Network.requestWillBeSent') requested.push(message.params.request.url)
}
const send = (method, params = {}) => new Promise(resolve => { id += 1; waiting.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
await send('Network.enable')
await send('Page.enable')

let failed = 0
const check = (ok, text) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${text}`); if (!ok) failed += 1 }
const adminRequests = () => requested.filter(url => adminFiles.some(name => url.includes(name)))

async function open(path, as) {
  requested = []
  await send('Page.navigate', { url: `${base}${path}${path.includes('?') ? '&' : '?'}as=${as}` })
  await sleep(3500)
  return { pathname: await evaluate('location.pathname'), title: await evaluate('document.querySelector("h1")?.textContent || ""'), requests: adminRequests() }
}

// the administrator's secret path: asked with the test token, kept in memory only
const roles = await (await fetch(`${api}/me/roles`, { headers: { Authorization: 'Bearer test-admin' } })).json()
const secret = roles.admin_path
check(typeof secret === 'string' && secret.length === 14, 'the administrator is given a 14-character path')
const asClient = await (await fetch(`${api}/me/roles`, { headers: { Authorization: 'Bearer test-client' } })).json()
check(!('admin_path' in asClient), 'a client is not given any path')

for (const path of ['/', '/login', '/register', '/privacy', '/admin', '/admin/clients', '/admin/login', '/administrator', '/wp-admin', '/zzz-nothing']) {
  const page = await open(path, 'none')
  check(page.requests.length === 0, `a visitor at ${path} downloads no admin chunk`)
  if (path.startsWith('/admin') || path === '/administrator' || path === '/wp-admin') {
    check(page.pathname === path, `a visitor at ${path} is not redirected`)
    check(/not found|404|no encontrad/i.test(await evaluate('document.body.innerText')), `a visitor at ${path} sees the ordinary 404`)
  }
}

for (const path of ['/dashboard', '/admin', '/admin/clients', `/${'x'.repeat(14)}`, '/profile']) {
  const page = await open(path, 'client')
  check(page.requests.length === 0, `a client at ${path.replace(/^\/x{14}$/, '/<14 characters>')} downloads no admin chunk`)
}

const wrongGuess = await open(`/${'q'.repeat(14)}/clients`, 'none')
check(wrongGuess.requests.length === 0 && /not found|404|no encontrad/i.test(await evaluate('document.body.innerText')), 'a visitor at a wrong 14-character path sees the 404 and downloads nothing')

const bookmark = await open(`/${secret}/clients`, 'none')
check(bookmark.requests.length === 0, 'a visitor with the right bookmark gets the login and downloads no admin chunk')
check(bookmark.pathname === `/${secret}/clients` && !/not found|404/i.test(await evaluate('document.body.innerText')), 'the right bookmark shows the login, not the 404')

const old = await open('/admin/clients', 'admin')
check(old.pathname === `/${secret}/clients`, 'the administrator at /admin/clients is taken to the new address')
check(old.requests.length > 0, 'the administrator does download the panel')
const home = await open(`/${secret}`, 'admin')
check(home.pathname === `/${secret}` && home.requests.length > 0, 'the administrator opens the panel at the secret path')
check(/today|hoy/i.test(home.title), 'the panel is drawn (the Overview "Today" is on the screen)')
const system = await open(`/${secret}/system`, 'admin')
check(/system|sistema/i.test(system.title) && (await evaluate('document.querySelector("[data-testid=access-path]")?.textContent || ""')).endsWith(`/${secret}`), 'the settings block shows the full path to the administrator')

ws.close()
browser.kill()
await sleep(500)
console.log(failed ? `${failed} check(s) failed` : 'all checks passed')
process.exit(failed ? 1 : 0)
