// node --test src/utils/
import test from 'node:test'
import assert from 'node:assert/strict'
import { badgeText, doneLabelKey, fullDate, isLong, madridWallToInstant, preview, relativeTime, resultKey } from './inboxFormat.js'
import { linkify } from './linkify.js'

test('the badge: nothing for zero, the number, then 9+', () => {
  assert.equal(badgeText(0), '')
  assert.equal(badgeText(undefined), '')
  assert.equal(badgeText(3), '3')
  assert.equal(badgeText(9), '9')
  assert.equal(badgeText(10), '9+')
  assert.equal(badgeText(250), '9+')
})

test('Madrid wall clock to the real instant, in summer and in winter', () => {
  assert.equal(madridWallToInstant('2026-07-15T12:00:00').toISOString(), '2026-07-15T10:00:00.000Z')     // UTC+2
  assert.equal(madridWallToInstant('2026-12-15T12:00:00').toISOString(), '2026-12-15T11:00:00.000Z')     // UTC+1
  assert.equal(madridWallToInstant('2026-10-25T01:30:00').toISOString(), '2026-10-24T23:30:00.000Z')     // before the clocks go back
  assert.equal(madridWallToInstant('nonsense'), null)
})

test('relative time in the language of the site', () => {
  const now = new Date('2026-07-15T10:00:00Z')
  assert.equal(relativeTime('2026-07-15T11:59:50', now, 'es-ES'), 'ahora')
  assert.equal(relativeTime('2026-07-15T10:00:00', now, 'es-ES'), 'hace 2 horas')
  assert.equal(relativeTime('2026-07-15T11:30:00', now, 'en-GB'), '30 minutes ago')
  assert.equal(relativeTime('2026-07-13T12:00:00', now, 'en-GB'), '2 days ago')
  assert.match(relativeTime('2026-05-01T12:00:00', now, 'ca-ES'), /2026/)                               // old: a date
  assert.equal(relativeTime('2026-07-15T13:00:00', now, 'en-GB'), 'now')                               // never "in the future"
  assert.match(fullDate('2026-10-21T18:00:00', 'es-ES'), /18:00/)
})

test('previews and long texts', () => {
  assert.equal(preview('  Hola\n\n  mundo  '), 'Hola mundo')
  assert.equal(preview('x'.repeat(200), 20).length, 20)
  assert.equal(isLong('corto'), false)
  assert.equal(isLong('a\nb\nc\nd\ne'), true)
  assert.equal(isLong('x'.repeat(300)), true)
})

test('links: only http(s), punctuation stays outside, everything else is text', () => {
  assert.deepEqual(linkify('Mira https://thundbalance.com/oferta, gracias.'), [
    { text: 'Mira ' }, { href: 'https://thundbalance.com/oferta', text: 'https://thundbalance.com/oferta' }, { text: ', gracias.' }])
  assert.deepEqual(linkify('sin enlaces'), [{ text: 'sin enlaces' }])
  assert.deepEqual(linkify('javascript:alert(1) data:text/html,<b>x</b>'), [{ text: 'javascript:alert(1) data:text/html,<b>x</b>' }])
  assert.deepEqual(linkify('(http://a.example/x?y=1)'), [{ text: '(' }, { href: 'http://a.example/x?y=1', text: 'http://a.example/x?y=1' }, { text: ')' }])
  assert.deepEqual(linkify(''), [])
  assert.equal(linkify('<img src=x onerror=alert(1)> http://ok.example').filter(piece => piece.href).length, 1)
})

test('what the card says after a button, and the badge that replaces the buttons', () => {
  assert.equal(resultKey('trial_confirm', 'confirmed'), 'in_res_confirmed')
  assert.equal(resultKey('trial_confirm', 'already_confirmed'), 'in_res_confirmed')
  assert.equal(resultKey('trial_decline', 'declined'), 'in_res_declined_trial')
  assert.equal(resultKey('reschedule_accept', 'accepted'), 'in_res_accepted')
  assert.equal(resultKey('reschedule_reject', 'declined'), 'in_res_rejected')
  assert.equal(resultKey('trial_confirm', 'expired'), 'in_res_expired')
  assert.equal(resultKey('trial_confirm', 'unavailable'), 'in_res_done_before')
  assert.equal(doneLabelKey('trial_confirm', 'confirmed'), 'in_done_confirmed')
  assert.equal(doneLabelKey('trial_decline', 'declined'), 'in_done_declined')
  assert.equal(doneLabelKey('reschedule_accept', 'accepted'), 'in_done_accepted')
  assert.equal(doneLabelKey('reschedule_reject', 'declined'), 'in_done_rejected')
  assert.equal(doneLabelKey('trial_confirm', undefined), 'in_done')                 // answered on another visit: "Answered"
})
