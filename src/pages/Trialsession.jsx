import { cloneElement, isValidElement, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { API_URL } from '../config'
import { cachedDay, loadDay, loadWeek, pingServer, prefetchSchedule } from '../api/schedule'
import { useI18n } from '../i18n/I18nContext'
import FormField from '../components/forms/FormField'
import SessionTypeSection, { PriceSummary } from '../components/forms/SessionTypeSection'
import PhoneInput from '../components/forms/PhoneInput'
import EmailInput from '../components/forms/EmailInput'
import TrainerChoice from '../components/forms/TrainerChoice'
import { focusFirstInvalid } from '../components/forms/focusFirstInvalid'
import { formText, serverFieldError } from '../i18n/formText'
import { birthDateProblem, emailProblem, nameProblem, normalizeEmail, phoneProblem } from '../utils/validators'
import { formatMoney, sessionTypeBody, trialPricePerSession } from '../utils/pricing'
import { secondPersonProblems, usePricing } from '../utils/usePricing'

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

const EMPTY = { fullName: '', email: '', phone: '', birthDate: null, goals: [], experience: '', date: null, time: '', type: 'individual', secondName: '', secondEmail: '', trainerId: '' }

const control = 'w-full rounded-xl border bg-black/40 px-4 py-3.5 text-white outline-none transition focus:ring-2 focus:ring-emerald-400/20'

function validate(form) {
  const errors = {}
  const name = nameProblem(form.fullName)
  if (name) errors.fullName = `form:${name}`
  const email = emailProblem(form.email)
  if (email) errors.email = `form:${email}`
  const phone = phoneProblem(form.phone)
  if (phone) errors.phone = `form:${phone}`
  const birth = birthDateProblem(form.birthDate)
  const age = ageFrom(form.birthDate)
  if (birth) errors.birthDate = `form:${birth}`
  else if (form.birthDate && (age < 10 || age > 100)) errors.birthDate = 'ts_e_birth'
  const second = secondPersonProblems({ type: form.type, name: form.secondName, email: form.secondEmail })
  if (second.name) errors.secondName = `form:${second.name}`
  if (second.email) errors.secondEmail = `form:${second.email}`
  if (form.goals.length === 0) errors.goals = 'ts_e_goals'
  if (!form.experience) errors.experience = 'ts_e_experience'
  if (!form.date) errors.date = 'ts_e_date'
  else if (!form.time) errors.time = 'ts_e_time'
  return errors
}

// An error is a site text key, "form:<code>" (shared field texts) or "msg:<text>" (from the server).
function useErrorText() {
  const { t, language } = useI18n()
  return (error) => {
    if (!error) return ''
    if (error.startsWith('form:')) return formText(language, error.slice(5))
    if (error.startsWith('msg:')) return error.slice(4)
    return t(error)
  }
}

function Field({ label, error, children, optional, required }) {
  const { t } = useI18n()
  const errorText = useErrorText()
  return (
    <FormField label={label} required={required} error={errorText(error)} suffix={optional ? t('ts_optional') : undefined}>
      {({ id, describedBy, invalid }) => (isValidElement(children) && typeof children.type === 'string'
        ? cloneElement(children, { id, 'aria-describedby': describedBy, 'aria-invalid': invalid || undefined, 'aria-required': required || undefined })
        : children)}
    </FormField>
  )
}

function TrialSession() {
  const { t, language, locale } = useI18n()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')
  const formRef = useRef(null)
  const errorText = useErrorText()
  const [done, setDone] = useState(false)
  const { prices } = usePricing()
  const [existing, setExisting] = useState(null) // an open request of this email: { status, session_date, session_time }
  const [schedule, setSchedule] = useState(null) // times offered per weekday
  const [times, setTimes] = useState([]) // free start times on the chosen date
  const [timesState, setTimesState] = useState('idle') // idle | loading | ready | error
  const [slowTimes, setSlowTimes] = useState(false)
  const requestId = useRef(0)
  const [trainerStatus, setTrainerStatus] = useState('idle')   // the trainer asked for: idle | checking | ok | busy | none
  const [trainerRefresh, setTrainerRefresh] = useState(0)       // the server said the trainer was taken: check again
  const loadingTimes = timesState === 'loading'

  // As soon as the page opens: wake the server up (it sleeps when idle), read
  // the weekdays and fetch the times of the first bookable days, so the times
  // are usually there before the visitor reaches the field.
  useEffect(() => {
    let cancelled = false
    pingServer()
    loadWeek()
      .then(data => {
        if (!cancelled) setSchedule(data)
        return prefetchSchedule(date => (data[WEEKDAYS[(date.getDay() + 6) % 7]] || []).length > 0)
      })
      .catch(() => { if (!cancelled) setSchedule(null) })
    return () => { cancelled = true }
  }, [])

  // After 8 seconds of waiting, say that it can take a little longer.
  useEffect(() => {
    if (timesState !== 'loading') return undefined
    const timer = setTimeout(() => setSlowTimes(true), 8000)
    return () => { clearTimeout(timer); setSlowTimes(false) }
  }, [timesState])

  // Only days on which at least one trainer works can be picked.
  const isBookableDay = (date) => !schedule || (schedule[WEEKDAYS[(date.getDay() + 6) % 7]] || []).length > 0

  // The times depend on the date: they are the hours when a trainer is free.
  const applyTimes = (list) => {
    setTimes(list)
    setTimesState('ready')
    setForm(current => ({ ...current, time: list.includes('09:00') ? '09:00' : (list[0] || '') }))
  }

  const fetchTimesFor = async (selected, force = false) => {
    const key = dayKey(selected)
    const id = ++requestId.current
    const known = force ? null : cachedDay(key)
    if (known) {
      applyTimes(known)
      return
    }
    // The previous times stay on screen (dimmed) while the new ones arrive.
    setTimesState('loading')
    try {
      const list = await loadDay(key, { force })
      if (id === requestId.current) applyTimes(list)
    } catch {
      if (id !== requestId.current) return
      setTimes([])
      setTimesState('error')
    }
  }

  const chooseDate = (selected) => {
    setForm(current => ({ ...current, date: selected, time: '' }))
    setErrors(current => ({ ...current, date: undefined, time: undefined }))
    if (!selected) {
      requestId.current += 1
      setTimes([])
      setTimesState('idle')
      return
    }
    fetchTimesFor(selected)
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
    if (Object.keys(found).length) {
      focusFirstInvalid(formRef.current)
      return
    }

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
          email: normalizeEmail(form.email),
          phone: form.phone,
          birth_date: form.birthDate ? dayKey(form.birthDate) : null,
          goals: form.goals,
          experience: form.experience,
          session_date: sessionDate,
          session_time: form.time,
          trainer_id: form.trainerId || null,
          // only the kind of session: the server works the price out itself
          ...sessionTypeBody({ type: form.type, name: form.secondName, email: form.secondEmail })
        })
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 409 && data.detail?.code === 'trial_exists') {
        // This email already has an open request: show where it stands instead of an error.
        setExisting(data.detail)
        return
      }
      if (response.status === 409 && data.detail?.code === 'trainer_unavailable') {
        // somebody took that trainer a moment ago: the list of free ones is read again
        setTrainerRefresh(count => count + 1)
        setServerError('tc_race')
        return
      }
      const fieldError = response.status === 422 ? serverFieldError(data.detail, language) : null
      if (fieldError) {
        const key = { full_name: 'fullName', email: 'email', phone: 'phone', birth_date: 'birthDate', second_person_name: 'secondName', second_person_email: 'secondEmail' }[fieldError.field]
        if (key) {
          setErrors(current => ({ ...current, [key]: `msg:${fieldError.message}` }))
          focusFirstInvalid(formRef.current)
          return
        }
        throw new Error(`msg:${fieldError.message}`)
      }
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
        {!done && !existing && (
          <>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">{t('ts_eyebrow')}</p>
            <h1 style={{ fontFamily: 'Bebas Neue' }} className="mb-3 text-5xl md:text-6xl">{t('ts_title')}</h1>
            <p className="mb-10 max-w-xl text-gray-400">
              {t('ts_intro')}
            </p>
          </>
        )}

        {existing ? (
          <div role="alert" className="rounded-3xl border border-amber-400/40 bg-amber-400/[0.07] p-10 text-center">
            <span aria-hidden="true" className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-400/20 text-amber-300">
              <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                <path d="M12 9v4M12 17h.01" />
              </svg>
            </span>
            <h2 style={{ fontFamily: 'Bebas Neue' }} className="mb-3 text-4xl">{t('ts_ex_title')}</h2>
            <p className="mx-auto max-w-md text-gray-300">
              {t(`ts_ex_${existing.status}`, {
                date: new Date(`${existing.session_date}T00:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
                time: existing.session_time
              })}
            </p>
            <p className="mx-auto mt-3 max-w-md text-sm text-gray-500">{t('ts_ex_note')}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/my-sessions" className="rounded-xl bg-white px-6 py-3 text-sm font-semibold uppercase tracking-wider text-black transition hover:bg-gray-200">{t('ts_ex_sessions')}</Link>
              <Link to="/" className="rounded-xl border border-white/20 px-6 py-3 text-sm uppercase tracking-wider transition hover:bg-white/10">{t('ts_home')}</Link>
            </div>
          </div>
        ) : done ? (
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
          <form ref={formRef} onSubmit={handleSubmit} noValidate className="rounded-3xl border border-white/10 bg-white/[0.025] p-6 md:p-10">
            {/* Anti-bot trap: a checkbox off screen. Autofill and password managers fill text fields but never tick a checkbox, so a real visitor can not trip it. */}
            <input type="checkbox" name="tb_hp_field" id="tb_hp_field" tabIndex={-1} autoComplete="off" aria-hidden="true" checked={Boolean(form.hp)} onChange={(event) => setForm(current => ({ ...current, hp: event.target.checked ? '1' : '' }))} style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, opacity: 0 }} />
            <div className="grid gap-6 md:grid-cols-2">
              <div className="md:col-span-2">
                <SessionTypeSection
                  value={{ type: form.type, name: form.secondName, email: form.secondEmail }}
                  errors={{ name: errorText(errors.secondName), email: errorText(errors.secondEmail) }}
                  onChange={patch => {
                    setForm(current => ({
                      ...current,
                      ...(patch.type !== undefined ? { type: patch.type } : {}),
                      ...(patch.name !== undefined ? { secondName: patch.name } : {}),
                      ...(patch.email !== undefined ? { secondEmail: patch.email } : {})
                    }))
                    setErrors(current => ({ ...current, secondName: undefined, secondEmail: undefined }))
                  }}
                />
              </div>
              <Field label={t('ts_full_name')} error={errors.fullName} required>
                <input type="text" autoComplete="name" maxLength={100} value={form.fullName} onChange={set('fullName')}
                  onBlur={() => { const problem = nameProblem(form.fullName); setErrors(current => ({ ...current, fullName: problem ? `form:${problem}` : undefined })) }}
                  className={`${control} ${border('fullName')}`} />
              </Field>
              <EmailInput
                label={t('ts_email')} required language={language} value={form.email}
                error={errorText(errors.email)}
                onChange={value => { setForm(current => ({ ...current, email: value })); if (errors.email) setErrors(current => ({ ...current, email: undefined })) }}
              />
              <PhoneInput
                label={t('ts_phone')} required language={language} value={form.phone}
                error={errorText(errors.phone)}
                onChange={value => { setForm(current => ({ ...current, phone: value })); if (errors.phone) setErrors(current => ({ ...current, phone: undefined })) }}
              />
              <Field label={t('ts_birth')} error={errors.birthDate} optional>
                <DatePicker
                  selected={form.birthDate}
                  onChange={date => setForm(current => ({ ...current, birthDate: date }))}
                  maxDate={new Date()}
                  minDate={new Date(1900, 0, 1)}
                  ariaInvalid={errors.birthDate ? 'true' : undefined}
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
                <select value={form.time} onChange={set('time')} aria-busy={loadingTimes}
                  disabled={!form.date || timesState !== 'ready' || times.length === 0}
                  className={`${control} ${border('time')} ${loadingTimes && times.length ? 'opacity-50' : ''}`}>
                  {!form.date && <option value="">{t('ts_choose_date_first')}</option>}
                  {form.date && loadingTimes && times.length === 0 && <option value="">{t('ts_loading_times')}</option>}
                  {form.date && timesState === 'error' && <option value="">{t('ts_times_error')}</option>}
                  {form.date && timesState === 'ready' && times.length === 0 && <option value="">{t('ts_no_free')}</option>}
                  {times.map(time => <option key={time}>{time}</option>)}
                </select>
                {loadingTimes && form.date && (
                  <span role="status" className="mt-2 flex items-center gap-2 text-sm text-gray-400">
                    <span aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-emerald-400" />
                    <span>{t('ts_loading_times')}{slowTimes && <> · {t('ts_loading_slow')}</>}</span>
                  </span>
                )}
                {timesState === 'error' && form.date && (
                  <span role="alert" className="mt-2 flex flex-wrap items-center gap-3 text-sm text-red-300">
                    <span>{t('ts_times_error')}</span>
                    <button type="button" onClick={() => fetchTimesFor(form.date, true)} className="min-h-[44px] rounded-lg border border-white/20 px-4 text-white transition hover:bg-white/10">
                      {t('ts_retry')}
                    </button>
                  </span>
                )}
              </Field>
              <div className="md:col-span-2">
                <TrainerChoice
                  value={form.trainerId} onChange={trainerId => setForm(current => ({ ...current, trainerId }))}
                  date={form.date ? dayKey(form.date) : ''} time={form.time} refreshKey={trainerRefresh} onStatus={setTrainerStatus} disabled={submitting}
                  selectClass={`${control} border-white/15 focus:border-emerald-400/70`}
                />
              </div>
            </div>

            <div className="mt-8">
              <PriceSummary
                title={t('st_summary')}
                rows={[
                  { label: t('st_type_row'), value: t(form.type === 'dual' ? 'st_trial_dual' : 'st_trial_individual') },
                  { label: t('st_trial_price'), value: formatMoney(trialPricePerSession(prices, form.type)), strong: true }
                ]}
                note={form.type === 'dual' ? t('st_price_both') : undefined}
              />
            </div>

            {serverError && (
              <p role="alert" className="mt-6 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{errorText(serverError)}</p>
            )}

            <button
              type="submit"
              disabled={submitting || !form.date || !form.time || trainerStatus === 'busy' || trainerStatus === 'none'}
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
