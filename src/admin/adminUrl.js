// Where the admin panel lives in the browser. The path is a secret that only the server knows (backend/admin_access.py, docs/ADMIN_ACCESS.md): it is NEVER
// written in the code. It reaches the page only when the signed-in administrator is confirmed (GET /me/roles) and AdminApp sets it here before drawing the panel.
// Every link, redirect and navigation of the panel is written with adminUrl('/clients'), never with a fixed address.
//
//   adminUrl()                      -> '/<secret>'
//   adminUrl('/clients?client=3')   -> '/<secret>/clients?client=3'
//   adminUrl('#deletion-requests')  -> '/<secret>#deletion-requests'
//
// Before the path is known (outside the panel, in a test that does not set one) the helper gives the address without a prefix.

export const ADMIN_SEGMENT = /^[a-z0-9]{14}$/        // what the server generates: 14 characters, a-z and 0-9

let base = ''

export function setAdminPath(path) {
  base = ADMIN_SEGMENT.test(String(path || '')) ? String(path) : ''
}

export const getAdminPath = () => base

export function adminUrl(path = '') {
  const rest = String(path || '')
  const tail = rest === '' || /^[/?#]/.test(rest) ? rest : `/${rest}`
  return `/${base}${tail}`.replace(/^\/\//, '/')
}

// Is this browser address inside the panel? (for the skip link and the page title: they never need the path itself)
export const isAdminLocation = (pathname) => base !== '' && (pathname === `/${base}` || String(pathname).startsWith(`/${base}/`))
