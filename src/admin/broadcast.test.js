// node --test src/admin/
import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays, emptyDraft, filterHistory, hasHtml, isDirty, isHttpUrl, previewItem, serverErrorKey, toPayload, validateDraft } from './broadcast.js'

const NOW = '2026-10-18T12:00'
const valid = (extra = {}) => ({ ...emptyDraft('es'), title: 'Hola', body: 'Cuerpo', ...extra })

test('an empty draft is clean, any text makes it dirty', () => {
  assert.equal(isDirty(emptyDraft()), false)
  assert.equal(isDirty(valid()), true)
  const translated = emptyDraft(); translated.translations.en.body = 'Hi'
  assert.equal(isDirty(translated), true)
})

test('a valid draft has no problems and the problems are found by field', () => {
  assert.deepEqual(validateDraft(valid(), NOW), {})
  assert.equal(validateDraft(emptyDraft(), NOW).title, 'bx_v_title_required')
  assert.equal(validateDraft(valid({ title: 'x'.repeat(121) }), NOW).title, 'bx_v_too_long')
  assert.equal(validateDraft(valid({ body: 'x'.repeat(2001) }), NOW).body, 'bx_v_too_long')
  assert.equal(validateDraft(valid({ body: 'hola <b>x</b>' }), NOW).body, 'bx_v_html')
  assert.equal(validateDraft(valid({ audience: 'user' }), NOW).person, 'bx_v_person')
  assert.deepEqual(validateDraft(valid({ audience: 'user', person: { id: 1, name: 'Ana', email: 'a@x.es' } }), NOW), {})
  const translated = valid(); translated.translations.en = { title: '<i>x</i>', body: '' }
  assert.equal(validateDraft(translated, NOW).t_en, 'bx_v_html')
  const own = valid(); own.translations.es = { title: '<i>x</i>', body: '' }             // the main language is not a translation
  assert.deepEqual(validateDraft(own, NOW), {})
})

test('the button needs a label and a valid destination', () => {
  assert.equal(validateDraft(valid({ button: true }), NOW).label, 'bx_v_label')
  assert.deepEqual(validateDraft(valid({ button: true, label: 'Ver' }), NOW), {})
  assert.equal(validateDraft(valid({ button: true, label: 'x'.repeat(41) }), NOW).label, 'bx_v_too_long')
  assert.equal(validateDraft(valid({ button: true, label: 'Ver', target: 'external', url: 'javascript:alert(1)' }), NOW).url, 'bx_v_url')
  assert.equal(validateDraft(valid({ button: true, label: 'Ver', target: 'external', url: 'ftp://x.example' }), NOW).url, 'bx_v_url')
  assert.deepEqual(validateDraft(valid({ button: true, label: 'Ver', target: 'external', url: 'https://thundbalance.com/x' }), NOW), {})
  assert.deepEqual(validateDraft(valid({ label: '', button: false }), NOW), {})                 // no button: nothing to check
})

test('scheduling: in the future, at most a year ahead; expiry after the send date', () => {
  assert.equal(validateDraft(valid({ when: 'later' }), NOW).sendAt, 'bx_v_send_at')
  assert.equal(validateDraft(valid({ when: 'later', sendAt: '2026-10-18T11:00' }), NOW).sendAt, 'bx_v_past')
  assert.equal(validateDraft(valid({ when: 'later', sendAt: NOW }), NOW).sendAt, 'bx_v_past')
  assert.equal(validateDraft(valid({ when: 'later', sendAt: '2028-01-01T09:00' }), NOW).sendAt, 'bx_v_far')
  assert.deepEqual(validateDraft(valid({ when: 'later', sendAt: '2026-12-24T09:00' }), NOW), {})
  assert.equal(validateDraft(valid({ expires: true }), NOW).expiresAt, 'bx_v_expiry_required')
  assert.equal(validateDraft(valid({ when: 'later', sendAt: '2026-12-24T09:00', expires: true, expiresAt: '2026-12-24T09:00' }), NOW).expiresAt, 'bx_v_expiry_after')
  assert.deepEqual(validateDraft(valid({ when: 'later', sendAt: '2026-12-24T09:00', expires: true, expiresAt: '2026-12-31T09:00' }), NOW), {})
  assert.equal(validateDraft(valid({ expires: true, expiresAt: '2026-10-18T11:00' }), NOW).expiresAt, 'bx_v_expiry_after')   // sending now: after now
  assert.equal(addDays('2026-12-30T09:00', 3), '2027-01-02T09:00')
})

test('the payload sent to the server', () => {
  const draft = valid({ audience: 'user', person: { id: 3, name: 'Ana', email: 'ana@x.es' }, button: true, label: ' Ver ', target: '/my-sessions', when: 'later', sendAt: '2026-12-24T09:00', expires: true, expiresAt: '2026-12-31T09:00' })
  draft.translations.en = { title: ' Hello ', body: '' }
  draft.translations.ca = { title: '', body: '' }
  assert.deepEqual(toPayload(draft, 'key-1'), {
    audience: 'user', email: 'ana@x.es', main_lang: 'es', title: 'Hola', body: 'Cuerpo', translations: { en: { title: 'Hello' } },
    action_label: 'Ver', action_target: '/my-sessions', visible_from: '2026-12-24T09:00', expires_at: '2026-12-31T09:00', idempotency_key: 'key-1'
  })
  const simple = toPayload(valid(), 'key-2')
  assert.deepEqual(Object.keys(simple).sort(), ['audience', 'body', 'idempotency_key', 'main_lang', 'title'])
  const external = toPayload(valid({ button: true, label: 'Web', target: 'external', url: ' https://a.example/x ' }), 'k')
  assert.equal(external.action_target, 'https://a.example/x')
})

test('the preview uses the translation of each part, or the written text', () => {
  const draft = valid({ button: true, label: 'Ver', target: '/profile' })
  draft.translations.en = { title: 'Hello', body: '' }
  const english = previewItem(draft, 'en', NOW)
  assert.deepEqual([english.title, english.body], ['Hello', 'Cuerpo'])
  assert.deepEqual([previewItem(draft, 'es', NOW).title, previewItem(draft, 'ca', NOW).title], ['Hola', 'Hola'])
  assert.deepEqual(english.actions, [{ type: 'link', label: 'Ver', target: '/profile', state: 'available' }])
  assert.deepEqual(previewItem(valid(), 'es', NOW).actions, [])
})

test('html, addresses, server errors and the history filters', () => {
  assert.equal(hasHtml('2 < 3 and 5 > 4'), false)
  assert.equal(hasHtml('hola <script>'), true)
  assert.equal(isHttpUrl('http://ok.example'), true)
  assert.equal(isHttpUrl('//evil.example'), false)
  assert.equal(isHttpUrl('data:text/html,x'), false)
  assert.equal(serverErrorKey('date_in_past'), 'bx_err_date_in_past')
  assert.equal(serverErrorKey('whatever'), 'bx_err_generic')
  const items = [{ title: 'Cierre del estudio', status: 'sent' }, { title: 'Oferta', status: 'scheduled' }, { title: 'Antigua', status: 'expired' }]
  assert.equal(filterHistory(items, { q: 'CIERRE' }).length, 1)
  assert.equal(filterHistory(items, { status: 'scheduled' })[0].title, 'Oferta')
  assert.equal(filterHistory(items, { q: 'a', status: 'expired' }).length, 1)
  assert.equal(filterHistory(items).length, 3)
})
