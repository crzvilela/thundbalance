// Working-hours helpers for the admin screens. The server is the final judge
// (it refuses a schedule a trainer cannot take); these helpers only keep the
// pickers honest so the admin sees the problem before pressing Approve.
// Trainer shape (from /admin/trainer-availability):
// { id, name, hours: { Monday: { start: '07:00', end: '14:00' } | null, ... } }

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const minutes = (value) => {
  const [hour, minute] = String(value).split(':')
  return Number(hour) * 60 + Number(minute)
}

// A one-hour session starting at `time` must also end inside the window.
export function canStart(trainer, day, time) {
  const window = trainer.hours?.[day]
  if (!window || !time) return false
  const start = minutes(time)
  return minutes(window.start) <= start && start + 60 <= minutes(window.end)
}

// Weekday name ('Monday'...) of a 'YYYY-MM-DD' date.
export function weekdayOf(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return WEEKDAYS[(new Date(year, month - 1, day).getDay() + 6) % 7]
}

// null when the trainer fits every day at that time, otherwise the first day
// that does not work.
export function firstMismatch(trainer, days, time) {
  return days.find(day => !canStart(trainer, day, time)) || null
}

// Short "07:00–14:00" summary of a trainer's hours on the given days.
export function hoursSummary(trainer, days) {
  const spans = [...new Set(days.map(day => trainer.hours?.[day]).filter(Boolean).map(window => `${window.start}–${window.end}`))]
  return spans.join(', ')
}
