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
