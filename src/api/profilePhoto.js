export async function uploadProfilePhoto({ apiUrl, userId, token, file, fetchImpl = fetch }) {
  const body = new FormData()
  body.append('file', file)
  let response
  try {
    response = await fetchImpl(`${apiUrl}/profile/${userId}/photo`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body,
    })
  } catch {
    throw new Error('pf_up_connection')
  }
  if (response.status === 404 || response.status === 405) {
    throw new Error('pf_up_unavailable')
  }
  if (response.status === 401) throw new Error('pf_err_signin')
  if (response.status === 413) throw new Error('pf_err_image')
  let result
  try { result = await response.json() } catch {
    throw new Error('pf_up_server')
  }
  if (!response.ok) throw new Error(response.status === 400 ? 'pf_err_image' : 'pf_up_failed')       // the server's own sentence is in English: not shown
  if (typeof result.url !== 'string' || !result.url.startsWith('/uploads/')) {
    throw new Error('pf_up_unconfirmed')
  }
  return result.url
}
