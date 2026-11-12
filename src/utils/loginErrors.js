// Login problems as a line of text next to the form (never a pop-up): Firebase error code -> text key (pageText.js).
// A closed or cancelled Google window is not a problem to report: it returns null.
const CODES = {
  'auth/invalid-credential': 'lgn_err_credentials',
  'auth/wrong-password': 'lgn_err_credentials',
  'auth/user-not-found': 'lgn_err_credentials',
  'auth/invalid-email': 'lgn_err_email',
  'auth/user-disabled': 'lgn_err_disabled',
  'auth/too-many-requests': 'lgn_err_many',
  'auth/network-request-failed': 'lgn_err_network',
}
const SILENT = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request'])

export function loginErrorKey(error) {
  const code = error?.code
  if (SILENT.has(code)) return null
  return CODES[code] || 'lgn_err_generic'
}
