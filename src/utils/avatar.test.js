import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { initialsAvatar, initialsOf } from './avatar.js'

test('the initials come from the name, at most two, only letters', () => {
  assert.equal(initialsOf('Ana García López'), 'AG')
  assert.equal(initialsOf('  maría '), 'M')
  assert.equal(initialsOf('<script>alert(1)</script> x'), 'SX')       // no markup can get through: only letters are kept
  assert.equal(initialsOf(''), '?')
  assert.equal(initialsOf('123 456'), '?')
})

test('the avatar is a local data: image and the name is never in a request', () => {
  const src = initialsAvatar('Ana García')
  assert.ok(src.startsWith('data:image/svg+xml;utf8,'))
  assert.ok(!/https?:/.test(decodeURIComponent(src.replace('data:image/svg+xml;utf8,', '')).replace('http://www.w3.org/2000/svg', '')))
  const navbar = readFileSync(new URL('../components/Navbar.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(navbar, /ui-avatars/)
})
