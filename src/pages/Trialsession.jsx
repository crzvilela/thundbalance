import { useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { API_URL } from '../config'

const GOALS = ['Weight Loss', 'Muscle Gain', 'Performance', 'General Fitness']
const LEVELS = ['Beginner', 'Intermediate', 'Advanced']
const TIMES = Array.from({ length: 15 }, (_, index) => `${String(index + 7).padStart(2, '0')}:00`)

const EMPTY = { fullName: '', email: '', phone: '', age: '', goal: '', experience: '', date: null, time: '09:00' }

const control = 'w-full rounded-xl border bg-black/40 px-4 py-3.5 text-white outline-none transition focus:ring-2 focus:ring-emerald-400/20'

function validate(form) {
  const errors = {}
  if (form.fullName.trim().length < 2) errors.fullName = 'Please enter your full name.'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) errors.email = 'Please enter a valid email address.'
  if (form.phone.replace(/\D/g, '').length < 6) errors.phone = 'Please enter a valid phone number.'
  if (form.age !== '' && (Number(form.age) < 10 || Number(form.age) > 100)) errors.age = 'Please enter a valid age.'
  if (!form.goal) errors.goal = 'Please select your goal.'
  if (!form.experience) errors.experience = 'Please select your experience.'
  if (!form.date) errors.date = 'Please choose a date.'
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
          age: form.age === '' ? null : Number(form.age),
          goal: form.goal,
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
              <Field label="Age" error={errors.age} optional>
                <input type="number" min="10" max="100" value={form.age} onChange={set('age')} className={`${control} ${border('age')}`} />
              </Field>
              <Field label="Training goal" error={errors.goal}>
                <select value={form.goal} onChange={set('goal')} className={`${control} ${border('goal')}`}>
                  <option value="">Select goal</option>
                  {GOALS.map(goal => <option key={goal}>{goal}</option>)}
                </select>
              </Field>
              <Field label="Training experience" error={errors.experience}>
                <select value={form.experience} onChange={set('experience')} className={`${control} ${border('experience')}`}>
                  <option value="">Select experience</option>
                  {LEVELS.map(level => <option key={level}>{level}</option>)}
                </select>
              </Field>
              <Field label="Preferred date" error={errors.date}>
                <DatePicker
                  selected={form.date}
                  onChange={(selected) => { setForm({ ...form, date: selected }); if (errors.date) setErrors({ ...errors, date: undefined }) }}
                  minDate={new Date()}
                  dateFormat="dd/MM/yyyy"
                  placeholderText="dd/mm/yyyy"
                  wrapperClassName="w-full"
                  className={`${control} ${border('date')}`}
                />
              </Field>
              <Field label="Preferred time">
                <select value={form.time} onChange={set('time')} className={`${control} border-white/15 focus:border-emerald-400/70`}>
                  {TIMES.map(time => <option key={time}>{time}</option>)}
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
