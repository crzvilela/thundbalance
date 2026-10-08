import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from '../firebase/auth'
import Navbar from '../components/Navbar'
import TempPasswordNotice from '../components/TempPasswordNotice'
import { API_URL } from '../config'
import { useI18n } from '../i18n/I18nContext'

function TrainingRequest() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const [submitting, setSubmitting] = useState(false)
  const [plans, setPlans] = useState([])
  const [planId, setPlanId] = useState('1')

  const [sessionsPerWeek, setSessionsPerWeek] = useState('1')

  const [preferredDays, setPreferredDays] = useState([])

  const [preferredTime, setPreferredTime] = useState('18:00')

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
    if (!preferredDays.length) { alert(t('tr_choose_day')); return }
    if (!effectiveTime) { alert(t('tr_no_time')); return }
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

            preferred_time: effectiveTime

          })

        }
      )

      if (!response.ok) {

        const body = await response.json().catch(() => ({}))

        alert(typeof body.detail === 'string' ? body.detail : t('tr_err_send'))

        return

      }

      const data = await response.json()

      console.log(data)

      navigate('/dashboard')

    } catch (error) {

      console.log(error)

      alert(
        error.message || t('tr_err_generic')
      )

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

          <button
            onClick={handleSubmit}
            disabled={submitting || plans.length === 0}
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
