// How a pack's schedule is written in the admin: one line per training day (day, hour, trainer). A pack from before the schedule
// existed only has days and ONE hour: it is read as "Mon, Wed · 18:00" and marked as an old fixed schedule (never written again).
//   scheduleLines(pack, { dayLabel, t }) -> ['Mon · 18:00 · Carles', 'Wed · 09:00 · Marta']  |  ['Mon, Wed · 18:00 (Fixed schedule (old))']  |  []
export function scheduleLines(pack, { dayLabel, t }) {
  if (!pack) return []
  if (Array.isArray(pack.schedule) && pack.schedule.length) {
    return pack.schedule.map(entry => [dayLabel(entry.weekday), String(entry.time).slice(0, 5), entry.trainer].filter(Boolean).join(' · '))
  }
  if (!pack.preferred_days) return []
  const days = String(pack.preferred_days).split(',').map(day => dayLabel(day.trim())).join(', ')
  const time = pack.preferred_time ? ` · ${String(pack.preferred_time).slice(0, 5)}` : ''
  return [`${days}${time} (${t('ps_old_label')})`]
}
