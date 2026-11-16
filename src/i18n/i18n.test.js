import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { translations } from './translations.js'
import { FORM_TEXT } from './formText.js'
import { adminText } from '../admin/adminText.js'
import { UI } from '../legal/legalText.js'
import { DOCS, MODELS, TITLES } from '../legal/legalModels.js'

// The site speaks English, Spanish and Catalan (the admin panel English and Spanish). A text that exists in one language and not in the
// others shows as a raw key on screen: these tests fail when that happens.
const src = fileURLToPath(new URL('../', import.meta.url))
const placeholders = text => [...String(text).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(match => match[1]).sort().join(',')

function sameKeys(table, languages, label) {
  const all = new Set(languages.flatMap(language => Object.keys(table[language])))
  for (const language of languages) {
    const missing = [...all].filter(key => !(key in table[language]))
    assert.deepEqual(missing, [], `${label}: ${language} is missing ${missing.length} key(s): ${missing.slice(0, 8).join(', ')}`)
  }
  return all
}

function sameTexts(table, languages, label) {
  const keys = sameKeys(table, languages, label)
  for (const key of keys) {
    const first = table[languages[0]][key]
    for (const language of languages) {
      const value = table[language][key]
      if (typeof first !== 'string') {                              // a list or a table (weekday names...): the same shape in every language
        assert.equal(typeof value, typeof first, `${label}: ${language}.${key} is not a ${typeof first}`)
        if (Array.isArray(first)) assert.equal(value.length, first.length, `${label}: ${language}.${key} has another length`)
        else assert.deepEqual(Object.keys(value).sort(), Object.keys(first).sort(), `${label}: ${language}.${key} has other keys`)
        continue
      }
      assert.equal(typeof value, 'string', `${label}: ${language}.${key} is not a text`)
      assert.ok(value.trim() !== '', `${label}: ${language}.${key} is empty`)
      assert.equal(placeholders(value), placeholders(first), `${label}: ${language}.${key} has other {placeholders} than ${languages[0]}`)
    }
  }
}

test('the client site has every text in English, Spanish and Catalan, with the same {placeholders}', () => {
  sameTexts(translations, ['en', 'es', 'ca'], 'translations')
})

test('the shared form fields have every text in the three languages', () => {
  sameTexts(FORM_TEXT, ['en', 'es', 'ca'], 'formText')
})

test('the admin panel has every text in English and Spanish', () => {
  sameTexts(adminText, ['en', 'es'], 'adminText')
})

test('the legal documents and the cookie notice exist in the three languages, with the same number of sections', () => {
  sameKeys(UI, ['en', 'es', 'ca'], 'legal UI')
  for (const doc of DOCS) {
    const sections = ['en', 'es', 'ca'].map(language => {
      assert.ok(MODELS[doc][language]?.trim(), `${doc}.${language} has no text`)
      assert.ok(TITLES[doc]?.[language], `${doc}.${language} has no title`)
      return (MODELS[doc][language].match(/^## /gm) || []).length
    })
    assert.equal(new Set(sections).size, 1, `${doc}: the three languages have different numbers of sections (${sections})`)
  }
})

function files(folder) {
  return readdirSync(folder).flatMap(name => {
    const path = join(folder, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

test('every text key a page asks for exists (no raw key ever reaches the screen)', () => {
  const missing = []
  for (const path of files(src).filter(file => /\.(jsx|js)$/.test(file) && !/\.test\./.test(file))) {
    const name = relative(src, path).replace(/\\/g, '/')
    const admin = name.startsWith('admin/') || name.startsWith('pages/admin/') || name.startsWith('components/admin/')
    const table = admin ? adminText.es : translations.es
    const body = readFileSync(path, 'utf8')
    if (!/useI18n|useAdminText/.test(body)) continue
    for (const match of body.matchAll(/[^A-Za-z0-9_.$]t\(\s*(['"])([A-Za-z][A-Za-z0-9_.-]*)\1\s*[,)]/g)) {
      const key = match[2]
      if (!(key in table) && !(key in translations.es) && !(key in adminText.es)) missing.push(`${name}: ${key}`)
    }
  }
  assert.deepEqual(missing, [], `keys used in the code but missing from the dictionaries:\n${missing.join('\n')}`)
})

test('the text of the login and the registration is in the dictionaries (it used to be fixed in English)', () => {
  for (const key of ['lgn_title', 'lgn_email', 'lgn_password', 'lgn_submit', 'lgn_google', 'lgn_no_account', 'lgn_register',
    'rg_title', 'rg_submit', 'rg_have_account', 'rg_login', 'rg_err_exists', 'rg_err_weak', 'rg_err_generic']) {
    for (const language of ['en', 'es', 'ca']) assert.ok(translations[language][key], `${language} is missing ${key}`)
  }
  assert.notEqual(translations.es.lgn_submit, translations.en.lgn_title)
  assert.notEqual(translations.es.lgn_google, translations.en.lgn_google)
  assert.notEqual(translations.ca.lgn_google, translations.en.lgn_google)
})
