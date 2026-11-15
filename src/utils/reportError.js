// Tells the server (POST /client-errors/report) that the site failed on somebody's screen, so the studio can see it in Admin > Estado del
// sistema. It sends the MINIMUM: the kind of error, a short cleaned message, the PATTERN of the page (never the address with ids or tokens)
// and the release of the site. Never a trace of the code, a full address, a user or any data. Whatever goes wrong here is swallowed: reporting can never
// cause an error or slow the page down.
import { API_URL } from '../config'
import { buildReport, shouldIgnore } from './reportErrorCore'

export function reportError(error, pathname = typeof window !== 'undefined' ? window.location.pathname : '/') {
  try {
    if (shouldIgnore(error)) return
    const body = JSON.stringify(buildReport(error, pathname, import.meta.env.VITE_RELEASE))
    const url = `${API_URL}/client-errors/report`
    // text/plain keeps it a "simple" request (no preflight); the server reads the JSON whatever the content type is
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return
    fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, keepalive: true }).catch(() => {})
  } catch {
    // never a problem for the page
  }
}
