import { API_URL } from '../config'
import { authFetch } from './authFetch'

// Tells the server which language the signed-in client has on the site (PUT /me/language), so the e-mails they
// receive come in it. Quiet and non-blocking: a failure is ignored (the next sign-in or change sends it again),
// and an admin account simply gets an answer the page ignores.
export async function saveMyLanguage(lang) {
  try {
    const response = await authFetch(`${API_URL}/me/language`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang })
    })
    return response.ok
  } catch {
    return false
  }
}
