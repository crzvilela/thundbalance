import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildReport, routePattern, shortMessage, shouldIgnore } from './reportErrorCore.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('the report holds the kind of error, a short clean message, the pattern of the page and the release: nothing else', () => {
  const error = new TypeError('Cannot read properties of undefined (reading ana.garcia@example.com) at https://thundbalance.vercel.app/assets/x.js:1:2 id 123456789')
  const report = buildReport(error, '/admin/clients/123?token=SECRET#x', 'abc1234')
  assert.deepEqual(Object.keys(report).sort(), ['error_type', 'message', 'release', 'route'])
  assert.equal(report.error_type, 'TypeError')
  assert.equal(report.route, '/admin/clients/:id')
  const text = JSON.stringify(report)
  for (const private_ of ['ana.garcia', 'example.com', 'https://', 'SECRET', '123456789', 'x.js']) assert.ok(!text.includes(private_), private_)
  assert.ok(report.error_type.length <= 80 && report.message.length <= 200 && report.route.length <= 80 && report.release.length <= 40)
})

test('ids and tokens in the address become :id and a long message is cut', () => {
  assert.equal(routePattern('/reschedule-response/AbC123_def-456ghiJKL789'), '/reschedule-response/:id')
  assert.equal(routePattern('/trial-session/confirm/9f8e7d6c-5b4a-3210-fedc-ba9876543210'), '/trial-session/confirm/:id')
  assert.equal(routePattern('/dashboard'), '/dashboard')
  assert.equal(routePattern('/'), '/')
  assert.ok(routePattern(`/${'a'.repeat(300)}`).length <= 80)
  assert.ok(shortMessage('x'.repeat(500)).length <= 200)
  assert.equal(shortMessage('first line\nsecond line with a stack'), 'first line')
})

test('what is not worth a report is ignored: a new version loading, cancelled requests, browser extensions, third-party scripts', () => {
  for (const noise of [
    new Error('Failed to fetch dynamically imported module: https://x/assets/a.js'), Object.assign(new Error('x'), { name: 'ChunkLoadError' }),
    Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }), new Error('at chrome-extension://abc/content.js'), new Error('Script error.'),
  ]) assert.equal(shouldIgnore(noise), true, String(noise))
  assert.equal(shouldIgnore(new TypeError('Cannot read properties of undefined')), false)
})

test('both boundaries report, keep showing their own screen, and nothing waits for the report', () => {
  const app = read('../components/AppErrorBoundary.jsx')
  assert.match(app, /reportError\(error\)/)
  assert.match(app, /RELOADED_KEY/)                                                              // one automatic reload per session
  assert.match(app, /sessionStorage\.getItem\(RELOADED_KEY\) !== '1'/)
  assert.match(read('../admin/AdminErrorBoundary.jsx'), /reportError\(error\)/)
  const source = read('./reportError.js')
  assert.doesNotMatch(source, /await /)                                                          // never waits
  assert.match(source, /catch \{/)                                                               // and swallows everything
  assert.doesNotMatch(source, /stack|localStorage|document\.cookie|getItem/)
})
