// The company data and the texts the admin edited (GET /legal, public). One request per page load, shared by every component.
// If it fails the site shows the model texts and no company data (the lines that need data stay hidden): never an error screen.
import { useEffect, useState } from 'react'
import { API_URL } from '../config'

let cache = null
let pending = null
const listeners = new Set()

export function loadLegal(force = false) {
  if (cache && !force) return Promise.resolve(cache)
  if (!pending || force) {
    pending = fetch(`${API_URL}/legal`)
      .then(response => (response.ok ? response.json() : Promise.reject(new Error('legal'))))
      .then(data => { cache = { settings: data.settings || {}, documents: data.documents || {} }; listeners.forEach(fn => fn(cache)); return cache })
      .catch(() => ({ settings: {}, documents: {} }))
      .finally(() => { pending = null })
  }
  return pending
}

export function useLegal() {
  const [data, setData] = useState(cache)
  useEffect(() => {
    let active = true
    const update = (value) => { if (active) setData(value) }
    listeners.add(update)
    loadLegal().then(update)
    return () => { active = false; listeners.delete(update) }
  }, [])
  return { settings: data?.settings || {}, documents: data?.documents || {}, loaded: Boolean(data) }
}
