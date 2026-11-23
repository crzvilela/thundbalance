import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ERROR_TEXT, areaFor, isStaleBuildError, textsFor } from './errorPages.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const code = (text) => text.replace(/\/\/.*$/gm, '')

test('the 404 and the error page are written in Spanish, English and Catalan, and say nothing technical', () => {
  const keys = ['notFoundTitle', 'notFoundText', 'home', 'myArea', 'adminArea', 'trainerArea', 'errorTitle', 'errorText', 'reload']
  for (const language of ['en', 'es', 'ca']) {
    for (const key of keys) assert.ok(ERROR_TEXT[language][key]?.length > 3, `${language}.${key}`)
    for (const key of Object.keys(ERROR_TEXT[language])) assert.doesNotMatch(ERROR_TEXT[language][key], /stack|exception|undefined|null|500|TypeError|api|token/i, `${language}.${key}`)
  }
  assert.notEqual(ERROR_TEXT.es.notFoundTitle, ERROR_TEXT.en.notFoundTitle)
  assert.notEqual(ERROR_TEXT.ca.notFoundTitle, ERROR_TEXT.es.notFoundTitle)
  assert.equal(ERROR_TEXT.es.notFoundTitle, 'Página no encontrada')
  assert.equal(ERROR_TEXT.es.errorTitle, 'Algo salió mal')
  assert.equal(textsFor('fr'), ERROR_TEXT.en)                                              // an unknown language is English
})

test('"go to my area" leads to the right place, and a visitor has no such button', () => {
  assert.equal(areaFor({ status: 'signed-out' }), null)
  assert.equal(areaFor({ status: 'loading' }), null)
  assert.equal(areaFor(undefined), null)
  assert.deepEqual(areaFor({ status: 'ready', roles: { is_admin: true, admin_path: 'fakepath0123ab' }, isTrainerOnly: false }), { to: '/fakepath0123ab', labelKey: 'adminArea' })
  assert.deepEqual(areaFor({ status: 'ready', roles: { is_admin: true }, isTrainerOnly: false }), { to: '/dashboard', labelKey: 'myArea' })       // no panel address (never given to a client)
  assert.deepEqual(areaFor({ status: 'ready', roles: { is_admin: false, is_trainer: true }, isTrainerOnly: true }), { to: '/trainer', labelKey: 'trainerArea' })
  assert.deepEqual(areaFor({ status: 'ready', roles: { is_admin: false }, isTrainerOnly: false }), { to: '/dashboard', labelKey: 'myArea' })
  assert.deepEqual(areaFor({ status: 'error', roles: null }), { to: '/dashboard', labelKey: 'myArea' })       // signed in, roles not known: the client area
})

test('an error caused by a new version is recognised (the page then reloads once)', () => {
  assert.equal(isStaleBuildError(new Error('Failed to fetch dynamically imported module: https://x/assets/a.js')), true)
  assert.equal(isStaleBuildError(new Error('Importing a module script failed.')), true)
  assert.equal(isStaleBuildError(new Error('Cannot read properties of undefined')), false)
  assert.equal(isStaleBuildError(undefined), false)
})

test('the routes: a path that does not exist shows the 404, also inside the admin; the whole app has an error boundary', () => {
  const routes = read('../routes/AppRoutes.jsx')
  assert.match(routes, /<Route path="\*" element=\{<UnknownOrAdmin \/>\} \/>/)                     // the 404 (or, for the signed-in administrator only, the panel)
  assert.match(read('../routes/UnknownOrAdmin.jsx'), /const NotFound = lazy\(\(\) => import\('\.\.\/pages\/NotFound'\)\)/)
  assert.match(read('../admin/AdminApp.jsx'), /<Route path="\*" element=\{<AdminNotFound \/>\} \/>\s*<\/Route>/)      // the last child of the panel's route
  assert.match(read('../App.jsx'), /<AppErrorBoundary>[\s\S]*<AppRoutes \/>[\s\S]*<\/AppErrorBoundary>/)
})

test('the 404 has the way home and, for a signed-in account, the way to their area; the error page only offers to reload', () => {
  const notFound = code(read('../pages/NotFound.jsx'))
  assert.match(notFound, /<Button as=\{Link\} to="\/"[^>]*>\{text\.home\}<\/Button>/)
  assert.match(notFound, /<Button as=\{Link\} to=\{area\.to\}/)
  assert.match(notFound, /areaFor\(rolesState\)/)
  assert.match(notFound, /name = 'robots'/)                                                       // never indexed
  const boundary = code(read('../components/AppErrorBoundary.jsx'))
  assert.match(boundary, /window\.location\.reload\(\)/)
  assert.doesNotMatch(boundary, /error\??\.(message|stack)|String\(.*error/)                       // the technical error is never drawn
  assert.match(boundary, /role="alert"/)
})

test('the admin 404 has Spanish and English texts', () => {
  const texts = read('../admin/adminText.js')
  for (const key of ['nf_title', 'nf_text', 'nf_back']) assert.equal((texts.match(new RegExp(`\\b${key}: '`, 'g')) || []).length, 2, key)
  assert.match(code(read('../admin/AdminNotFound.jsx')), /<Link to=\{adminUrl\(\)\}/)
})

test('Vercel answers the routes of the app with the app (a reload works) but a missing file or asset is a real 404', () => {
  const vercel = JSON.parse(read('../../vercel.json'))
  assert.equal(vercel.rewrites.length, 1)
  assert.equal(vercel.rewrites[0].destination, '/index.html')
  const matches = (path) => new RegExp(`^/${vercel.rewrites[0].source.replace(/^\//, '')}$`).test(path)
  for (const route of ['/', '/dashboard', '/admin/clients', '/trial-session/confirm/abc_DEF-123', '/does-not-exist']) assert.equal(matches(route), true, route)
  for (const file of ['/assets/index-old.js', '/assets/chunk-abc.css', '/missing.js', '/x.css', '/a.png', '/b.svg', '/c.json', '/sitemap.xml', '/robots.txt', '/favicon.ico', '/f.woff2']) assert.equal(matches(file), false, file)
  const headers = JSON.stringify(vercel.headers)
  assert.match(headers, /public, max-age=31536000, immutable/)                                         // hashed assets are cached for a year
})
