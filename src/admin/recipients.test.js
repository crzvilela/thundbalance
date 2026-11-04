// node --test src/admin/
import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_EXTRA, addRecipients, extraBody, isEmail, recipientSummary } from './recipients.js'

test('addresses are lower-cased, de-duplicated and never the client\'s own', () => {
  const result = addRecipients(['pt@x.co'], 'PT@x.co, Otro@X.co; client@x.co', 'Client@x.co')
  assert.deepEqual(result, { list: ['pt@x.co', 'otro@x.co'], error: '', bad: '' })
})

test('a bad address leaves the list as it was and says which one', () => {
  const result = addRecipients(['a@x.co'], 'b@x.co nope', '')
  assert.deepEqual(result, { list: ['a@x.co'], error: 'invalid', bad: 'nope' })
  assert.equal(isEmail('a@b'), false)
  assert.equal(isEmail(' a@b.co '), true)
})

test('at most five extra recipients', () => {
  const five = Array.from({ length: MAX_EXTRA }, (_unused, index) => `p${index}@x.co`)
  assert.equal(addRecipients(five.slice(0, 4), 'p4@x.co', '').error, '')
  assert.deepEqual(addRecipients(five, 'sixth@x.co', ''), { list: five, error: 'max', bad: '' })
})

test('the body and the summary of the confirmation', () => {
  assert.deepEqual(extraBody(['a@x.co']), { extra_recipients: ['a@x.co'] })
  assert.deepEqual(recipientSummary('c@x.co', ['a@x.co']), { client: 'c@x.co', hidden: ['a@x.co'] })
})
