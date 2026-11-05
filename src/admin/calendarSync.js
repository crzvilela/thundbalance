// Calendar problems reported by the server after creating sessions
// ({ calendar: { failed, errors } }): the sessions exist, but some have no
// event in the Google Calendar. "Sincronizar con calendario" on the client's
// record creates them.
export function reportCalendarResult(toast, t, calendar) {
  if (!calendar) return
  if (calendar.failed) toast.push(`${calendar.failed} ${t('cs_pack_warn')}`, 'warning')
  reportGuestsWarning(toast, t, calendar.guests_warning)
}

// Without the Workspace domain-wide delegation Google refuses guests: the events exist, only without the client invited.
export function reportGuestsWarning(toast, t, warning) {
  if (warning === 'delegation_missing') toast.push(t('gc_delegation_missing'), 'warning')
}
