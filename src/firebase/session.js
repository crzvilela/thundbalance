// The way the pages that EVERY visitor loads (menu, roles, language) talk to Firebase Authentication without carrying its code:
// the SDK (about 100 kB) is a separate file that is fetched after the first paint (or at once when the visitor is known to have
// signed in before). Pages that need a login (client area, admin, trainer) import firebase/auth directly: they are loaded on
// demand and bring the same file with them.
//
// What does NOT change: whoever has a session is recognised as soon as Firebase reads it. Until it has said who is (or is not) signed
// in, `onUserChange` has not called back, and the roles / private-route guards keep showing their loading state (RolesProvider).

const HINT = 'tb_auth_hint'                       // "this browser has signed in before": then Firebase is loaded without waiting
// pages of the public site: the SDK is not needed to draw them, so it waits for the first paint
const PUBLIC_PAGES = new Set(['/', '/privacy', '/cookies', '/legal-notice', '/terms', '/cancellations', '/training-tips'])

let loaded = null
let pending = null

export function loadAuthModule() {
  if (!pending) {
    pending = import('./authModule.js').then((module) => { loaded = module; return module }, (error) => { pending = null; throw error })
  }
  return pending
}

/** The signed-in user if the SDK is already here, else null (callers that need the answer ask `loadAuthModule()` first). */
export function currentUser() {
  return loaded ? loaded.auth.currentUser : null
}

function remember(user) {
  try {
    if (user) window.localStorage.setItem(HINT, '1')
    else window.localStorage.removeItem(HINT)
  } catch { /* storage unavailable: the SDK just loads after the first paint */ }
}

/** Has this browser had a signed-in session before? (then a page that may be the panel waits for the answer instead of showing a 404) */
export function hasAuthHint() {
  try { return Boolean(window.localStorage.getItem(HINT)) } catch { return false }
}

function shouldWait() {
  try {
    return PUBLIC_PAGES.has(window.location.pathname) && !window.localStorage.getItem(HINT)
  } catch { return false }
}

function afterFirstPaint(run) {
  if (!shouldWait()) { run(); return }
  let done = false
  const once = () => { if (!done) { done = true; run() } }
  const idle = () => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(once, { timeout: 2500 }) : setTimeout(once, 800))
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => setTimeout(idle, 0))
  else idle()
  setTimeout(once, 4000)             // a tab in the background does not paint (no animation frames): the session is still recognised
}

/** Like onAuthStateChanged(auth, callback), but it loads the SDK first. Returns the function that stops listening. */
export function onUserChange(callback) {
  let stopped = false
  let stop = () => {}
  afterFirstPaint(() => {
    loadAuthModule().then((module) => {
      if (stopped) return
      stop = module.onAuthStateChanged(module.auth, (user) => { remember(user); callback(user) })
    }).catch(() => { /* no network for the file: the next visit tries again */ })
  })
  return () => { stopped = true; stop() }
}

export async function signOutUser() {
  const module = await loadAuthModule()
  await module.signOut(module.auth)
}
