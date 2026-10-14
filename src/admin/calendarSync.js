// Calendar problems reported by the server after creating sessions
// ({ calendar: { failed, errors } }): the sessions exist, but some have no
// event in the Google Calendar. "Sincronizar con calendario" on the client's
// record creates them.
export function reportCalendarResult(toast, t, calendar) {
  if (!calendar || !calendar.failed) return
  toast.push(`${calendar.failed} ${t('cs_pack_warn')}`, 'warning')
}
