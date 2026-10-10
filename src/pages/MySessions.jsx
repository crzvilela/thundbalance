import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase/auth'
import Navbar from '../components/Navbar'
import TempPasswordNotice from '../components/TempPasswordNotice'
import { API_URL } from '../config'
import { authFetch } from '../api/authFetch'
import { useI18n } from '../i18n/I18nContext'

// Sessions come as rows: [id, 'YYYY-MM-DD', 'HH:MM:SS', trainerName, status, rescheduled, number]
const toSession = (row) => ({
  id: row[0], date: String(row[1]), time: String(row[2]).slice(0, 5),
  trainer: row[3], status: row[4], rescheduled: !!row[5], number: row[6]
})

const pad = (value) => String(value).padStart(2, '0')
const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const parseKey = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d) }
const fullDate = (key, locale) => parseKey(key).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

// Trial goals/levels are stored in English; the index is the translation key (ts_goal_N / ts_level_N).
const TRIAL_GOALS = ['Body recomposition', 'Lose weight', 'Build muscle', 'Increase strength', 'Rehabilitation/injury recovery', 'Conditioning', 'Endurance', 'Tone/define', 'Improve mobility & flexibility', 'Increase energy']
const TRIAL_LEVELS = ['Beginner', 'Intermediate', 'Advanced']

const card = 'rounded-3xl border border-white/10 bg-white/[0.025]'
const chip = {
  upcoming: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  completed: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  cancelled: 'border-red-400/30 bg-red-400/10 text-red-300',
  rescheduled: 'border-amber-400/30 bg-amber-400/10 text-amber-300'
}
const dotColor = { upcoming: 'bg-emerald-400', completed: 'bg-sky-400', cancelled: 'bg-red-400', rescheduled: 'bg-amber-400' }

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

function Spinner() {
  return <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
}

function MySessions() {
  const navigate = useNavigate()
  const { t, locale } = useI18n()
  const todayKey = keyOf(new Date())

  const [sessions, setSessions] = useState([])
  const [trial, setTrial] = useState(null) // { status, session_date, session_time, trainer, goal, experience }
  const [trainerIds, setTrainerIds] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1) })
  const [selectedDay, setSelectedDay] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [mode, setMode] = useState('view') // view | reschedule | cancel
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('')
  const [times, setTimes] = useState([])
  const [loadingTimes, setLoadingTimes] = useState(false)
  const [working, setWorking] = useState(false)
  const [modalError, setModalError] = useState('')

  const load = useCallback(async (email) => {
    try {
      const [userResponse, trainersResponse] = await Promise.all([
        authFetch(`${API_URL}/users/email/${encodeURIComponent(email)}`),
        fetch(`${API_URL}/trainers`)
      ])
      if (!userResponse.ok) throw new Error('ms_err_account')
      const user = await userResponse.json()
      if (!user.id) throw new Error('ms_err_profile')

      const sessionsResponse = await authFetch(`${API_URL}/sessions/user/${user.id}`)
      if (!sessionsResponse.ok) throw new Error('ms_err_sessions')
      const rows = await sessionsResponse.json()
      setSessions(Array.isArray(rows) ? rows.map(toSession) : [])

      // The open trial session of this login email (not part of the sessions list).
      try {
        const trialResponse = await authFetch(`${API_URL}/client/trial`)
        const body = trialResponse.ok ? await trialResponse.json() : null
        setTrial(body?.trial || null)
      } catch {
        setTrial(null)
      }

      // Trainer rows are [id, name, specialty]; the sessions only carry names.
      const trainers = trainersResponse.ok ? await trainersResponse.json() : []
      setTrainerIds(Object.fromEntries(trainers.map(row => [row[1], row[0]])))
      setError('')
    } catch (err) {
      setError(err.message || 'ms_err_sessions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => onAuthStateChanged(auth, (user) => {
    if (!user) { navigate('/login', { replace: true }); return }
    load(user.email)
  }), [navigate, load])

  const statusOf = useCallback((session) => {
    if (String(session.status).toLowerCase() === 'cancelled') return 'cancelled'
    if (session.date < todayKey) return 'completed'
    return session.rescheduled ? 'rescheduled' : 'upcoming'
  }, [todayKey])

  const groups = useMemo(() => {
    const active = sessions.filter(session => statusOf(session) !== 'cancelled')
    const upcoming = active.filter(session => session.date >= todayKey).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    const past = active.filter(session => session.date < todayKey).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
    return { active, upcoming, past }
  }, [sessions, statusOf, todayKey])

  const byDay = useMemo(() => {
    const map = new Map()
    for (const session of sessions) {
      if (!map.has(session.date)) map.set(session.date, [])
      map.get(session.date).push(session)
    }
    return map
  }, [sessions])

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const offset = (first.getDay() + 6) % 7
    const total = Math.ceil((offset + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7) * 7
    return Array.from({ length: total }, (_, index) => {
      const date = new Date(month.getFullYear(), month.getMonth(), index - offset + 1)
      return { key: keyOf(date), day: date.getDate(), inMonth: date.getMonth() === month.getMonth() }
    })
  }, [month])

  const open = openId ? sessions.find(session => session.id === openId) : null
  const openStatus = open ? statusOf(open) : null
  const canChange = open && openStatus === 'upcoming'
  const agenda = selectedDay ? (byDay.get(selectedDay) || []) : groups.upcoming.slice(0, 5)
  const total = groups.active.length
  const done = groups.past.length
  const next = groups.upcoming[0]

  const openSession = (session) => {
    setOpenId(session.id); setMode('view'); setModalError(''); setNewDate(''); setNewTime(''); setTimes([])
  }
  const closeModal = () => { if (!working) { setOpenId(null); setMode('view') } }

  const pickDate = async (value) => {
    setNewDate(value); setNewTime(''); setTimes([]); setModalError('')
    const trainerId = trainerIds[open.trainer]
    if (!value || !trainerId) {
      if (value) setModalError('ms_err_no_trainer')
      return
    }
    setLoadingTimes(true)
    try {
      const response = await fetch(`${API_URL}/trainer/${trainerId}/available-times/${value}`)
      const list = response.ok ? await response.json() : []
      const now = new Date()
      const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`
      const free = list.map(item => String(item).slice(0, 5)).filter(time => value !== todayKey || time > nowTime)
      setTimes(free)
      if (!free.length) setModalError('ms_err_no_times')
    } catch {
      setModalError('ms_err_times')
    } finally {
      setLoadingTimes(false)
    }
  }

  // The server answers 200 with {error} for business rules, so check both.
  const send = async (method, body, success) => {
    setWorking(true); setModalError('')
    try {
      const response = await authFetch(`${API_URL}/sessions/${open.id}`, {
        method,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.error) throw new Error(result.error || result.detail || 'ms_err_generic')
      setNotice(success)
      setOpenId(null); setMode('view')
      setLoading(true)
      await load(auth.currentUser.email)
    } catch (err) {
      setModalError(err.message)
    } finally {
      setWorking(false)
    }
  }

  const stats = [
    { label: t('ms_status_upcoming'), value: groups.upcoming.length, tone: 'text-emerald-300' },
    { label: t('ms_status_completed'), value: done, tone: 'text-sky-300' },
    { label: t('ms_next_session'), value: next ? parseKey(next.date).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : '—', hint: next ? `${next.time} · ${next.trainer}` : t('ms_nothing'), tone: 'text-white' }
  ]

  const SessionRow = ({ session }) => {
    const status = statusOf(session)
    const date = parseKey(session.date)
    return (
      <button type="button" onClick={() => openSession(session)} className="group flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-left transition hover:border-emerald-400/40 hover:bg-emerald-400/[0.04]">
        <span className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl border ${chip[status]}`}>
          <span className="text-[10px] font-semibold uppercase leading-none">{date.toLocaleDateString(locale, { month: 'short' })}</span>
          <span style={{ fontFamily: 'Bebas Neue' }} className="text-2xl leading-none">{date.getDate()}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{date.toLocaleDateString(locale, { weekday: 'long' })} · {session.time}</span>
          <span className="block truncate text-sm text-gray-500">{session.trainer}{session.number ? ` · ${t('ms_session_n', { n: session.number })}` : ''}</span>
        </span>
        <span className={`hidden rounded-full border px-3 py-1 text-xs font-medium capitalize sm:inline-block ${chip[status]}`}>{t(`ms_status_${status}`)}</span>
        <span aria-hidden="true" className="text-gray-600 transition group-hover:translate-x-0.5 group-hover:text-emerald-300">→</span>
      </button>
    )
  }

  return (
    <div className="min-h-screen bg-[#080a09] text-white">
      <Navbar />

      <main className="relative mx-auto max-w-6xl px-5 pb-24 pt-36 md:pt-44">
        <div className="pointer-events-none absolute left-0 top-24 h-72 w-72 rounded-full bg-emerald-500/5 blur-3xl" />
        <TempPasswordNotice />

        <header className="relative mb-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">{t('ms_eyebrow')}</p>
            <h1 className="text-5xl md:text-6xl" style={{ fontFamily: 'Bebas Neue' }}>{t('ms_title')}</h1>
            <p className="mt-3 max-w-xl text-sm text-gray-400">{t('ms_intro')}</p>
          </div>
          <Link to="/dashboard" className="rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold transition hover:bg-white/10">{t('ms_dashboard')}</Link>
        </header>

        {notice && (
          <div role="status" className="relative mb-6 flex items-center justify-between rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-4 text-sm text-emerald-200">
            {t(notice)}
            <button type="button" onClick={() => setNotice('')} aria-label={t('ms_dismiss')} className="ml-4 text-emerald-300/70 hover:text-emerald-200">✕</button>
          </div>
        )}

        {error ? (
          <div role="alert" className={`${card} p-10 text-center`}>
            <p className="mb-5 text-gray-300">{t(error)}</p>
            <button type="button" onClick={() => { setLoading(true); setError(''); load(auth.currentUser?.email) }} className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black hover:bg-gray-200">{t('pg_try_again')}</button>
          </div>
        ) : loading && sessions.length === 0 ? (
          <div role="status" className={`${card} flex items-center gap-3 p-10 text-gray-400`}><Spinner /> {t('ms_loading')}</div>
        ) : (
          <>
            {trial && (
              <section aria-label={t('tt_title')} className="relative mb-6 rounded-3xl border border-emerald-400/25 bg-emerald-400/[0.06] p-6 md:p-8">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">{t('tt_title')}</p>
                    <p className="max-w-xl text-sm text-gray-300">{t(`tt_text_${trial.status}`)}</p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-medium ${trial.status === 'confirmed' ? chip.upcoming : chip.rescheduled}`}>{t(`tt_status_${trial.status}`)}</span>
                </div>
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    [t('tt_date'), fullDate(trial.session_date, locale)],
                    [t('tt_time'), trial.session_time],
                    [t('tt_trainer'), trial.trainer || t('tt_trainer_tbd')],
                    [t('tt_experience'), TRIAL_LEVELS.includes(trial.experience) ? t('ts_level_' + TRIAL_LEVELS.indexOf(trial.experience)) : (trial.experience || '—')]
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                      <dt className="text-xs uppercase tracking-wider text-gray-500">{label}</dt>
                      <dd className="mt-1 text-base">{value}</dd>
                    </div>
                  ))}
                  {trial.goal && (
                    <div className="rounded-2xl border border-white/10 bg-black/30 p-4 sm:col-span-2 lg:col-span-4">
                      <dt className="text-xs uppercase tracking-wider text-gray-500">{t('tt_goal')}</dt>
                      <dd className="mt-1 text-base">{trial.goal.split(',').map(goal => goal.trim()).filter(Boolean).map(goal => (TRIAL_GOALS.includes(goal) ? t('ts_goal_' + TRIAL_GOALS.indexOf(goal)) : goal)).join(', ')}</dd>
                    </div>
                  )}
                </dl>
              </section>
            )}

            <section className="relative mb-6 grid gap-4 sm:grid-cols-3">
              {stats.map(stat => (
                <div key={stat.label} className={`${card} p-6`}>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{stat.label}</p>
                  <p style={{ fontFamily: 'Bebas Neue' }} className={`mt-2 text-5xl leading-none ${stat.tone}`}>{stat.value}</p>
                  {stat.hint && <p className="mt-2 truncate text-sm text-gray-500">{stat.hint}</p>}
                </div>
              ))}
              <div className={`${card} p-6 sm:col-span-3`}>
                <div className="mb-3 flex items-end justify-between">
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{t('ms_progress')}</p>
                  <p className="text-sm text-gray-400">{t('ms_progress_text', { done, total })}</p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={total ? Math.round((done / total) * 100) : 0} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all duration-700" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                </div>
              </div>
            </section>

            {sessions.length === 0 ? (
              <div className={`${card} p-12 text-center`}>
                <p style={{ fontFamily: 'Bebas Neue' }} className="mb-3 text-4xl">{t('ms_none_title')}</p>
                <p className="mx-auto mb-7 max-w-md text-gray-400">{t('ms_none_text')}</p>
                <Link to="/dashboard" className="inline-block rounded-xl bg-emerald-400 px-6 py-3 text-sm font-semibold text-black transition hover:bg-emerald-300">{t('ms_go_dashboard')}</Link>
              </div>
            ) : (
              <section className="relative grid gap-6 lg:grid-cols-5">
                <div className={`${card} p-6 lg:col-span-3`}>
                  <div className="mb-5 flex items-center justify-between">
                    <h2 style={{ fontFamily: 'Bebas Neue' }} className="text-3xl capitalize">{month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</h2>
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label={t('ms_prev_month')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-lg px-3 py-2 text-gray-400 transition hover:bg-white/10 hover:text-white">←</button>
                      <button type="button" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelectedDay(todayKey) }} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm transition hover:bg-white/10">{t('ms_today')}</button>
                      <button type="button" aria-label={t('ms_next_month')} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-lg px-3 py-2 text-gray-400 transition hover:bg-white/10 hover:text-white">→</button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-1.5 text-center">
                    {Array.from({ length: 7 }, (_, index) => new Date(2024, 0, 1 + index).toLocaleDateString(locale, { weekday: 'short' })).map(name => <div key={name} className="pb-2 text-[11px] uppercase tracking-wider text-gray-500">{name}</div>)}
                    {cells.map(cell => {
                      const list = byDay.get(cell.key) || []
                      const isSelected = cell.key === selectedDay
                      const isToday = cell.key === todayKey
                      return (
                        <button key={cell.key} type="button" onClick={() => setSelectedDay(isSelected ? null : cell.key)}
                          className={`relative flex aspect-square min-h-11 flex-col items-center justify-center rounded-2xl border text-sm transition ${
                            isSelected ? 'border-emerald-400 bg-emerald-400/15'
                              : isToday ? 'border-emerald-400/40 text-emerald-200 hover:bg-white/5' : 'border-transparent hover:border-white/15 hover:bg-white/5'
                          } ${cell.inMonth ? '' : 'opacity-30'}`}>
                          <span className="tabular-nums">{cell.day}</span>
                          {list.length > 0 && (
                            <span className="mt-0.5 flex gap-0.5">
                              {list.slice(0, 3).map(session => <span key={session.id} className={`h-1.5 w-1.5 rounded-full ${dotColor[statusOf(session)]}`} />)}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-400">
                    {['upcoming', 'completed', 'rescheduled', 'cancelled'].map(key => (
                      <span key={key} className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${dotColor[key]}`} />{t(`ms_status_${key}`)}</span>
                    ))}
                  </div>
                </div>

                <div className={`${card} p-6 lg:col-span-2`}>
                  <h2 style={{ fontFamily: 'Bebas Neue' }} className="text-3xl">{selectedDay ? parseKey(selectedDay).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' }) : t('ms_next_sessions')}</h2>
                  <p className="mb-5 mt-1 text-xs text-gray-500">{selectedDay ? t('ms_select_again') : t('ms_click_day')}</p>
                  {agenda.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-gray-500">{selectedDay ? t('ms_no_session_day') : t('ms_no_upcoming')}</p>
                  ) : (
                    <ul className="space-y-3">{agenda.map(session => <li key={session.id}><SessionRow session={session} /></li>)}</ul>
                  )}
                </div>

                {groups.past.length > 0 && (
                  <div className={`${card} p-6 lg:col-span-5`}>
                    <h2 style={{ fontFamily: 'Bebas Neue' }} className="mb-5 text-3xl">{t('ms_completed_sessions')}</h2>
                    <ul className="grid gap-3 md:grid-cols-2">{groups.past.slice(0, 8).map(session => <li key={session.id}><SessionRow session={session} /></li>)}</ul>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {open && (
        <div onClick={closeModal} className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-6">
          <div role="dialog" aria-modal="true" aria-label={t('ms_dialog')} onClick={(event) => event.stopPropagation()}
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0b0e0d] p-7 shadow-2xl sm:rounded-3xl md:p-9">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">{t('ms_details')}</p>
                <h2 style={{ fontFamily: 'Bebas Neue' }} className="text-4xl md:text-5xl">{open.number ? t('ms_session_n', { n: open.number }) : t('ms_session')}</h2>
              </div>
              <button type="button" onClick={closeModal} aria-label={t('ms_close')} className="rounded-lg p-2 text-gray-400 transition hover:bg-white/10 hover:text-white">✕</button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[[t('ms_date'), fullDate(open.date, locale)], [t('ms_time'), open.time], [t('ms_trainer'), open.trainer]].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-wider text-gray-500">{label}</p>
                  <p className="mt-1 text-lg">{value}</p>
                </div>
              ))}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-wider text-gray-500">{t('ms_status')}</p>
                <span className={`mt-2 inline-block rounded-full border px-3 py-1 text-sm font-medium capitalize ${chip[openStatus]}`}>{t(`ms_status_${openStatus}`)}</span>
              </div>
            </div>

            {mode === 'reschedule' && (
              <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <label className="block">
                  <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">{t('ms_new_date')}</span>
                  <input type="date" min={todayKey} value={newDate} onChange={(event) => pickDate(event.target.value)} disabled={working}
                    style={{ colorScheme: 'dark' }} className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-white outline-none transition focus:border-emerald-400/70" />
                </label>
                {newDate && (
                  <div className="mt-5">
                    <p className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">{t('ms_new_time')} {loadingTimes && <span className="ml-2 inline-block align-middle"><Spinner /></span>}</p>
                    <div className="flex flex-wrap gap-2">
                      {times.map(time => (
                        <button key={time} type="button" onClick={() => setNewTime(time)} aria-pressed={newTime === time}
                          className={`rounded-xl border px-4 py-2 text-sm tabular-nums transition ${newTime === time ? 'border-emerald-400 bg-emerald-400 font-semibold text-black' : 'border-white/15 hover:border-white/40'}`}>{time}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {mode === 'cancel' && (
              <p className="mt-6 rounded-2xl border border-red-400/25 bg-red-400/10 p-5 text-sm text-red-100">
                <span dangerouslySetInnerHTML={{ __html: t('ms_cancel_confirm', { date: escapeHtml(fullDate(open.date, locale)), time: escapeHtml(open.time) }).replace(/<b>/g, '<strong>').replace(/<\/b>/g, '</strong>') }} />
              </p>
            )}

            {modalError && <p role="alert" className="mt-5 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{t(modalError)}</p>}

            <div className="mt-8 flex flex-wrap gap-3">
              {mode === 'view' && canChange && <>
                {!open.rescheduled && <button type="button" onClick={() => { setMode('reschedule'); setModalError('') }} className="rounded-xl border border-emerald-400/50 px-6 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-400 hover:text-black">{t('ms_reschedule')}</button>}
                <button type="button" onClick={() => { setMode('cancel'); setModalError('') }} className="rounded-xl border border-red-400/50 px-6 py-3 text-sm font-semibold text-red-300 transition hover:bg-red-500 hover:text-white">{t('ms_cancel_session')}</button>
              </>}
              {mode === 'view' && canChange && open.rescheduled && <p className="basis-full text-sm text-gray-500">{t('ms_already_rescheduled')}</p>}
              {mode === 'reschedule' && <>
                <button type="button" disabled={!newDate || !newTime || working}
                  onClick={() => send('PUT', { session_date: newDate, session_time: newTime }, 'ms_moved')}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-6 py-3 text-sm font-semibold text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50">
                  {working && <Spinner />}{t('ms_confirm_time')}
                </button>
                <button type="button" onClick={() => { setMode('view'); setModalError('') }} disabled={working} className="rounded-xl border border-white/15 px-6 py-3 text-sm transition hover:bg-white/10">{t('ms_back')}</button>
              </>}
              {mode === 'cancel' && <>
                <button type="button" disabled={working} onClick={() => send('DELETE', null, 'ms_cancelled_ok')}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-red-400 disabled:opacity-60">
                  {working && <Spinner />}{t('ms_yes_cancel')}
                </button>
                <button type="button" onClick={() => { setMode('view'); setModalError('') }} disabled={working} className="rounded-xl border border-white/15 px-6 py-3 text-sm transition hover:bg-white/10">{t('ms_keep')}</button>
              </>}
              {mode === 'view' && !canChange && <button type="button" onClick={closeModal} className="rounded-xl border border-white/15 px-6 py-3 text-sm transition hover:bg-white/10">{t('ms_close')}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MySessions
