// The visitor's choice about cookies and external content (see consentCore.js), saved in this browser only (every access in try/catch:
// private windows and blocked storage must not break the site). Nothing optional loads until the category is accepted.
import { useSyncExternalStore } from 'react'
import { CONSENT_KEY, allows, buildConsent, parseConsent } from './consentCore'

const CHANGE = 'tb-consent-change'
const OPEN = 'tb-consent-open'

let lastRaw
let lastValue = null
let memory = null            // when storage is unavailable the choice lives until the page is reloaded
let panelOpen = false

function readRaw() {
  try {
    return window.localStorage.getItem(CONSENT_KEY)
  } catch {
    return memory
  }
}

/** The current choice (the same object while nothing changed, so React does not re-render for nothing) or null. */
export function readConsent() {
  const raw = readRaw()
  if (raw !== lastRaw) {
    lastRaw = raw
    lastValue = parseConsent(raw)
  }
  return lastValue
}

export function saveConsent(choices) {
  const raw = JSON.stringify(buildConsent(choices))
  memory = raw
  try {
    window.localStorage.setItem(CONSENT_KEY, raw)
  } catch {
    // storage unavailable: the choice only lasts until the page is reloaded
  }
  panelOpen = false
  window.dispatchEvent(new Event(CHANGE))
}

/** The footer link "Cookie settings": opens the panel again so the choice can be changed or withdrawn. */
export function openPreferences() {
  panelOpen = true
  window.dispatchEvent(new Event(OPEN))
}

export function closePreferences() {
  panelOpen = false
  window.dispatchEvent(new Event(OPEN))
}

const subscribe = (callback) => {
  window.addEventListener(CHANGE, callback)
  window.addEventListener(OPEN, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(CHANGE, callback)
    window.removeEventListener(OPEN, callback)
    window.removeEventListener('storage', callback)
  }
}

export const useConsent = () => useSyncExternalStore(subscribe, readConsent, () => null)
export const usePreferencesOpen = () => useSyncExternalStore(subscribe, () => panelOpen, () => false)
/** Is this category accepted right now? false until the visitor accepts it. */
export const useAllowed = (category) => allows(useConsent(), category)
