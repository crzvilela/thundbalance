import { useEffect, useState } from 'react'
import { adminRequest } from './api'
import { dateKey, parseDateKey } from './requests'

export const PACK_TIMES = Array.from({ length: 14 }, (_, index) => `${String(index + 7).padStart(2, '0')}:00`)

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
    plan: pack?.plan_id ? String(pack.plan_id) : '',
    perWeek: String(pack?.sessions_per_week || 1),
    days: pack?.preferred_days ? pack.preferred_days.split(',').map(day => day.trim()).filter(Boolean) : [],
    time: pack?.preferred_time ? String(pack.preferred_time).slice(0, 5) : '',
    trainer: pack?.trainer_id ? String(pack.trainer_id) : '',
    start: packMinStart(pack)
  }
}

// State of the pack form (shared by "Renovar pack" and "Añadir cliente").
export function usePackForm(pack) {
  const [form, setForm] = useState(() => packDefaults(pack))
  const set = (patch) => setForm(current => ({ ...current, ...patch }))
  return [form, set]
}

export const packHasDaysAndTime = (form) => form.days.length > 0 && !!form.time
export const packIsComplete = (form) => !!form.plan && !!form.trainer && !!form.start && packHasDaysAndTime(form)

// Body fields the server expects for a pack.
export const packPayload = (form) => ({
  plan_id: Number(form.plan),
  sessions_per_week: Number(form.perWeek),
  preferred_days: form.days.join(','),
  preferred_time: form.time,
  trainer_id: Number(form.trainer),
  start_date: form.start
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
