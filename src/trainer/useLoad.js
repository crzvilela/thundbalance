import { useEffect, useRef, useState } from 'react'

// Loads something when `key` changes (and again on reload()). While the answer for the CURRENT key is not
// there, `loading` is true and `data` is null: a change of period never shows the numbers of the old one.
export function useLoad(load, key) {
  const [state, setState] = useState({ key: null, data: null, error: null })
  const [version, setVersion] = useState(0)
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load })

  const fullKey = `${key}|${version}`
  useEffect(() => {
    if (key === null) return undefined
    let cancelled = false
    loadRef.current().then(
      data => { if (!cancelled) setState({ key: fullKey, data, error: null }) },
      error => { if (!cancelled) setState({ key: fullKey, data: null, error }) }
    )
    return () => { cancelled = true }
  }, [fullKey, key])

  const current = key !== null && state.key === fullKey
  return {
    loading: key !== null && !current,
    data: current ? state.data : null,
    error: current ? state.error : null,
    reload: () => setVersion(value => value + 1)
  }
}
