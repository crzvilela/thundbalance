import { useEffect, useSyncExternalStore } from 'react'
import { loadUnreadCount } from '../api/inbox'

// The number of unread messages, shared by everything that shows it (the menu, the dropdown, the Messages page).
// A page that reads or deletes a message updates it at once (setUnread / adjustUnread) instead of waiting for the
// next look at the server.
const POLL_MS = 60000
const MIN_GAP_MS = 2000          // two looks closer than this are one

let count = 0
let inflight = null
let lastLook = 0
const listeners = new Set()

const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
const emit = () => listeners.forEach(listener => listener())

export function setUnread(value) {
  const next = Math.max(0, Number(value) || 0)
  if (next === count) return
  count = next
  emit()
}

export const adjustUnread = (delta) => setUnread(count + delta)

// Asks the server (the light endpoint). One request at a time; `force` skips the short pause between looks.
export function refreshUnread({ force = false } = {}) {
  if (inflight) return inflight
  if (!force && Date.now() - lastLook < MIN_GAP_MS) return Promise.resolve()
  inflight = loadUnreadCount()
    .then(data => setUnread(data.unread))
    .catch(() => {})                  // a failed look keeps the number that was shown
    .finally(() => { inflight = null; lastLook = Date.now() })
  return inflight
}

export const useUnreadCount = () => useSyncExternalStore(subscribe, () => count, () => 0)

// The menu's look at the server: when it appears, on every change of page, and every minute while the browser tab is
// visible (it stops when the tab is hidden and looks again as soon as the tab comes back). No real time.
export function useUnreadPolling(enabled, page) {
  useEffect(() => {
    if (enabled) refreshUnread()
    else setUnread(0)
  }, [enabled, page])

  useEffect(() => {
    if (!enabled) return undefined
    let timer = null
    const stop = () => { window.clearInterval(timer); timer = null }
    const start = () => {
      stop()
      if (document.visibilityState === 'visible') timer = window.setInterval(() => refreshUnread({ force: true }), POLL_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { refreshUnread(); start() } else stop()
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [enabled])
}
