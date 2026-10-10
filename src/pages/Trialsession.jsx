import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { API_URL } from '../config'
import { useI18n } from '../i18n/I18nContext'

// The English text is what the server stores; the visitor sees the translation.
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
  if (form.fullName.trim().length < 2) errors.fullName = 'ts_e_name'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) errors.email = 'ts_e_email'
  if (form.phone.replace(/\D/g, '').length < 6) errors.phone = 'ts_e_phone'
  const age = ageFrom(form.birthDate)
  if (form.birthDate && (age < 10 || age > 100)) errors.birthDate = 'ts_e_birth'
  if (form.goals.length === 0) errors.goals = 'ts_e_goals'
  if (!form.experience) errors.experience = 'ts_e_experience'
  if (!form.date) errors.date = 'ts_e_date'
  else if (!form.time) errors.time = 'ts_e_time'
  return errors
}

function Field({ label, error, children, optional }) {
  const { t } = useI18n()
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">
        {label}{optional && <span className="ml-1 normal-case tracking-normal text-gray-600">{t('ts_optional')}</span>}
      </span>
      {children}
      {error && <span role="alert" className="mt-1.5 block text-sm text-red-300">{t(error)}</span>}
    </label>
  )
}

function TrialSession() {
  const { t, language } = useI18n()
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
          tb_hp: form.hp || '',
          // the site's language now: the emails to the visitor are written in it
          lang: language,
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
        throw new Error(typeof data.detail === 'string' ? data.detail : 'ts_e_send')
      }
      setDone(true)
      setForm(EMPTY)
    } catch (error) {
      setServerError(error instanceof TypeError ? 'ts_e_network' : error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />

      <main className="mx-auto max-w-3xl px-5 pb-24 pt-36">
        {/* The intro header is hidden once the request was sent, so only the confirmation card remains. */}
        {!done && (
          <>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">{t('ts_eyebrow')}</p>
            <h1 style={{ fontFamily: 'Bebas Neue' }} className="mb-3 text-5xl md:text-6xl">{t('ts_title')}</h1>
            <p className="mb-10 max-w-xl text-gray-400">
              {t('ts_intro')}
            </p>
          </>
        )}

        {done ? (
          <div role="status" className="rounded-3xl border border-emerald-400/25 bg-emerald-400/5 p-10 text-center">
            <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/15 text-3xl text-emerald-300">✓</span>
            <h2 style={{ fontFamily: 'Bebas Neue' }} className="mb-3 text-4xl">{t('ts_received')}</h2>
            <p className="mx-auto max-w-md text-gray-300">
              {t('ts_received_text')}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/" className="rounded-xl bg-white px-6 py-3 text-sm font-semibold uppercase tracking-wider text-black transition hover:bg-gray-200">{t('ts_home')}</Link>
              <button type="button" onClick={() => setDone(false)} className="rounded-xl border border-white/20 px-6 py-3 text-sm uppercase tracking-wider transition hover:bg-white/10">{t('ts_another')}</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="rounded-3xl border border-white/10 bg-white/[0.025] p-6 md:p-10">
            <input type="text" name="tb_hp_field" id="tb_hp_field" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.hp || ''} onChange={set('hp')} style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, opacity: 0 }} />
            <div className="grid gap-6 md:grid-cols-2">
              <Field label={t('ts_full_name')} error={errors.fullName}>
                <input type="text" autoComplete="name" value={form.fullName} onChange={set('fullName')} className={`${control} ${border('fullName')}`} />
              </Field>
              <Field label={t('ts_email')} error={errors.email}>
                <input type="email" autoComplete="email" value={form.email} onChange={set('email')} className={`${control} ${border('email')}`} />
              </Field>
              <Field label={t('ts_phone')} error={errors.phone}>
                <input type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} className={`${control} ${border('phone')}`} />
              </Field>
              <Field label={t('ts_birth')} error={errors.birthDate} optional>
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
                  placeholderText={t('ts_placeholder_date')}
                  wrapperClassName="w-full"
                  className={`${control} ${border('birthDate')}`}
                />
                {form.birthDate && <span className="mt-1.5 block text-sm text-gray-400">{t('ts_age', { n: ageFrom(form.birthDate) })}</span>}
              </Field>
              <Field label={t('ts_experience')} error={errors.experience}>
                <select value={form.experience} onChange={set('experience')} className={`${control} ${border('experience')}`}>
                  <option value="">{t('ts_select_exp')}</option>
                  {LEVELS.map((level, index) => <option key={level} value={level}>{t(`ts_level_${index}`)}</option>)}
                </select>
              </Field>
              <fieldset className="md:col-span-2">
                <legend className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">
                  {t('ts_goal')}<span className="ml-1 normal-case tracking-normal text-gray-600">{t('ts_goal_hint')}</span>
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {GOALS.map((goal, index) => {
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
                        {t(`ts_goal_${index}`)}
                      </label>
                    )
                  })}
                </div>
                {errors.goals && <span role="alert" className="mt-1.5 block text-sm text-red-300">{t(errors.goals)}</span>}
              </fieldset>
              <Field label={t('ts_date')} error={errors.date}>
                <DatePicker
                  selected={form.date}
                  onChange={chooseDate}
                  minDate={new Date()}
                  filterDate={isBookableDay}
                  dateFormat="dd/MM/yyyy"
                  placeholderText={t('ts_placeholder_date')}
                  wrapperClassName="w-full"
                  className={`${control} ${border('date')}`}
                />
              </Field>
              <Field label={t('ts_time')} error={errors.time}>
                <select value={form.time} onChange={set('time')} disabled={!form.date || loadingTimes || times.length === 0}
                  className={`${control} ${border('time')}`}>
                  {!form.date && <option value="">{t('ts_choose_date_first')}</option>}
                  {form.date && loadingTimes && <option value="">{t('ts_loading')}</option>}
                  {form.date && !loadingTimes && times.length === 0 && <option value="">{t('ts_no_free')}</option>}
                  {times.map(time => <option key={time}>{time}</option>)}
                </select>
              </Field>
            </div>

            {serverError && (
              <p role="alert" className="mt-6 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{t(serverError)}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-8 inline-flex w-full items-center justify-center gap-3 rounded-xl bg-white px-8 py-4 text-sm font-semibold uppercase tracking-[3px] text-black transition hover:bg-gray-200 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 md:w-auto"
            >
              {submitting && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />}
              {submitting ? t('ts_sending') : t('ts_request')}
            </button>
          </form>
        )}
      </main>
    </div>
  )
}

export default TrialSession
