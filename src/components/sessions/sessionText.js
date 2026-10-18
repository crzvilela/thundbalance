import { formatDay, formatTime } from '../../utils/sessionDates'

// Texts built from a session (kept apart from the components so they can be shared).

// What Google Calendar shows in the description of the event.
export function eventDetails(t, session, locale) {
  return [
    `${t('ms_trainer')}: ${session.trainer || '—'}`,
    `${formatDay(session.date, locale)}, ${formatTime(session.time)}`
  ].join('\n')
}

export function sessionLabel(t, session) {
  return session.number ? t('ms_session_n', { n: session.number }) : t('ms_session')
}

// The line under the buttons: why the change button is on or off.
export function changeReason(t, change, hours) {
  switch (change?.state) {
    case 'pending': return t('ms_status_change_pending')
    case 'proposal': return t('ms_proposal_title')
    case 'used': return t('ms_already_requested')
    case 'too_late': return t('ms_too_late', { hours })
    default: return t('ms_request_rule')
  }
}
