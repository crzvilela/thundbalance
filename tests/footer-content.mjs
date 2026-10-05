import assert from 'node:assert/strict'
import { contactItems, socialLinks, mapFromLocation, safeLink, validateFooter } from '../src/utils/footerContent.js'

assert.equal(contactItems({ contactEmail: 'studio@example.com' })[0].value, 'studio@example.com')
assert.deepEqual(contactItems({ contactEmail: 'studio@example.com', contactItems: [] }), [])
assert.deepEqual(socialLinks({ instagramUrl: 'https://instagram.com/example', socialLinks: [] }), [])
assert.equal(safeLink('javascript:alert(1)'), undefined)
assert.equal(safeLink('mailto:studio@example.com', true), 'mailto:studio@example.com')
assert.match(mapFromLocation('Barcelona, Spain', 'https://maps.app.goo.gl/abc'), /q=Barcelona%2C%20Spain/)
assert.throws(() => mapFromLocation('', 'https://maps.app.goo.gl/abc'), /address/)
assert.throws(() => mapFromLocation('Barcelona', 'https://google.com.evil.example/maps'), /Google Maps/)
assert.match(mapFromLocation('', 'https://www.google.com/maps/place/Studio+Barcelona/'), /q=Studio%20Barcelona/)
assert.match(mapFromLocation('', 'https://www.google.com/maps?query=Barcelona'), /q=Barcelona/)
const existing = 'https://www.google.com/maps/embed?pb=example'
assert.equal(mapFromLocation('', existing), existing)
assert.match(validateFooter({ contactItems: [{ type: 'email', value: 'invalid' }] }), /email/)
assert.equal(validateFooter({ contactItems: [{ type: 'email', value: 'studio@example.com' }], socialLinks: [] }), '')
console.log('Footer content checks passed')
