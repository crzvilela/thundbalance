// TEST-ONLY replacement of "firebase/auth" for the accessibility audit (tests/a11y/vite.config.mjs): the pages that need a login can be
// opened without a Firebase account. Who is "signed in" comes from ?as=admin | client | none (kept in sessionStorage). The backend of
// the audit (tests/a11y/backend_server.py) accepts the matching test tokens. It is never part of the real build.
const USERS = {
  admin: { uid: 'uid-a11y-admin', email: 'david@admin.es', displayName: 'Admin Test', token: 'test-admin' },
  client: { uid: 'uid-a11y-client', email: 'a11y-client@example.test', displayName: 'Ana Auditoria', token: 'test-client' },
}
let listeners = []
let current = null

function pick() {
  try {
    const asked = new URLSearchParams(window.location.search).get('as')
    if (asked) sessionStorage.setItem('tb_a11y_as', asked)
    return sessionStorage.getItem('tb_a11y_as') || 'none'
  } catch { return 'none' }
}

function build(kind) {
  const data = USERS[kind]
  if (!data) return null
  return {
    uid: data.uid, email: data.email, displayName: data.displayName, photoURL: null, emailVerified: true,
    providerData: [{ providerId: 'password' }],
    getIdToken: async () => data.token, reload: async () => {},
  }
}

const auth = { get currentUser() { return current } }
current = build(pick())

export const getAuth = () => auth
export class GoogleAuthProvider {}
export const onAuthStateChanged = (_auth, callback) => {
  listeners.push(callback)
  setTimeout(() => callback(current), 0)
  return () => { listeners = listeners.filter(item => item !== callback) }
}
export const signOut = async () => { current = null; try { sessionStorage.setItem('tb_a11y_as', 'none') } catch { /* no storage */ } listeners.forEach(callback => callback(null)) }
export const signInWithEmailAndPassword = async () => ({ user: current })
export const signInWithPopup = async () => ({ user: current })
export const createUserWithEmailAndPassword = async () => ({ user: current })
export const sendEmailVerification = async () => {}
export const updateProfile = async () => {}
export const updatePassword = async () => {}
export const reauthenticateWithCredential = async () => {}
export const EmailAuthProvider = { credential: () => ({}) }
