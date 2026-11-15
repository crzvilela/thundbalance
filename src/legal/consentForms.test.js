import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const root = new URL('../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('the four forms carry the unchecked consent box, send the proof and keep the button off until it is ticked', () => {
  const forms = {
    'src/pages/Register.jsx': /disabled=\{submitting \|\| !accepted\}/,
    'src/pages/Trialsession.jsx': /!accepted \|\|/,
    'src/components/Contact.jsx': /!accepted\)/,
    'src/pages/TrainingRequest.jsx': /disabled=\{submitting \|\| !chosenPack \|\| !accepted\}/
  }
  for (const [file, disabled] of Object.entries(forms)) {
    const source = read(file)
    assert.match(source, /<ConsentCheckbox/, file)
    assert.match(source, /useState\(false\)/, file)                                    // unchecked by default
    assert.match(source, /privacy_consent: true/, file)
    assert.match(source, /consent_version: consentVersion/, file)
    assert.match(source, disabled, file)
    assert.match(source, /consentRequired/, file)                                      // and the submit itself checks it again
  }
  assert.match(read('src/pages/Register.jsx'), /<ConsentCheckbox terms/)               // the account and the packs also accept the Terms
  assert.match(read('src/pages/TrainingRequest.jsx'), /<ConsentCheckbox terms/)
})

test('the rehabilitation goal asks for its own explicit consent and the server is told', () => {
  const trial = read('src/pages/Trialsession.jsx')
  assert.match(trial, /HEALTH_GOAL = 'Rehabilitation\/injury recovery'/)
  assert.match(trial, /<ConsentCheckbox health/)
  assert.match(trial, /health_consent: form\.goals\.includes\(HEALTH_GOAL\) \? true : undefined/)
})

test('the login and register screens link the legal texts', () => {
  assert.match(read('src/pages/Login.jsx'), /href="\/privacy"[\s\S]*href="\/terms"/)
  assert.match(read('src/components/ConsentCheckbox.jsx'), /href="\/privacy"[\s\S]*href="\/terms"/)
})

test('the footer links the five documents and the cookie settings', () => {
  const footer = read('src/components/Footer.jsx')
  for (const href of ['/privacy', '/terms', '/cancellations', '/cookies', '/legal-notice']) assert.ok(footer.includes(`href="${href}"`), href)
  assert.match(footer, /onClick=\{openPreferences\}/)
  const routes = read('src/routes/AppRoutes.jsx')
  for (const page of ['privacy', 'legal', 'terms', 'cancellations', 'cookies']) assert.match(routes, new RegExp(`<LegalPage page="${page}"`))
})

test('no third party is asked for anything when the page opens: no Google Fonts, no avatar service, maps and reviews only behind the consent gate', () => {
  assert.doesNotMatch(read('index.html'), /fonts\.googleapis|fonts\.gstatic|<link[^>]+preconnect/)
  const walk = (dir) => readdirSync(new URL(dir, root)).flatMap(name => {
    const path = `${dir}${name}`
    return statSync(new URL(path, root)).isDirectory() ? walk(`${path}/`) : [path]
  })
  const sources = walk('src/').filter(path => /\.(jsx?|css)$/.test(path) && !path.endsWith('.test.js'))
  for (const path of sources) {
    const source = read(path)
    assert.doesNotMatch(source, /fonts\.googleapis|fonts\.gstatic|ui-avatars/, path)
    if (/maps\.googleapis\.com\/maps\/api\/js|elfsightcdn\.com\/platform\.js/.test(source)) assert.match(source, /ConsentGate/, `${path} loads a third-party script and must sit behind ConsentGate`)
  }
  assert.match(read('src/components/GoogleReviews.jsx'), /<ConsentGate className="min-h-56" kind="reviews">/)
  assert.match(read('src/components/TrainingVideoPlayer.jsx'), /<ConsentGate className="h-full" kind="video">/)
})

test('the banner offers accept all, reject all and configure with the same look', () => {
  const banner = read('src/components/ConsentBanner.jsx')
  for (const key of ['text.rejectAll', 'text.acceptAll', 'text.configure']) assert.ok(banner.includes(key), key)
  assert.equal((banner.match(/className=\{BUTTON\}/g) || []).length, 4)                 // reject, accept and configure / save share one class
  assert.match(read('src/components/Footer.jsx'), /cookieSettings/)
})

test('every font the editor offers is installed locally: nothing is left to ask Google for', async () => {
  const { FONT_OPTIONS, actualFontFamily } = await import('../utils/fonts.js')
  const css = read('src/fonts.css')
  const installed = new Set([...css.matchAll(/font-family:\s*'([^']+)'/g)].map(match => match[1]))
  for (const label of FONT_OPTIONS) assert.ok(installed.has(actualFontFamily(label)), `${label} is not in src/fonts.css`)
  for (const name of ['Bebas Neue', 'Inter', 'Roboto', 'Aldrich']) assert.ok(installed.has(name), name)           // the families the site always used
  assert.doesNotMatch(css, /https?:/)                                                                              // every file is ours
  assert.match(read('src/main.jsx'), /import '\.\/fonts\.css'/)
  assert.doesNotMatch(read('src/utils/fonts.js'), /googleapis|createElement\('link'\)/)
})
