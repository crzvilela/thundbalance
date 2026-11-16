import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// public/lang-init.js sets <html lang> before the first paint: the saved language, else ?lang=xx, else the page's own "en".
const source = readFileSync(new URL('../../public/lang-init.js', import.meta.url), 'utf8')

function run({ stored, search = '', storageThrows = false, initial = 'en' }) {
  const documentElement = { lang: initial }
  const window = {
    localStorage: { getItem: () => { if (storageThrows) throw new Error('blocked'); return stored ?? null } },
    location: { search }
  }
  vm.runInNewContext(source, { window, document: { documentElement }, URLSearchParams })
  return documentElement.lang
}

test('the language the visitor saved is the document language from the first moment', () => {
  assert.equal(run({ stored: 'es' }), 'es')
  assert.equal(run({ stored: 'ca' }), 'ca')
  assert.equal(run({ stored: 'en' }), 'en')
})

test('the language in the link counts when nothing is saved, and a saved one wins', () => {
  assert.equal(run({ search: '?lang=ca' }), 'ca')
  assert.equal(run({ stored: 'es', search: '?lang=ca' }), 'es')
})

test('anything unknown, or blocked storage, leaves the page as it was', () => {
  assert.equal(run({ stored: 'fr' }), 'en')
  assert.equal(run({ search: '?lang=de' }), 'en')
  assert.equal(run({ storageThrows: true }), 'en')
  assert.equal(run({ storageThrows: true, search: '?lang=es' }), 'es')
  assert.equal(run({}), 'en')
})

test('the page loads it as a file (the policy forbids inline scripts) and the same languages as the site', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  assert.match(html, /<script src="\/lang-init\.js"><\/script>/)
  assert.match(html, /<html lang="en">/)
  assert.ok(html.indexOf('lang-init.js') < html.indexOf('/src/main.jsx'), 'it must run before the app')
  assert.match(source, /tb_language/)
})
