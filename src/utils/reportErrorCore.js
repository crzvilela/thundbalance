// The pure part of the error report (no network, no configuration): what is ignored, the pattern of the page and the short clean message.
const NOISE = /ChunkLoadError|AbortError|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|(chrome|moz|safari)-extension|ResizeObserver loop|Script error/i

// What is not worth a report (a new version being loaded, a cancelled request, browser extensions, third-party scripts).
export const shouldIgnore = (error) => NOISE.test(`${error?.name || ''} ${error?.message || String(error || '')}`)

// "/admin/clients/123" -> "/admin/clients/:id"; a token or a long identifier becomes ":id" as well (at most 80 characters).
export function routePattern(pathname) {
  const clean = String(pathname || '/').split(/[?#]/)[0]
  return clean.split('/').map(part => (/^\d+$/.test(part) || /^[0-9a-f-]{16,}$/i.test(part) || (part.length >= 16 && /\d/.test(part)) ? ':id' : part)).join('/').slice(0, 80) || '/'
}

// The name and the first line of the message, without addresses, e-mails or long numbers (the server cleans it again).
export function shortMessage(error) {
  const first = String(error?.message || error || '').split('\n')[0]
  return first.replace(/https?:\/\/\S+/g, '<url>').replace(/[\w.+'-]+@[\w-]+(\.[\w-]+)+/g, '<email>').replace(/\d{6,}/g, '<n>').slice(0, 200)
}

export function buildReport(error, pathname, release) {
  return {
    error_type: String(error?.name || 'Error').slice(0, 80),
    message: shortMessage(error),
    route: routePattern(pathname),
    release: String(release || 'dev').slice(0, 40),
  }
}

