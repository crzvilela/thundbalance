import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loginErrorKey } from '../utils/loginErrors.js'
import { pageText } from '../i18n/pageText.js'

const login = readFileSync(new URL('./Login.jsx', import.meta.url), 'utf8')

test('a successful login shows no message and goes to the dashboard', () => {
  assert.doesNotMatch(login, /alert\(|toast|successful/i)
  assert.equal((login.match(/navigate\('\/dashboard'\)/g) || []).length, 2)        // password and Google
  assert.ok(login.indexOf("navigate('/dashboard')") < login.indexOf('catch'))
})

test('a failed login is a line of text next to the form, never a pop-up', () => {
  assert.match(login, /role="alert"/)
  assert.match(login, /setProblem\(loginErrorKey\(error\)/)
  assert.equal(loginErrorKey({ code: 'auth/invalid-credential' }), 'lgn_err_credentials')
  assert.equal(loginErrorKey({ code: 'auth/too-many-requests' }), 'lgn_err_many')
  assert.equal(loginErrorKey({ code: 'auth/network-request-failed' }), 'lgn_err_network')
  assert.equal(loginErrorKey({ code: 'something-new' }), 'lgn_err_generic')
  assert.equal(loginErrorKey(new Error('boom')), 'lgn_err_generic')
  assert.equal(loginErrorKey({ code: 'auth/popup-closed-by-user' }), null)           // closing the Google window is not an error
})

test('every login error text exists in Spanish, English and Catalan', () => {
  const keys = ['lgn_err_credentials', 'lgn_err_email', 'lgn_err_disabled', 'lgn_err_many', 'lgn_err_network', 'lgn_err_generic']
  for (const language of ['en', 'es', 'ca']) for (const key of keys) assert.ok(pageText[language][key], `${language}.${key}`)
})
