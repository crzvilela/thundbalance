import { useState } from 'react'
import { dateKey, parseDateKey } from './requests'

export const PACK_TIMES = Array.from({ length: 14 }, (_, index) => `${String(index + 7).padStart(2, '0')}:00`)

export function addDays(key, amount) {
  const date = parseDateKey(key)
  date.setDate(date.getDate() + amount)
  return dateKey(date)
}

// A renewal starts after the current pack ends; a first pack, today.
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
