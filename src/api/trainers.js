import { API_URL } from '../config'

// The trainers of the site and who is free at a day and hour. Both are public (the trial form is public):
// the server answers with ids and names only. Nothing about trainers is written in the pages.

let cached = null

// [{ id, name }] of the active trainers (GET /trainers rows are [id, name, specialty]).
export function loadTrainers() {
  if (!cached) {
    cached = fetch(`${API_URL}/trainers`)
      .then(response => (response.ok ? response.json() : []))
      .then(rows => (Array.isArray(rows) ? rows.map(row => ({ id: row[0], name: row[1] })) : []))
      .catch(() => { cached = null; return [] })
  }
  return cached
}

// [{ id, name }] free on a date at a time.
// `excludeSessionId`: the session being moved (it does not block its own trainer).
export async function loadAvailableTrainers({ date, time, excludeSessionId }) {
  const query = new URLSearchParams({ time, date })
  if (excludeSessionId) query.set('exclude_session_id', String(excludeSessionId))
  const response = await fetch(`${API_URL}/available-trainers?${query}`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const list = await response.json()
  return Array.isArray(list) ? list : []
}
