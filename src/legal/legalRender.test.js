import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DOCS, MODELS, ROUTES, TITLES, modelText } from './legalModels.js'
import { blocks, fill, pendingMarks, pieces, templateData, updatedDate } from './legalRender.js'

const COMPANY = { holder: 'Estudio Prueba S.L.', tax_id: 'B00000000', address: 'Calle Falsa 1, Barcelona', email: 'legal@prueba.example',
  retention_contact_days: 365, retention_trial_days: 365, retention_email_log_days: 180 }
const LANGS = ['es', 'en', 'ca']
const text = (list) => list.map(block => block.type === 'ul' ? block.items.map(i => i.map(p => p.text).join('')).join('\n') : block.pieces.map(p => p.text).join('')).join('\n')

test('the five documents exist in Spanish, English and Catalan, each with a title and its own route', () => {
  assert.deepEqual(DOCS, ['privacy', 'legal', 'terms', 'cancellations', 'cookies'])
  for (const doc of DOCS) {
    assert.ok(ROUTES[doc].startsWith('/'))
    for (const lang of LANGS) {
      assert.ok(MODELS[doc][lang].length > 200, `${doc}/${lang}`)
      assert.ok(TITLES[doc][lang], `${doc}/${lang} title`)
    }
  }
  assert.equal(modelText('privacy', 'fr'), MODELS.privacy.en)           // another language falls back to English
})

test('with the company data the legal notice and the privacy policy name the holder, in the three languages', () => {
  for (const lang of LANGS) {
    for (const doc of ['legal', 'privacy']) {
      const shown = text(blocks(modelText(doc, lang), COMPANY))
      assert.ok(shown.includes('Estudio Prueba S.L.') && shown.includes('B00000000') && shown.includes('legal@prueba.example'), `${doc}/${lang}`)
    }
  }
})

test('the privacy policy lists the real providers, the transfers, the retention periods and the rights', () => {
  for (const lang of LANGS) {
    const shown = text(blocks(modelText('privacy', lang), COMPANY))
    for (const needle of ['Google Workspace', 'Firebase', 'Render', 'Vercel', 'aepd.es', '365', '180']) assert.ok(shown.includes(needle), `${lang}: ${needle}`)
  }
})

test('without company data the public does not see the lines that need it; the admin sees them marked', () => {
  const model = modelText('legal', 'es')
  const publicText = text(blocks(model, {}))
  assert.ok(!publicText.includes('NIF/CIF'), 'the line with the empty tax id is hidden')
  assert.ok(!publicText.includes('{{') && !publicText.includes('[['))
  assert.ok(publicText.includes('Objeto'), 'the rest of the page is still there')
  const adminBlocks = blocks(model, {}, { admin: true })
  const marks = adminBlocks.flatMap(block => block.type === 'ul' ? block.items.flat() : block.pieces).filter(piece => piece.mark)
  assert.ok(marks.length >= 3 && marks.some(mark => mark.text.startsWith('FALTA')))
  assert.ok(pendingMarks(model, {}) >= 3)
  assert.equal(pendingMarks('## T\nTodo bien', COMPANY), 0)
})

test('the [[REVIEW]] decisions of the owner are hidden from the public and shown to the admin', () => {
  const model = modelText('cancellations', 'es')
  assert.ok(!text(blocks(model, COMPANY)).includes('REVIEW'))
  assert.ok(text(blocks(model, COMPANY, { admin: true })).includes('REVIEW'))
  // the real rules are in the public text: 24 h, one change, the studio approves, Monday to Friday
  const shown = text(blocks(model, COMPANY))
  assert.ok(shown.includes('24 horas') && shown.includes('una sola vez') && shown.includes('aprobarlo') && shown.includes('lunes a viernes'))
})

test('a text edited by the admin with HTML stays text: only titles, lists and paragraphs come out', () => {
  const evil = '## <script>alert(1)</script>\n- <img src=x onerror=alert(1)>\n<b>hola</b> {{holder}}'
  const out = blocks(evil, COMPANY)
  assert.deepEqual(out.map(block => block.type), ['h', 'ul', 'p'])
  assert.equal(out[0].pieces[0].text, '<script>alert(1)</script>')      // a plain string: React escapes it
  assert.equal(out[2].pieces.map(p => p.text).join(''), '<b>hola</b> Estudio Prueba S.L.')
  const page = readFileSync(new URL('./LegalBlocks.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(page, /dangerouslySetInnerHTML|innerHTML/)
})

test('placeholders, marks and the date of the text', () => {
  assert.equal(fill('a {{holder}} b', { holder: 'X' }), 'a X b')
  assert.equal(fill('a {{holder}} b', { holder: '' }), 'a [[FALTA: razón social / titular]] b')
  assert.deepEqual(pieces('uno [[dos]] tres'), [{ text: 'uno ', mark: false }, { text: 'dos', mark: true }, { text: ' tres', mark: false }])
  assert.equal(templateData({ retention_contact_days: 30 }).retention_contact, '30')
  assert.equal(updatedDate({ updated_at: '2026-12-01T10:00:00' }, { last_review: '2026-11-01' }), '2026-12-01')
  assert.equal(updatedDate(null, { last_review: '2026-11-01' }), '2026-11-01')
})

test('the health consent, the consents of the forms and the cookie link use the real names of the code', () => {
  const cookies = text(blocks(modelText('cookies', 'es'), COMPANY))
  for (const needle of ['tb_language', 'tb_cookie_consent', 'Firebase', 'Google Maps', 'YouTube', 'Vimeo', 'Instagram', 'Configurar cookies']) assert.ok(cookies.includes(needle), needle)
  assert.ok(text(blocks(modelText('privacy', 'es'), COMPANY)).includes('consentimiento explícito'))
})
