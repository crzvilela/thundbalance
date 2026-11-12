// "Verify your email to access your data": shown ONLY when the API answers 403 with the code 'email_not_verified' (somebody whose
// address is not verified tried to reach data that already exists under it). Nobody else sees anything new. No React, no Firebase
// here: the rules are tested on their own.

export const NOT_VERIFIED_EVENT = 'tb-email-not-verified'
export const RESEND_PAUSE_SECONDS = 60
const SENT_KEY = 'tb_verify_sent_at'

// The API's answer for an unverified address: 403 with detail.code 'email_not_verified'.
export const isNotVerifiedAnswer = (status, data) => status === 403 && data?.detail?.code === 'email_not_verified'

// Looks at an answer of the API and calls `notify` when it is that one. Never throws and never consumes the answer the page reads.
export async function reportIfNotVerified(response, notify = notifyNotVerified) {
  if (!response || response.status !== 403) return false
  try {
    const data = await response.clone().json()
    if (isNotVerifiedAnswer(403, data)) {
      notify()
      return true
    }
  } catch {
    // not JSON: it is some other 403
  }
  return false
}

export function notifyNotVerified() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOT_VERIFIED_EVENT))
}

// The screen is open or closed: it opens when the API says "not verified" and closes once the address is verified.
export function gateReducer(state, action) {
  if (action === 'not_verified') return { open: true }
  if (action === 'verified') return { open: false }
  return state
}

// Seconds left before the email can be sent again (0 = now). `lastSentAt` is a timestamp in ms.
export function secondsUntilResend(lastSentAt, now = Date.now(), pause = RESEND_PAUSE_SECONDS) {
  if (!lastSentAt) return 0
  return Math.max(0, Math.ceil(pause - (now - lastSentAt) / 1000))
}

// When the last email was sent, kept for this tab so a reload does not skip the pause.
export function readLastSent(uid, storage = safeStorage()) {
  try {
    const stored = JSON.parse(storage?.getItem(SENT_KEY) || 'null')
    return stored && stored.uid === uid ? Number(stored.at) || 0 : 0
  } catch {
    return 0
  }
}

export function markSent(uid, now = Date.now(), storage = safeStorage()) {
  try {
    storage?.setItem(SENT_KEY, JSON.stringify({ uid, at: now }))
  } catch {
    // storage unavailable: the pause only lasts while the screen stays open
  }
}

function safeStorage() {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}
