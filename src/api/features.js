import { useEffect, useState } from 'react'
import { API_URL } from '../config'

// What the site may show, decided by the server (GET /features). Today only one switch:
//   clientCalendar  <- CLIENT_CALENDAR_ENABLED: calendar buttons, subscription and .ics of the client area.
// Off until the server says otherwise, so a button never flashes and then disappears.
const OFF = { clientCalendar: false }
let cached = null
let pending = null

export function loadFeatures() {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = fetch(`${API_URL}/features`)
      .then(response => (response.ok ? response.json() : {}))
      .catch(() => ({}))
      .then(data => { cached = { clientCalendar: data.client_calendar === true }; return cached })
  }
  return pending
}

export function useFeatures() {
  const [features, setFeatures] = useState(cached || OFF)
  useEffect(() => {
    let active = true
    loadFeatures().then(value => { if (active) setFeatures(value) })
    return () => { active = false }
  }, [])
  return features
}
