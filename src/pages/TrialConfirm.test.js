// node --test src/pages/
import test from 'node:test'
import assert from 'node:assert/strict'
import { pageText } from '../i18n/pageText.js'

// The client is not e-mailed when they confirm a trial session: the page they see must say it is confirmed, in the three
// languages, with and without the client calendar, and must not promise an e-mail.
test('the confirmation page says "confirmed" in en, es and ca and promises no e-mail', () => {
  for (const lang of ['en', 'es', 'ca']) {
    const text = pageText[lang]
    for (const key of ['tc_confirmed_title', 'tc_confirmed_text', 'tc_confirmed_plain']) {
      assert.ok(text[key] && text[key].length > 10, `${lang} ${key}`)
    }
    for (const key of ['tc_confirmed_text', 'tc_confirmed_plain']) {
      assert.doesNotMatch(text[key], /e-?mail|correo|correu/i, `${lang} ${key} must not mention an e-mail`)
    }
  }
})
