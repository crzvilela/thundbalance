import { useCallback, useEffect, useState } from 'react'
import { API_URL } from '../config'

// The free hours of every weekday with the trainers free at each one (GET /pack-availability, public).
// With a start date and the pack's weeks, hours a trainer is already booked in that window are left out; without them only the
// working hours count (a client's request has no start date yet).
//   const availability = usePackAvailability({ startDate, weeks })  ->  { data, loading, error, reload }
export function usePackAvailability({ startDate = '', weeks = 0 } = {}) {
  const [state, setState] = useState({ key: '', data: null, error: false })
  const [version, setVersion] = useState(0)
  const query = startDate && weeks ? `?start_date=${encodeURIComponent(startDate)}&weeks=${Number(weeks)}` : ''
  const key = `${query}|${version}`

  useEffect(() => {
    let current = true
    fetch(`${API_URL}/pack-availability${query}`)
      .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() })
      .then(data => { if (current) setState({ key, data, error: false }) })
      .catch(() => { if (current) setState({ key, data: null, error: true }) })
    return () => { current = false }
  }, [key, query])

  const reload = useCallback(() => setVersion(value => value + 1), [])
  const ready = state.key === key
  // while a new window loads, the previous answer stays on screen (no flicker)
  return { data: state.data, loading: !ready, error: ready && state.error, reload }
}
