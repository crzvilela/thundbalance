import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from '../firebase/auth'
import Navbar from '../components/Navbar'
import TempPasswordNotice from '../components/TempPasswordNotice'
import TrainerChoice from '../components/forms/TrainerChoice'
import { API_URL } from '../config'
import { useI18n } from '../i18n/I18nContext'
import SessionTypeSection, { PriceSummary } from '../components/forms/SessionTypeSection'
import { formatMoney, packQuote, sessionTypeBody } from '../utils/pricing'
import { secondPersonProblems, usePricing } from '../utils/usePricing'
import { formText } from '../i18n/formText'

function TrainingRequest() {
  const navigate = useNavigate()
  const { t, language } = useI18n()
  const { prices } = usePricing()
  const [kind, setKind] = useState({ type: 'individual', name: '', email: '' })
  const [kindErrors, setKindErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [plans, setPlans] = useState([])
  const [planId, setPlanId] = useState('1')

  const [sessionsPerWeek, setSessionsPerWeek] = useState('1')

  const [preferredDays, setPreferredDays] = useState([])

  const [preferredTime, setPreferredTime] = useState('18:00')

  const [trainerId, setTrainerId] = useState('')               // the trainer asked for (optional)
  const [trainerStatus, setTrainerStatus] = useState('idle')   // idle | checking | ok | busy | none
  const [trainerRefresh, setTrainerRefresh] = useState(0)       // the server said the trainer was taken: check again
  const [problem, setProblem] = useState('')                    // a translation key, shown in the page (no alert boxes)

  // Start times offered per weekday (only when at least one trainer works).
  const [schedule, setSchedule] = useState(null)

  useEffect(() => {
    fetch(`${API_URL}/schedule`)
      .then(response => (response.ok ? response.json() : null))
      .then(data => setSchedule(data))
      .catch(() => setSchedule(null))
  }, [])

  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const offeredDays = schedule ? WEEKDAYS.filter(day => (schedule[day] || []).length > 0) : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  const FALLBACK_TIMES = Array.from({ length: 14 }, (_, index) => `${String(index + 7).padStart(2, '0')}:00`)

  // Times that work on EVERY chosen day (the same time is used each day).
  // With no day chosen yet, every time offered on any day is listed.
  const timeOptions = !schedule ? FALLBACK_TIMES
    : preferredDays.length
      ? FALLBACK_TIMES.filter(time => preferredDays.every(day => (schedule[day] || []).includes(time)))
      : [...new Set(offeredDays.flatMap(day => schedule[day]))].sort()
  const effectiveTime = timeOptions.includes(preferredTime) ? preferredTime : (timeOptions[0] || '')

  useEffect(() => {
    fetch(`${API_URL}/plans`)
      .then(response => {
        if (!response.ok) throw new Error('Could not load packages')
        return response.json()
      })
      .then(data => {
        setPlans(data)
        if (data.length) setPlanId(String(data[0][0]))
      })
      .catch(() => setPlans([]))
  }, [])

  // What the pack would cost: preview only, the server works the price out again
  const chosenPlan = plans.find(plan => String(plan[0]) === planId)
  const sessions = chosenPlan?.[4] ? chosenPlan[4] * Number(sessionsPerWeek) : 0
  const quote = packQuote(prices, kind.type, chosenPlan?.[2], sessions)

  const handleDayChange = (day) => {

    if (preferredDays.includes(day)) {

      setPreferredDays(
        preferredDays.filter(
          d => d !== day
        )
      )

    } else {

      setPreferredDays([
        ...preferredDays,
        day
      ])

    }

  }

  const handleSubmit = async () => {

    if (!auth.currentUser) { navigate('/login'); return }
    setProblem('')
    if (!preferredDays.length) { setProblem('tr_choose_day'); return }
    if (!effectiveTime) { setProblem('tr_no_time'); return }
    const second = secondPersonProblems(kind)
    if (second.name || second.email) {
      setKindErrors({ name: second.name && formText(language, second.name), email: second.email && formText(language, second.email) })
      return
    }
    if (quote.perSession == null) { setProblem('st_no_price'); return }
    setSubmitting(true)

    try {
      const token = await auth.currentUser.getIdToken()

      const response = await fetch(
        `${API_URL}/client-requests`,
        {
          method: 'POST',

          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },

          body: JSON.stringify({

            plan_id: parseInt(planId),

            sessions_per_week: parseInt(sessionsPerWeek),

            preferred_days: preferredDays.join(','),

            preferred_time: effectiveTime,

            trainer_id: trainerId || null,
            // only the kind of session: the server works the price out itself
            ...sessionTypeBody(kind)

          })

        }
      )

      if (!response.ok) {

        const body = await response.json().catch(() => ({}))

        if (response.status === 409 && body.detail?.code === 'trainer_unavailable') {
          setTrainerRefresh(count => count + 1)      // somebody took that trainer a moment ago: read the free ones again
          setProblem('tc_race')
          return
        }
        const field = body.detail?.field
        if (field === 'second_person_name' || field === 'second_person_email') {
          setKindErrors({ [field === 'second_person_name' ? 'name' : 'email']: String(body.detail.message || '') })
          return
        }
        setProblem(typeof body.detail === 'string' ? `msg:${body.detail}` : 'tr_err_send')

        return

      }

      await response.json()

      navigate('/dashboard')

    } catch (error) {

      console.log(error)

      setProblem(error instanceof TypeError ? 'tr_err_generic' : `msg:${error.message || t('tr_err_generic')}`)

    } finally {
      setSubmitting(false)
    }

  }

  return (

    <div className="min-h-screen bg-black text-white">

      <Navbar />

      <div className="max-w-4xl mx-auto pt-28 sm:pt-36 px-5 sm:px-6 pb-16">

        <TempPasswordNotice />

        <h1
          style={{ fontFamily: 'Bebas Neue' }}
          className="text-4xl sm:text-6xl mb-8 sm:mb-12"
        >
          {t('tr_title')}
        </h1>

        <div className="border border-white/10 p-5 sm:p-10 rounded-2xl">

          <div className="mb-8">
            <SessionTypeSection
              value={kind} errors={kindErrors} disabled={submitting}
              onChange={patch => { setKind(current => ({ ...current, ...patch })); setKindErrors({}) }}
            />
          </div>

          <div className="mb-8">

            <label className="block mb-2 text-gray-400">
              {t('tr_package')}
            </label>

            <select
              value={planId}
              onChange={(e) =>
                setPlanId(e.target.value)
              }
              className="w-full bg-black border border-white/20 p-4"
            >
              {plans.map(plan => <option key={plan[0]} value={plan[0]}>{plan[1]}</option>)}

            </select>

          </div>

          <div className="mb-8">

            <label className="block mb-2 text-gray-400">
              {t('tr_sessions_week')}
            </label>

            <select
              value={sessionsPerWeek}
              onChange={(e) =>
                setSessionsPerWeek(
                  e.target.value
                )
              }
              className="w-full bg-black border border-white/20 p-4"
            >
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
            </select>

          </div>

          <div className="mb-8">

            <label className="block mb-4 text-gray-400">
              {t('tr_days')}
            </label>

            <div className="flex flex-wrap gap-4">

              {offeredDays.map(day => (

                <button
                  key={day}
                  onClick={() =>
                    handleDayChange(day)
                  }
                  className={`min-h-[44px] px-4 py-2 rounded-lg border ${
                    preferredDays.includes(day)
                      ? 'bg-green-600 border-green-600'
                      : 'border-white/20'
                  }`}
                >
                  {t(`wd_${day}`)}
                </button>

              ))}

            </div>

          </div>

          <div className="mb-8">

            <label className="block mb-2 text-gray-400">
              {t('tr_time')}
            </label>

            <select
              value={effectiveTime}
              onChange={(e) =>
                setPreferredTime(
                  e.target.value
                )
              }
              disabled={timeOptions.length === 0}
              className="w-full bg-black border border-white/20 p-4"
            >
              {timeOptions.map(time => <option key={time}>{time}</option>)}
            </select>

            <p className="mt-2 text-sm text-gray-500">
              {timeOptions.length === 0
                ? t('tr_no_time')
                : t('tr_time_hint')}
            </p>

          </div>

          <div className="mb-8">

            <TrainerChoice
              value={trainerId} onChange={setTrainerId} weekdays={preferredDays} time={effectiveTime}
              refreshKey={trainerRefresh} onStatus={setTrainerStatus} disabled={submitting}
              labelClass="block mb-2 text-gray-400"
              selectClass="w-full bg-black border border-white/20 p-4 text-white"
            />

          </div>

          <div className="mb-8">
            <PriceSummary
              title={t('st_summary')}
              rows={[
                { label: t('st_package'), value: chosenPlan?.[1] || '—' },
                { label: t('st_type_row'), value: t(kind.type === 'dual' ? 'st_dual' : 'st_individual') },
                { label: t('st_sessions'), value: sessions },
                { label: t('st_price_session'), value: formatMoney(quote.perSession) },
                { label: t('st_price_total'), value: formatMoney(quote.total), strong: true }
              ]}
              note={quote.perSession == null && prices ? t('st_no_price') : (kind.type === 'dual' ? t('st_price_both') : undefined)}
            />
          </div>

          {problem && (
            <p role="alert" className="mb-6 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">{problem.startsWith('msg:') ? problem.slice(4) : t(problem)}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || plans.length === 0 || trainerStatus === 'busy' || trainerStatus === 'none'}
            className="w-full sm:w-auto bg-white text-black px-8 py-4 uppercase tracking-[3px] hover:bg-gray-300 transition duration-300"
          >
            {submitting ? t('tr_submitting') : plans.length ? t('tr_submit') : t('tr_unavailable')}
          </button>

        </div>

      </div>

    </div>

  )

}

export default TrainingRequest
