import { API_URL } from '../config'
import { authFetch } from './authFetch'

// The signed-in client's private calendar link (created on first use):
// { https, webcal, google }. Regenerating invalidates the previous link.
export async function loadCalendarFeed() {
  const response = await authFetch(`${API_URL}/me/calendar-feed`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function regenerateCalendarFeed() {
  const response = await authFetch(`${API_URL}/me/calendar-feed/regenerate`, { method: 'POST' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}
