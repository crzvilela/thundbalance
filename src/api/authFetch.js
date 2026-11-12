import { auth } from '../firebase/auth'
import { reportIfNotVerified } from '../auth/emailVerification'

// fetch() for the client area: sends the signed-in user's Firebase ID token so
// the server knows whose data is being asked for.
export async function authFetch(url, options = {}) {
  const user = auth.currentUser
  if (!user) throw new Error('Please sign in again.')

  const token = await user.getIdToken()
  const headers = new Headers(options.headers || {})
  headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(url, { ...options, headers })
  // "email_not_verified": the page shows the verification screen (nothing happens for any other answer)
  reportIfNotVerified(response)
  return response
}
