import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The Content-Security-Policy that Vercel sends (vercel.json). These checks keep it from being opened again by accident:
// no 'unsafe-inline' for scripts, no "any https" for images or videos, and no inline script in the page.
const root = new URL('../', import.meta.url)
const config = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8'))
const header = config.headers.find(rule => rule.source === '/(.*)').headers
const csp = header.find(item => item.key === 'Content-Security-Policy').value
const directives = Object.fromEntries(csp.split(';').map(part => part.trim()).filter(Boolean).map(part => {
  const [name, ...values] = part.split(/\s+/)
  return [name, values]
}))

test('scripts: no inline code and no eval, only the sites the page really loads from', () => {
  const scripts = directives['script-src']
  assert.ok(scripts.includes("'self'"))
  assert.ok(!scripts.includes("'unsafe-inline'"), "script-src must not allow 'unsafe-inline'")
  assert.ok(!scripts.includes("'unsafe-eval'"), "script-src must not allow 'unsafe-eval'")
  assert.ok(!scripts.some(value => value === '*' || value === 'https:' || value === 'http:' || value === 'data:'))
  const allowed = new Set([
    "'self'", 'https://apis.google.com', 'https://maps.googleapis.com', 'https://elfsightcdn.com', 'https://*.elfsightcdn.com',
    'https://*.elfsight.com', 'https://www.gstatic.com'
  ])
  for (const value of scripts) assert.ok(allowed.has(value), `script-src has an unexpected source: ${value}`)
})

test('images: our own site, data, blob and a short list of hosts; never "any https"', () => {
  const images = directives['img-src']
  for (const required of ["'self'", 'data:', 'blob:', 'https://thundbalance.onrender.com', 'https://thundbalance-api.onrender.com', 'https://*.googleusercontent.com']) {
    assert.ok(images.includes(required), `img-src must allow ${required}`)
  }
  for (const value of images) {
    assert.ok(!['https:', 'http:', '*'].includes(value), `img-src must not allow ${value}`)
    assert.ok(value.startsWith("'") || value.endsWith(':') || /^https:\/\/[^/]+$/.test(value), `img-src has an odd source: ${value}`)
  }
  assert.ok(!images.some(value => value.startsWith('http://')))
})

test('videos come from our own site only', () => {
  const media = directives['media-src']
  assert.ok(!media.some(value => ['https:', 'http:', '*'].includes(value)))
  assert.ok(media.includes("'self'") && media.includes('https://thundbalance.onrender.com'))
})

test('the rest of the policy keeps its limits', () => {
  assert.deepEqual(directives['default-src'], ["'self'"])
  assert.deepEqual(directives['object-src'], ["'none'"])
  assert.deepEqual(directives['base-uri'], ["'self'"])
  assert.deepEqual(directives['frame-ancestors'], ["'self'"])
  assert.deepEqual(directives['form-action'], ["'self'"])
  for (const name of ['connect-src', 'frame-src', 'font-src', 'style-src']) {
    assert.ok(!directives[name].some(value => ['https:', 'http:', '*'].includes(value)), `${name} must not allow everything`)
  }
  assert.ok(!(config.headers.flatMap(rule => rule.headers).some(item => item.key === 'Content-Security-Policy-Report-Only')),
    'the policy is enforced, not only reported')
})

test('the page has no inline script (the only inline block is data: JSON-LD)', () => {
  const html = readFileSync(new URL('index.html', root), 'utf8')
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map(match => match[1])
  for (const attributes of scripts) {
    const external = /\bsrc=/.test(attributes)
    const data = /type=["']application\/ld\+json["']/.test(attributes)
    assert.ok(external || data, `an inline script would be blocked by the policy: <script${attributes}>`)
  }
})
