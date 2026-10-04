import { useCallback, useEffect, useState } from 'react'
import { API_URL } from '../config'
import { adminFetch } from '../api/admin'

// GET helper for admin endpoints: returns { data, loading, error, reload }.
// A failed request is reported as an error instead of silently leaving the
// screen empty.
export function useAdminResource(path) {
  const [state, setState] = useState({ data: null, loading: true, error: '' })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false

    adminFetch(`${API_URL}${path}`)
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then(data => { if (!cancelled) setState({ data, loading: false, error: '' }) })
      .catch(error => {
        if (!cancelled) setState(previous => ({ ...previous, loading: false, error: error.message || 'Error' }))
      })

    return () => { cancelled = true }
  }, [path, version])

  const reload = useCallback(() => {
    setState(previous => ({ ...previous, loading: true, error: '' }))
    setVersion(value => value + 1)
  }, [])
  return { ...state, reload }
}
