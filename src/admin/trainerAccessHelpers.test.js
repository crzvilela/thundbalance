// node --test src/admin/trainerAccessHelpers.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { REASON_KEY, grantedDate, reasonKey, trainerPanelPath } from './trainerAccessHelpers.js'

test('every reason the server can give has its own text, an unknown one a generic text', () => {
  for (const reason of ['no_account', 'email_not_verified', 'is_admin', 'already_assigned_to_other_trainer', 'already_granted', 'trainer_has_access', 'is_client_with_activity']) {
    assert.ok(REASON_KEY[reason], reason)
  }
  assert.equal(reasonKey('something_new'), 'ta_r_generic')
})

test('the panel path and the date of the grant', () => {
  assert.equal(trainerPanelPath(7), '/admin/trainers/7/panel')
  assert.equal(grantedDate(null, 'es-ES'), '—')
  assert.equal(grantedDate('nonsense', 'es-ES'), '—')
  assert.match(grantedDate('2026-10-21T09:30:00', 'es-ES'), /2026/)
})
