import { useEffect, useState } from 'react'
import { adminRequest } from './api'
import { dateKey, parseDateKey } from './requests'
import { sessionTypeBody } from '../utils/pricing'
import { secondPersonProblems } from '../utils/usePricing'
import { fromStored, isComplete, toBody } from '../utils/packSchedule'

export function addDays(key, amount) {
  const date = parseDateKey(key)
  date.setDate(date.getDate() + amount)
  return dateKey(date)
}

// Only a SUGGESTION: the day after the newest pack ends, or today. Any day can be chosen.
export function packMinStart(pack) {
  const today = dateKey(new Date())
  return pack?.end_date && pack.end_date >= today ? addDays(pack.end_date, 1) : today
}

export function packDefaults(pack) {
  return {
    plan: pack?.catalog_pack_id ? String(pack.catalog_pack_id) : '',      // a pack of the catalogue (chosen again for every pack)
    perWeek: String(pack?.sessions_per_week || 1),
    // The schedule: one entry per training day, each with ITS hour and ITS trainer. A new pack starts from the previous one's
    // days and trainers; the hours are chosen again (only free hours), so an old single-hour pack never carries its hour over.
    entries: pack ? fromStored({ schedule: pack.schedule, days: pack.preferred_days, trainerId: pack.trainer_id }).entries
      .map(entry => (pack.schedule?.length ? entry : { ...entry, time: '' })) : [],
    legacy: !!pack && !(pack.schedule?.length) && !!pack.preferred_days,
    start: packMinStart(pack),
    // the type is chosen for every pack (a new pack does not inherit it): Individual unless Dual is picked
    type: 'individual',
    secondName: '',
    secondEmail: ''
  }
}

// State of the pack form (shared by "Nuevo pack" and "Añadir cliente").
export function usePackForm(pack) {
  const [form, setForm] = useState(() => packDefaults(pack))
  const set = (patch) => setForm(current => ({ ...current, ...patch }))
  return [form, set]
}

export const packIsComplete = (form) => !!form.plan && !!form.start && isComplete(form.entries, form.perWeek) &&
  Object.keys(secondPersonProblems({ type: form.type, name: form.secondName, email: form.secondEmail })).length === 0

// Body fields the server expects for a pack.
export const packPayload = (form) => ({
  pack_id: Number(form.plan),
  sessions_per_week: Number(form.perWeek),
  schedule: toBody(form.entries),           // one entry per day: weekday, hour and trainer (no single hour for the pack)
  start_date: form.start,
  // only the kind of session: the server works the price out itself
  ...sessionTypeBody({ type: form.type, name: form.secondName, email: form.secondEmail })
})

// What the pack would create and what would collide, asked to the server
// while the form is filled in (nothing is written). `clientId` can be null
// (a client that does not exist yet has no sessions to collide with).
export function usePackPreview(clientId, form, enabled = true) {
  const key = enabled && packIsComplete(form) ? JSON.stringify([clientId ?? null, packPayload(form)]) : ''
  const [result, setResult] = useState({ key: '', data: null, error: '' })

  useEffect(() => {
    if (!key) return undefined
    let active = true
    const [client, payload] = JSON.parse(key)
    const timer = window.setTimeout(() => {
      adminRequest('POST', '/admin/packs/preview', { client_id: client, ...payload })
        .then(data => { if (active) setResult({ key, data, error: '' }) })
        .catch(error => { if (active) setResult({ key, data: null, error: error.message }) })
    }, 350)
    return () => { active = false; window.clearTimeout(timer) }
  }, [key])

  const ready = !!key && result.key === key
  return { loading: !!key && !ready, data: ready ? result.data : null, error: ready ? result.error : '' }
}

// True when the chosen start date is before today (the panel asks first).
export const startIsInThePast = (form) => !!form.start && form.start < dateKey(new Date())
