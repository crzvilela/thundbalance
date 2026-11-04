// Shows the result of an email the admin triggered: confirmation with the recipients, or a clear warning.
// (The recipients are chosen in RecipientsBox: the client always, plus the extra ones in blind copy.)
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
