import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { filenameFrom } from './downloadFile.js'
import { pageText } from '../i18n/pageText.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('the file name comes from the server and never from something odd', () => {
  assert.equal(filenameFrom('attachment; filename="thundbalance-datos-2026-11-14.json"', 'x.json'), 'thundbalance-datos-2026-11-14.json')
  assert.equal(filenameFrom('attachment; filename=data.json', 'x.json'), 'data.json')
  assert.equal(filenameFrom(null, 'fallback.json'), 'fallback.json')
  assert.equal(filenameFrom('attachment; filename="../../etc/passwd"', 'fallback.json'), 'fallback.json')
})

test('the client asks for their own data with the login only: no id is ever sent', () => {
  const api = read('../api/privacy.js')
  assert.match(api, /authFetch\(`\$\{API_URL\}\/me\/export\?format=\$\{kind\}`\)/)
  assert.match(api, /format = 'html'/)                                                           // the readable page is the main download
  assert.match(api, /\/me\/deletion-request/)
  assert.doesNotMatch(api, /user_id|client_id|userId|clientId|uid/)
  assert.match(read('../api/authFetch.js'), /reportIfNotVerified\(response\)/)                 // an unverified e-mail gets the verification screen
})

test('"Mis datos" is in the profile (not for the admin) and the admin has the export button and the list of requests', () => {
  assert.match(read('../pages/Profile.jsx'), /\{!isAdmin && <MyData \/>\}/)
  assert.match(read('../admin/pages/Clients.jsx'), /downloadClientExport\(clientId, format\)/)
  assert.match(read('../admin/pages/Overview.jsx'), /<DeletionRequests \/>/)
  const requests = read('../admin/DeletionRequests.jsx')
  assert.match(requests, /deletion-requests\/\$\{approving\.id\}\/approve/)                        // approving asks first (ConfirmDialog)
  assert.match(requests, /<ConfirmDialog\s+open=\{!!approving\}/)
  assert.match(requests, /<ConfirmDialog\s+open=\{!!rejecting\}/)
})

test('the client texts exist in Spanish, English and Catalan', () => {
  const keys = ['pv_title', 'pv_intro', 'pv_download', 'pv_working', 'pv_download_ok', 'pv_err_many', 'pv_err_generic', 'pv_status_title', 'pv_delete_btn',
    'pv_confirm_title', 'pv_delete_warn', 'pv_deadline', 'pv_cancel', 'pv_confirm_yes', 'pv_status_pending', 'pv_status_completed', 'pv_status_rejected', 'pv_requested_on']
  for (const language of ['en', 'es', 'ca']) for (const key of [...keys, 'pv_download_json']) assert.ok(pageText[language][key], `${language}.${key}`)
  assert.match(pageText.es.pv_download_json, /Descargar en formato JSON \(técnico\)/)
  assert.match(pageText.es.pv_download, /Descargar mis datos/)
  assert.match(pageText.es.pv_delete_btn, /Solicitar eliminación de mi cuenta/)
})

test('the admin texts exist in Spanish and English', () => {
  const texts = read('../admin/adminText.js')
  for (const key of ['pv_export', 'pv_export_done', 'dr_title', 'dr_intro', 'dr_approve', 'dr_reject', 'dr_approve_title', 'dr_approve_text', 'dr_reject_title',
    'dr_reject_text', 'pv_export_json', 'dr_reason', 'dr_reason_required', 'dr_approved', 'dr_rejected', 'dr_requested', 'dr_unknown']) {
    assert.equal((texts.match(new RegExp(`\\b${key}: '`, 'g')) || []).length, 2, key)
  }
})
