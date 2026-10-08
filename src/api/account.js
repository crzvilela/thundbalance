import { API_URL } from '../config'
import { authFetch } from './authFetch'

// Fired when the client has changed their temporary password, so every notice
// on screen can hide itself.
export const PASSWORD_CHANGED_EVENT = 'tb-password-changed'

// Tells the server the temporary password was replaced (the notice then stops
// appearing on later visits). One retry; the notice hides either way, because
// the password really was changed.
export async function markPasswordChanged() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await authFetch(`${API_URL}/me/password-changed`, { method: 'POST' })
      if (response.ok) break
    } catch {
      // try once more
    }
  }
  window.dispatchEvent(new Event(PASSWORD_CHANGED_EVENT))
}
