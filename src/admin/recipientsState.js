import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL } from '../config'
import { adminFetch } from '../api/admin'

export const MAX_EXTRA_RECIPIENTS = 10
const FALLBACK_TEAM = ['info@thundbalance.com', 'pt@thundbalance.com']
const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/

// State for the "Enviar confirmación a" field: whether the client gets the
// email and the list of extra addresses (pre-filled with the team's, which the
// server can override with TEAM_EMAILS).
export function useEmailRecipients() {
  const [state, setState] = useState({ toClient: true, extra: FALLBACK_TEAM })
  const defaults = useRef(FALLBACK_TEAM)

  useEffect(() => {
    let active = true
    adminFetch(`${API_URL}/admin/email-defaults`)
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        // Only replace the pre-filled list if nobody has edited it meanwhile.
        if (active && data?.team_emails?.length) {
          defaults.current = data.team_emails
          setState(current => (current.extra === FALLBACK_TEAM ? { ...current, extra: data.team_emails } : current))
        }
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

  // Back to the defaults (client on, team addresses), e.g. when a modal opens again.
  const reset = useCallback(() => setState({ toClient: true, extra: defaults.current }), [])

  return [state, setState, reset]
}

// Body to merge into the request.
export const recipientsPayload = (state) => ({ email_client: state.toClient, email_extra: state.extra })

// Shows the result of the send: confirmation with recipients, or a clear warning.
export function reportEmailResult(toast, t, email) {
  if (!email) return
  const sent = email.sent_to || []
  const failed = email.failed || []
  if (failed.length || (!sent.length && email.problem && email.problem !== 'no_recipients')) {
    toast.push(`${t('em_failed')} ${failed.join(', ')}`.trim(), 'warning')
  } else if (sent.length) {
    toast.push(`${t('em_sent')} ${sent.join(', ')}`)
  }
}

export const EMAIL_PATTERN = EMAIL
