// The visitor's choice about external content (Google reviews and maps, YouTube / Vimeo / Instagram videos).
// 'accepted' | 'rejected' | null (not chosen yet). Saved in this browser only.
import { useSyncExternalStore } from 'react'

const KEY = 'tb_consent'
const EVENT = 'tb-consent-change'

export function readConsent() {
  try {
    const value = window.localStorage.getItem(KEY)
    return value === 'accepted' || value === 'rejected' ? value : null
  } catch {
    return null
  }
}

export function saveConsent(value) {
  try {
    if (value) window.localStorage.setItem(KEY, value)
    else window.localStorage.removeItem(KEY)
  } catch {
    // storage unavailable: the choice only lasts until the page is reloaded
  }
  window.dispatchEvent(new Event(EVENT))
}

const subscribe = (callback) => {
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

export const useConsent = () => useSyncExternalStore(subscribe, readConsent, () => null)
