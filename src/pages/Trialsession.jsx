import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { API_URL } from '../config'

const GOALS = [
  'Body recomposition', 'Lose weight', 'Build muscle', 'Increase strength', 'Rehabilitation/injury recovery',
  'Conditioning', 'Endurance', 'Tone/define', 'Improve mobility & flexibility', 'Increase energy'
]
const LEVELS = ['Beginner', 'Intermediate', 'Advanced']
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

function ageFrom(birthDate, today = new Date()) {
  if (!birthDate) return null
  let age = today.getFullYear() - birthDate.getFullYear()
  if (today.getMonth() < birthDate.getMonth() || (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())) age -= 1
  return age
}

const EMPTY = { fullName: '', email: '', phone: '', birthDate: null, goals: [], experience: '', date: null, time: '' }

const control = 'w-full rounded-xl border bg-black/40 px-4 py-3.5 text-white outline-none transition focus:ring-2 focus:ring-emerald-400/20'

function validate(form) {
  const errors = {}
  if (form.fullName.trim().length < 2) errors.fullName = 'Please enter your full name.'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) errors.email = 'Please enter a valid email address.'
  if (form.phone.replace(/\D/g, '').length < 6) errors.phone = 'Please enter a valid phone number.'
  const age = ageFrom(form.birthDate)
  if (form.birthDate && (age < 10 || age > 100)) errors.birthDate = 'Please enter a valid date of birth.'
  if (form.goals.length === 0) errors.goals = 'Please select at least one goal.'
  if (!form.experience) errors.experience = 'Please select your experience.'
  if (!form.date) errors.date = 'Please choose a date.'
  else if (!form.time) errors.time = 'There is no free time on that day. Please choose another date.'
  return errors
}

function Field({ label, error, children, optional }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">
        {label}{optional && <span className="ml-1 normal-case tracking-normal text-gray-600">(optional)</span>}
      </span>
      {children}
      {error && <span role="alert" className="mt-1.5 block text-sm text-red-300">{error}</span>}
    </label>
  )
}

function TrialSession() {
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')
  const [done, setDone] = useState(false)
  const [schedule, setSchedule] = useState(null) // times offered per weekday
  const [times, setTimes] = useState([]) // free start times on the chosen date
  const [loadingTimes, setLoadingTimes] = useState(false)

  useEffect(() => {
    fetch(`${API_URL}/schedule`)
      .then(response => (response.ok ? response.json() : null))
      .then(data => setSchedule(data))
      .catch(() => setSchedule(null))
  }, [])

  // Only days on which at least one trainer works can be picked.
  const isBookableDay = (date) => !schedule || (schedule[WEEKDAYS[(date.getDay() + 6) % 7]] || []).length > 0

  // The times depend on the date: they are the hours when a trainer is free.
  const chooseDate = async (selected) => {
    setForm(current => ({ ...current, date: selected, time: '' }))
    setErrors(current => ({ ...current, date: undefined, time: undefined }))
    setTimes([])
    if (!selected) return
    setLoadingTimes(true)
    try {
      const response = await fetch(`${API_URL}/schedule/${dayKey(selected)}`)
      const list = response.ok ? await response.json() : []
      setTimes(list)
      setForm(current => ({ ...current, time: list.includes('09:00') ? '09:00' : (list[0] || '') }))
    } catch {
      setTimes([])
    } finally {
      setLoadingTimes(false)
    }
  }

  const set = (key) => (event) => {
    setForm({ ...form, [key]: event.target.value })
    if (errors[key]) setErrors({ ...errors, [key]: undefined })
  }
  const border = (key) => (errors[key] ? 'border-red-400/60' : 'border-white/15 focus:border-emerald-400/70')

  const handleSubmit = async (event) => {
    event.preventDefault()
    const found = validate(form)
    setErrors(found)
    setServerError('')
    if (Object.keys(found).length) return

    const { date } = form
    const sessionDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

    setSubmitting(true)
    try {
      const response = await fetch(`${API_URL}/trial-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: form.fullName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          birth_date: form.birthDate ? dayKey(form.birthDate) : null,
          goals: form.goals,
          experience: form.experience,
          session_date: sessionDate,
          session_time: form.time
        })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(typeof data.detail === 'string' ? data.detail : 'We could not send your request. Please try again.')
      }
      setDone(true)
      setForm(EMPTY)
    } catch (error) {
      setServerError(error instanceof TypeError ? 'We could not reach the server. Check your connection and try again.' : error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />

      <main className="mx-auto max-w-3xl px-5 pb-24 pt-36">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">Free first session</p>
        <h1 style={{ fontFamily: 'Bebas Neue' }} className="mb-3 text-5xl md:text-6xl">Book a Trial Session</h1>
        <p className="mb-10 max-w-xl text-gray-400">
          Tell us a bit about you and when you would like to come. We review every request and confirm your session by phone or email.
        </p>

        {done ? (
          <div role="status" className="rounded-3xl border border-emerald-400/25 bg-emerald-400/5 p-10 text-center">
            <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/15 text-3xl text-emerald-300">✓</span>
            <h2 style={{ fontFamily: 'Bebas Neue' }} className="mb-3 text-4xl">Request received</h2>
            <p className="mx-auto max-w-md text-gray-300">
              Thank you! Our team will review your request and contact you to confirm your trial session.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/" className="rounded-xl bg-white px-6 py-3 text-sm font-semibold uppercase tracking-wider text-black transition hover:bg-gray-200">Back to home</Link>
              <button type="button" onClick={() => setDone(false)} className="rounded-xl border border-white/20 px-6 py-3 text-sm uppercase tracking-wider transition hover:bg-white/10">Send another request</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="rounded-3xl border border-white/10 bg-white/[0.025] p-6 md:p-10">
            <div className="grid gap-6 md:grid-cols-2">
              <Field label="Full name" error={errors.fullName}>
                <input type="text" autoComplete="name" value={form.fullName} onChange={set('fullName')} className={`${control} ${border('fullName')}`} />
              </Field>
              <Field label="Email" error={errors.email}>
                <input type="email" autoComplete="email" value={form.email} onChange={set('email')} className={`${control} ${border('email')}`} />
              </Field>
              <Field label="Phone number" error={errors.phone}>
                <input type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} className={`${control} ${border('phone')}`} />
              </Field>
              <Field label="Date of birth" error={errors.birthDate} optional>
                <DatePicker
                  selected={form.birthDate}
                  onChange={date => setForm(current => ({ ...current, birthDate: date }))}
                  maxDate={new Date()}
                  showYearDropdown
                  showMonthDropdown
                  dropdownMode="select"
                  yearDropdownItemNumber={90}
                  scrollableYearDropdown
                  dateFormat="dd/MM/yyyy"
                  placeholderText="dd/mm/yyyy"
                  wrapperClassName="w-full"
                  className={`${control} ${border('birthDate')}`}
                />
                {form.birthDate && <span className="mt-1.5 block text-sm text-gray-400">Age: {ageFrom(form.birthDate)}</span>}
              </Field>
              <Field label="Training experience" error={errors.experience}>
                <select value={form.experience} onChange={set('experience')} className={`${control} ${border('experience')}`}>
                  <option value="">Select experience</option>
                  {LEVELS.map(level => <option key={level}>{level}</option>)}
                </select>
              </Field>
              <fieldset className="md:col-span-2">
                <legend className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">
                  Training goal<span className="ml-1 normal-case tracking-normal text-gray-600">(select one or more)</span>
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {GOALS.map(goal => {
                    const checked = form.goals.includes(goal)
                    return (
                      <label key={goal} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition ${checked ? 'border-emerald-400/60 bg-emerald-400/10 text-white' : 'border-white/10 bg-black/40 text-gray-300 hover:border-white/25'}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setForm(current => ({
                            ...current,
                            goals: current.goals.includes(goal) ? current.goals.filter(item => item !== goal) : [...current.goals, goal]
                          }))}
                          className="h-4 w-4 accent-emerald-400"
                        />
                        {goal}
                      </label>
                    )
                  })}
                </div>
                {errors.goals && <span role="alert" className="mt-1.5 block text-sm text-red-300">{errors.goals}</span>}
              </fieldset>
              <Field label="Preferred date" error={errors.date}>
                <DatePicker
                  selected={form.date}
                  onChange={chooseDate}
                  minDate={new Date()}
                  filterDate={isBookableDay}
                  dateFormat="dd/MM/yyyy"
                  placeholderText="dd/mm/yyyy"
                  wrapperClassName="w-full"
                  className={`${control} ${border('date')}`}
                />
              </Field>
              <Field label="Preferred time" error={errors.time}>
                <select value={form.time} onChange={set('time')} disabled={!form.date || loadingTimes || times.length === 0}
                  className={`${control} ${border('time')}`}>
                  {!form.date && <option value="">Choose a date first</option>}
                  {form.date && loadingTimes && <option value="">Loading…</option>}
                  {form.date && !loadingTimes && times.length === 0 && <option value="">No free times</option>}
                  {times.map(time => <option key={time}>{time}</option>)}
                </select>
              </Field>
            </div>

            {serverError && (
              <p role="alert" className="mt-6 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{serverError}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-8 inline-flex w-full items-center justify-center gap-3 rounded-xl bg-white px-8 py-4 text-sm font-semibold uppercase tracking-[3px] text-black transition hover:bg-gray-200 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 md:w-auto"
            >
              {submitting && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />}
              {submitting ? 'Sending…' : 'Request trial session'}
            </button>
          </form>
        )}
      </main>
    </div>
  )
}

export default TrialSession
