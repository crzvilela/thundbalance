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

// Downloads a calendar file of the signed-in client (own sessions only: the server checks it).
async function downloadIcs(path, filename) {
  const response = await authFetch(`${API_URL}${path}`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = new Blob([await response.arrayBuffer()], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const downloadSessionIcs = (sessionId) => downloadIcs(`/me/sessions/${sessionId}/ics`, `thundbalance-sesion-${sessionId}.ics`)
export const downloadAllSessionsIcs = () => downloadIcs('/me/sessions.ics', 'thundbalance-mis-sesiones.ics')