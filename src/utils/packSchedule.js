// The weekly schedule of a pack: ONE ENTRY PER TRAINING DAY, each with its own hour and its own trainer.
//   [{ weekday: 'Monday', time: '18:00', trainer_id: 3 }, { weekday: 'Wednesday', time: '09:00', trainer_id: 1 }]
// Pure helpers shared by the site (the client's request) and the admin (new pack, new client, approving a request); the
// component is components/forms/PackSchedulePicker.jsx and the free hours come from GET /pack-availability.
// An availability answer is { weekdays: { Monday: [{ time: '07:00', trainers: [{ id, name }] }, ...], ... } }.

// The only days that exist for a pack: Monday to Friday (the server refuses any other).
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

const order = (entries) => [...entries].sort((a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday))

export const hoursOf = (availability, weekday) => availability?.weekdays?.[weekday] || []

// The trainers free on a weekday at an hour ([] when the hour is not offered).
export const trainersAt = (availability, weekday, time) => hoursOf(availability, weekday).find(item => item.time === time)?.trainers || []

export function trainerNames(availability) {
  const names = new Map()
  for (const day of WEEKDAYS) {
    for (const hour of availability?.weekdays?.[day] || []) {
      for (const trainer of hour.trainers) names.set(trainer.id, trainer.name)
    }
  }
  return names
}

// Keeps only as many days as the pack has sessions per week (the first ones in week order).
export const trimTo = (entries, perWeek) => (entries.length > perWeek ? order(entries).slice(0, Number(perWeek)) : entries)

// Adds the day (empty hour and trainer) or removes it; a day is added only while there are fewer than `perWeek`.
export function toggleDay(entries, weekday, perWeek) {
  if (entries.some(entry => entry.weekday === weekday)) return entries.filter(entry => entry.weekday !== weekday)
  if (entries.length >= Number(perWeek)) return entries
  return order([...entries, { weekday, time: '', trainer_id: '' }])
}

const hasTrainer = (entry) => entry.trainer_id !== '' && entry.trainer_id != null

// The trainer a day gets when its hour changes: the one it already had if still free, else the same trainer as the other days
// (the default: one trainer for the whole pack) if free then, else the first free one (or none when the trainer is optional).
export function defaultTrainer(entries, weekday, time, availability, { optional = false } = {}) {
  const free = trainersAt(availability, weekday, time)
  const own = entries.find(entry => entry.weekday === weekday)
  if (own && hasTrainer(own) && free.some(item => item.id === Number(own.trainer_id))) return Number(own.trainer_id)
  const shared = entries.find(entry => entry.weekday !== weekday && hasTrainer(entry) && free.some(item => item.id === Number(entry.trainer_id)))
  if (shared) return Number(shared.trainer_id)
  return optional || !free.length ? '' : free[0].id
}

export function setTime(entries, weekday, time, availability, options) {
  return entries.map(entry => (entry.weekday === weekday
    ? { ...entry, time, trainer_id: time ? defaultTrainer(entries, weekday, time, availability, options) : '' }
    : entry))
}

export const setTrainer = (entries, weekday, trainerId) =>
  entries.map(entry => (entry.weekday === weekday ? { ...entry, trainer_id: trainerId === '' ? '' : Number(trainerId) } : entry))

// Entries whose hour or trainer is no longer free (the free hours changed while the form was open): their weekdays.
export function staleDays(entries, availability) {
  if (!availability) return []
  return entries.filter(entry => entry.time && (
    !hoursOf(availability, entry.weekday).some(item => item.time === entry.time) ||
    (hasTrainer(entry) && !trainersAt(availability, entry.weekday, entry.time).some(item => item.id === Number(entry.trainer_id)))
  )).map(entry => entry.weekday)
}

export const isComplete = (entries, perWeek, { trainerRequired = true } = {}) =>
  entries.length === Number(perWeek) && entries.every(entry => entry.time && (!trainerRequired || hasTrainer(entry)))

// What the server receives: one object per day, the trainer as a number (or null when left open).
export const toBody = (entries) => order(entries).map(entry => ({
  weekday: entry.weekday, time: entry.time, trainer_id: hasTrainer(entry) ? Number(entry.trainer_id) : null
}))

// A stored schedule (or, for an OLD row, its single hour) as form entries. `legacy` is true for the old single-hour rows: they are
// only read (the form is prefilled and labelled "old"); saving always sends one hour per day.
export function fromStored({ schedule, days, time, trainerId } = {}) {
  if (Array.isArray(schedule) && schedule.length) {
    return { legacy: false, entries: order(schedule.map(entry => ({ weekday: entry.weekday, time: String(entry.time).slice(0, 5), trainer_id: entry.trainer_id ?? '' }))) }
  }
  const list = String(days || '').split(',').map(day => day.trim()).filter(day => WEEKDAYS.includes(day))      // a day of an old row that is not offered any more is not carried over
  const stamp = time ? String(time).slice(0, 5) : ''
  return { legacy: list.length > 0, entries: order(list.map(weekday => ({ weekday, time: stamp, trainer_id: trainerId ?? '' }))) }
}

const pad = (value) => String(value).padStart(2, '0')
const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

// The first `total` sessions from a start date, in date order: [{ number: '1/12', date: 'YYYY-MM-DD', time, trainer_id }].
// The server works the same list out (pack_schedule.slots) and checks it again when saving.
export function plannedSessions(start, entries, total) {
  if (!start || !entries.length || !total) return []
  const byDay = new Map(entries.map(entry => [WEEKDAYS.indexOf(entry.weekday), entry]))
  const [year, month, day] = start.split('-').map(Number)
  const current = new Date(year, month - 1, day)
  const result = []
  while (result.length < total) {
    const entry = byDay.get((current.getDay() + 6) % 7)
    if (entry) result.push({ number: `${result.length + 1}/${total}`, date: keyOf(current), time: entry.time, trainer_id: entry.trainer_id })
    current.setDate(current.getDate() + 1)
  }
  return result
}
