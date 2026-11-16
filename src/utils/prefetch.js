// Starts downloading the file of a page the visitor is about to open (hover, focus or touch on its link), so that the click finds it ready.
// Nothing is fetched when the visitor asked to save data (Data Saver / navigator.connection.saveData) or the connection is 2G.
const routes = {
  login: () => import('../pages/Login'),
  register: () => import('../pages/Register'),
  trial: () => import('../pages/Trialsession'),
}

export function canPrefetch() {
  const connection = typeof navigator !== 'undefined' ? navigator.connection : null
  if (!connection) return true
  return !(connection.saveData || /(^|-)2g$/.test(connection.effectiveType || ''))
}

export function prefetchRoute(name) {
  if (!canPrefetch() || !routes[name]) return
  routes[name]().catch(() => { /* just a head start: the real click tries again */ })
}

// a link that prefetches its page when the pointer or the keyboard reaches it
export const prefetchHandlers = (name) => ({
  onMouseEnter: () => prefetchRoute(name),
  onFocus: () => prefetchRoute(name),
  onTouchStart: () => prefetchRoute(name),
})
