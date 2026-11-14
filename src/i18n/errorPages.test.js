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
  assert.deepEqual(areaFor({ status: 'ready', roles: { is_admin: true }, isTrainerOnly: false }), { to: '/admin', labelKey: 'adminArea' })
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
  assert.match(routes, /<Route path="\*" element=\{<NotFound \/>\} \/>/)
  assert.match(routes, /<Route path="\*" element=\{<AdminNotFound \/>\} \/>\s*<\/Route>/)             // the last child of the /admin route
  assert.match(read('../App.jsx'), /<AppErrorBoundary>[\s\S]*<AppRoutes \/>[\s\S]*<\/AppErrorBoundary>/)
})

test('the 404 has the way home and, for a signed-in account, the way to their area; the error page only offers to reload', () => {
  const notFound = code(read('../pages/NotFound.jsx'))
  assert.match(notFound, /<Link to="\/"[^>]*>\{text\.home\}<\/Link>/)
  assert.match(notFound, /<Link to=\{area\.to\}/)
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
  assert.match(code(read('../admin/AdminNotFound.jsx')), /<Link to="\/admin"/)
})

test('Vercel answers every path with the app (a reload on a route works) and the 404 is drawn by the app', () => {
  const vercel = JSON.parse(read('../../vercel.json'))
  assert.deepEqual(vercel.rewrites, [{ source: '/(.*)', destination: '/index.html' }])
})
