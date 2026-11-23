import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ADMIN_SEGMENT, adminUrl, getAdminPath, isAdminLocation, setAdminPath } from './adminUrl.js'
import { routePattern } from '../utils/reportErrorCore.js'

// The address of the admin panel is a secret of the server (docs/ADMIN_ACCESS.md): the code builds every link with adminUrl() and never writes it down.
const FAKE = 'fakepath0123ab'           // made up
const src = fileURLToPath(new URL('../', import.meta.url))
const root = fileURLToPath(new URL('../../', import.meta.url))

function files(dir, accept) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : files(path, accept)
    return accept(path) ? [path] : []
  })
}

test('adminUrl builds the address under the secret path, and without one it adds no prefix', () => {
  setAdminPath('')
  assert.equal(adminUrl('/clients'), '/clients')
  setAdminPath(FAKE)
  assert.equal(getAdminPath(), FAKE)
  assert.equal(adminUrl(), `/${FAKE}`)
  assert.equal(adminUrl('/clients'), `/${FAKE}/clients`)
  assert.equal(adminUrl('clients'), `/${FAKE}/clients`)
  assert.equal(adminUrl('/clients?client=3'), `/${FAKE}/clients?client=3`)
  assert.equal(adminUrl('#deletion-requests'), `/${FAKE}#deletion-requests`)
  assert.equal(adminUrl('?x=1'), `/${FAKE}?x=1`)
})

test('only a well-formed path is accepted (14 characters, a-z and 0-9): anything else leaves no prefix', () => {
  for (const bad of ['', 'admin', 'ABCDEFGHIJKLMN', 'fakepath0123a', 'fakepath0123abc', 'fake-path0123a', '../../x', null, undefined, 42]) {
    setAdminPath(bad)
    assert.equal(getAdminPath(), '', String(bad))
  }
  assert.ok(ADMIN_SEGMENT.test(FAKE))
  setAdminPath(FAKE)
  assert.equal(getAdminPath(), FAKE)
})

test('isAdminLocation tells whether the address is inside the panel', () => {
  setAdminPath(FAKE)
  assert.equal(isAdminLocation(`/${FAKE}`), true)
  assert.equal(isAdminLocation(`/${FAKE}/clients`), true)
  assert.equal(isAdminLocation(`/${FAKE}x`), false)
  assert.equal(isAdminLocation('/dashboard'), false)
  assert.equal(isAdminLocation('/admin'), false)
  setAdminPath('')
  assert.equal(isAdminLocation('/anything'), false)
})

test('the panel path is never reported with an error: the route pattern hides it', () => {
  assert.equal(routePattern(`/${FAKE}/clients/123`), '/:panel/clients/:id')
  assert.equal(routePattern(`/${FAKE}`), '/:panel')
  assert.equal(routePattern('/dashboard'), '/dashboard')
  assert.equal(routePattern('/my-sessions'), '/my-sessions')
})

test('no page, link, redirect or route of the code writes the address of the panel: everything goes through adminUrl()', () => {
  const FIXED = [
    /\bto="\/admin/, /\bto=\{`\/admin/, /\bto=\{'\/admin/, /navigate\(\s*['"`]\/admin/, /\bhref="\/admin/, /\bto: ['"`]\/admin/, /<Route path="\/admin/, /<Navigate to="\/admin/,
    /pathname\.startsWith\('\/admin/, /location\.(href|pathname)\s*=\s*['"`]\/admin/,
  ]
  for (const path of files(src, (file) => /\.(jsx?|mjs)$/.test(file) && !/\.(test|spec)\./.test(file))) {
    const text = readFileSync(path, 'utf8').replace(/\/\/.*$/gm, '')
    for (const pattern of FIXED) assert.doesNotMatch(text, pattern, `${relative(root, path)} writes the address of the panel (${pattern})`)
  }
})

test('the public files and the headers do not name the panel', () => {
  for (const name of ['public/robots.txt', 'public/sitemap.xml', 'vercel.json', 'index.html']) {
    const text = readFileSync(join(root, name), 'utf8').toLowerCase()
    assert.doesNotMatch(text, /\/admin|wp-admin|administrator/, name)
  }
})

test('the e-mails to the team link to the panel through the stored path, never to a fixed address', () => {
  for (const name of ['contact_emails.py', 'reschedule_emails.py', 'trial_emails.py']) {
    const text = readFileSync(join(root, 'backend', 'emails', name), 'utf8')
    assert.doesNotMatch(text, /\{site_url\(\)\}\/admin/, name)
    assert.match(text, /admin_url\(/, name)
  }
})
