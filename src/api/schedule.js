import { API_URL } from '../config'

// Times offered on a date, plus the small trick that makes the form feel fast:
// the server sleeps when nobody uses it (free plan), so the page wakes it up
// as soon as it opens and fetches the times in the background, long before
// the visitor reaches the "Preferred time" field.

const DAY_TTL_MS = 60 * 1000          // same order as the server's own cache
const PING_EVERY_MS = 4 * 60 * 1000   // do not ping again within 4 minutes
const REQUEST_TIMEOUT_MS = 45 * 1000  // a cold start can take about this long

const days = new Map()      // 'YYYY-MM-DD' -> { at, list }
const inFlight = new Map()  // 'YYYY-MM-DD' -> Promise<string[]>
let week = null             // { at, data }
let lastPing = 0

// Silent request to the lightweight /health: wakes the service, answers at once.
export function pingServer() {
  const now = Date.now()
  if (now - lastPing < PING_EVERY_MS) return
  lastPing = now
  fetch(`${API_URL}/health`, { cache: 'no-store', keepalive: true }).catch(() => {})
}

async function request(path) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${API_URL}${path}`, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

// What the server offers on each weekday (used to disable closed days).
export async function loadWeek() {
  if (week && Date.now() - week.at < DAY_TTL_MS * 5) return week.data
  const data = await request('/schedule')
  week = { at: Date.now(), data }
  return data
}

// The times already known for a date, or null (never older than DAY_TTL_MS).
export function cachedDay(key) {
  const hit = days.get(key)
  return hit && Date.now() - hit.at < DAY_TTL_MS ? hit.list : null
}

// Free start times on a date. Concurrent calls for the same date share one request.
export function loadDay(key, { force = false } = {}) {
  if (!force) {
    const known = cachedDay(key)
    if (known) return Promise.resolve(known)
    if (inFlight.has(key)) return inFlight.get(key)
  }
  const promise = request(`/schedule/${key}`)
    .then(list => {
      days.set(key, { at: Date.now(), list })
      return list
    })
    .finally(() => { inFlight.delete(key) })
  inFlight.set(key, promise)
  return promise
}

// Warm-up: ping the service and fetch the times of the first bookable days.
export async function prefetchSchedule(isBookable, count = 3) {
  pingServer()
  try {
    await loadWeek()
  } catch {
    return
  }
  const day = new Date()
  day.setHours(0, 0, 0, 0)
  let loaded = 0
  for (let step = 0; step < 21 && loaded < count; step += 1) {
    if (isBookable(day)) {
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
      try {
        await loadDay(key)
      } catch {
        return
      }
      loaded += 1
    }
    day.setDate(day.getDate() + 1)
  }
}

// For the "Retry" button: forget what is known and try again.
export function forgetDay(key) {
  days.delete(key)
}
