import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uploadProfilePhoto } from '../src/api/profilePhoto.js'

const options = { apiUrl: 'https://api.example.test', userId: 42, token: 'test-token', file: new File(['photo'], 'photo.png', { type: 'image/png' }) }

test('uploads a multipart photo with the authenticated token', async () => {
  const url = await uploadProfilePhoto({ ...options, fetchImpl: async (url, request) => {
    assert.equal(url, 'https://api.example.test/profile/42/photo')
    assert.equal(request.method, 'POST')
    assert.equal(request.headers.Authorization, 'Bearer test-token')
    assert.equal(request.body.get('file').name, 'photo.png')
    assert.equal(request.headers['Content-Type'], undefined)
    return Response.json({ url: '/uploads/photo.png' })
  } })
  assert.equal(url, '/uploads/photo.png')
})

test('explains when the deployed backend does not have the upload route', async () => {
  for (const status of [404, 405]) {
    await assert.rejects(uploadProfilePhoto({ ...options, fetchImpl: async () => new Response('Not Found', { status }) }), /publicar a atualização da API/)
  }
})

test('handles expired authentication and malformed server responses', async () => {
  await assert.rejects(uploadProfilePhoto({ ...options, fetchImpl: async () => new Response('', { status: 401 }) }), /sessão expirou/)
  await assert.rejects(uploadProfilePhoto({ ...options, fetchImpl: async () => new Response('<html>Bad Gateway</html>', { status: 502 }) }), /não conseguiu processar/)
  await assert.rejects(uploadProfilePhoto({ ...options, fetchImpl: async () => Response.json({ message: 'ok' }) }), /não confirmou/)
})

test('shows connection failures without claiming the photo was saved', async () => {
  await assert.rejects(uploadProfilePhoto({ ...options, fetchImpl: async () => { throw new TypeError('fetch failed') } }), /ligar ao servidor/)
})
