import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase/auth'
import Navbar from '../components/Navbar'
import { API_URL } from '../config'

// Sessions come as rows: [id, 'YYYY-MM-DD', 'HH:MM:SS', trainerName, status, rescheduled, number]
const toSession = (row) => ({
  id: row[0], date: String(row[1]), time: String(row[2]).slice(0, 5),
  trainer: row[3], status: row[4], rescheduled: !!row[5], number: row[6]
})

const pad = (value) => String(value).padStart(2, '0')
const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const parseKey = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d) }
const fullDate = (key) => parseKey(key).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

const card = 'rounded-3xl border border-white/10 bg-white/[0.025]'
const chip = {
  upcoming: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  completed: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  cancelled: 'border-red-400/30 bg-red-400/10 text-red-300',
  rescheduled: 'border-amber-400/30 bg-amber-400/10 text-amber-300'
}
const dotColor = { upcoming: 'bg-emerald-400', completed: 'bg-sky-400', cancelled: 'bg-red-400', rescheduled: 'bg-amber-400' }

function Spinner() {
  return <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
}

function MySessions() {
  const navigate = useNavigate()
  const todayKey = keyOf(new Date())

  const [sessions, setSessions] = useState([])
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
        fetch(`${API_URL}/users/email/${encodeURIComponent(email)}`),
        fetch(`${API_URL}/trainers`)
      ])
      if (!userResponse.ok) throw new Error('Could not load your account.')
      const user = await userResponse.json()
      if (!user.id) throw new Error('Your client profile is not available yet.')

      const sessionsResponse = await fetch(`${API_URL}/sessions/user/${user.id}`)
      if (!sessionsResponse.ok) throw new Error('Could not load your sessions.')
      const rows = await sessionsResponse.json()
      setSessions(Array.isArray(rows) ? rows.map(toSession) : [])

      // Trainer rows are [id, name, specialty]; the sessions only carry names.
      const trainers = trainersResponse.ok ? await trainersResponse.json() : []
      setTrainerIds(Object.fromEntries(trainers.map(row => [row[1], row[0]])))
      setError('')
    } catch (err) {
      setError(err.message || 'Could not load your sessions.')
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
      if (value) setModalError('We could not find this trainer\'s availability. Please contact us to reschedule.')
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
      if (!free.length) setModalError('No free times that day. Try another date.')
    } catch {
      setModalError('Could not load the available times. Please try again.')
    } finally {
      setLoadingTimes(false)
    }
  }

  // The server answers 200 with {error} for business rules, so check both.
  const send = async (method, body, success) => {
    setWorking(true); setModalError('')
    try {
      const response = await fetch(`${API_URL}/sessions/${open.id}`, {
        method,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.error) throw new Error(result.error || result.detail || 'Something went wrong. Please try again.')
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
    { label: 'Upcoming', value: groups.upcoming.length, tone: 'text-emerald-300' },
    { label: 'Completed', value: done, tone: 'text-sky-300' },
    { label: 'Next session', value: next ? parseKey(next.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—', hint: next ? `${next.time} · ${next.trainer}` : 'Nothing scheduled', tone: 'text-white' }
  ]

  const SessionRow = ({ session }) => {
    const status = statusOf(session)
    const date = parseKey(session.date)
    return (
      <button type="button" onClick={() => openSession(session)} className="group flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-left transition hover:border-emerald-400/40 hover:bg-emerald-400/[0.04]">
        <span className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl border ${chip[status]}`}>
          <span className="text-[10px] font-semibold uppercase leading-none">{date.toLocaleDateString('en-GB', { month: 'short' })}</span>
          <span style={{ fontFamily: 'Bebas Neue' }} className="text-2xl leading-none">{date.getDate()}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{date.toLocaleDateString('en-GB', { weekday: 'long' })} · {session.time}</span>
          <span className="block truncate text-sm text-gray-500">{session.trainer}{session.number ? ` · Session ${session.number}` : ''}</span>
        </span>
        <span className={`hidden rounded-full border px-3 py-1 text-xs font-medium capitalize sm:inline-block ${chip[status]}`}>{status}</span>
        <span aria-hidden="true" className="text-gray-600 transition group-hover:translate-x-0.5 group-hover:text-emerald-300">→</span>
      </button>
    )
  }

  return (
    <div className="min-h-screen bg-[#080a09] text-white">
      <Navbar />

      <main className="relative mx-auto max-w-6xl px-5 pb-24 pt-36 md:pt-44">
        <div className="pointer-events-none absolute left-0 top-24 h-72 w-72 rounded-full bg-emerald-500/5 blur-3xl" />

        <header className="relative mb-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">Your training</p>
            <h1 className="text-5xl md:text-6xl" style={{ fontFamily: 'Bebas Neue' }}>My Sessions</h1>
            <p className="mt-3 max-w-xl text-sm text-gray-400">See everything you have booked, move a session or cancel it. You can reschedule each session once.</p>
          </div>
          <Link to="/dashboard" className="rounded-xl border border-white/15 px-5 py-3 text-sm font-semibold transition hover:bg-white/10">← Dashboard</Link>
        </header>

        {notice && (
          <div role="status" className="relative mb-6 flex items-center justify-between rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-4 text-sm text-emerald-200">
            {notice}
            <button type="button" onClick={() => setNotice('')} aria-label="Dismiss" className="ml-4 text-emerald-300/70 hover:text-emerald-200">✕</button>
          </div>
        )}

        {error ? (
          <div role="alert" className={`${card} p-10 text-center`}>
            <p className="mb-5 text-gray-300">{error}</p>
            <button type="button" onClick={() => { setLoading(true); setError(''); load(auth.currentUser?.email) }} className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black hover:bg-gray-200">Try again</button>
          </div>
        ) : loading && sessions.length === 0 ? (
          <div role="status" className={`${card} flex items-center gap-3 p-10 text-gray-400`}><Spinner /> Loading your sessions…</div>
        ) : (
          <>
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
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Your progress</p>
                  <p className="text-sm text-gray-400"><span className="text-white">{done}</span> of {total} sessions completed</p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={total ? Math.round((done / total) * 100) : 0} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all duration-700" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                </div>
              </div>
            </section>

            {sessions.length === 0 ? (
              <div className={`${card} p-12 text-center`}>
                <p style={{ fontFamily: 'Bebas Neue' }} className="mb-3 text-4xl">No sessions yet</p>
                <p className="mx-auto mb-7 max-w-md text-gray-400">Once your training request is approved, your sessions will appear here.</p>
                <Link to="/dashboard" className="inline-block rounded-xl bg-emerald-400 px-6 py-3 text-sm font-semibold text-black transition hover:bg-emerald-300">Go to dashboard</Link>
              </div>
            ) : (
              <section className="relative grid gap-6 lg:grid-cols-5">
                <div className={`${card} p-6 lg:col-span-3`}>
                  <div className="mb-5 flex items-center justify-between">
                    <h2 style={{ fontFamily: 'Bebas Neue' }} className="text-3xl capitalize">{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2>
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-lg px-3 py-2 text-gray-400 transition hover:bg-white/10 hover:text-white">←</button>
                      <button type="button" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelectedDay(todayKey) }} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm transition hover:bg-white/10">Today</button>
                      <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-lg px-3 py-2 text-gray-400 transition hover:bg-white/10 hover:text-white">→</button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-1.5 text-center">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(name => <div key={name} className="pb-2 text-[11px] uppercase tracking-wider text-gray-500">{name}</div>)}
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
                    {[['upcoming', 'Upcoming'], ['completed', 'Completed'], ['rescheduled', 'Rescheduled'], ['cancelled', 'Cancelled']].map(([key, text]) => (
                      <span key={key} className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${dotColor[key]}`} />{text}</span>
                    ))}
                  </div>
                </div>

                <div className={`${card} p-6 lg:col-span-2`}>
                  <h2 style={{ fontFamily: 'Bebas Neue' }} className="text-3xl">{selectedDay ? fullDate(selectedDay).split(',')[0] + ', ' + parseKey(selectedDay).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'Next sessions'}</h2>
                  <p className="mb-5 mt-1 text-xs text-gray-500">{selectedDay ? 'Select the day again to see your next sessions.' : 'Click a day on the calendar to see it here.'}</p>
                  {agenda.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-gray-500">{selectedDay ? 'No session on this day.' : 'You have no upcoming sessions.'}</p>
                  ) : (
                    <ul className="space-y-3">{agenda.map(session => <li key={session.id}><SessionRow session={session} /></li>)}</ul>
                  )}
                </div>

                {groups.past.length > 0 && (
                  <div className={`${card} p-6 lg:col-span-5`}>
                    <h2 style={{ fontFamily: 'Bebas Neue' }} className="mb-5 text-3xl">Completed sessions</h2>
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
          <div role="dialog" aria-modal="true" aria-label="Session details" onClick={(event) => event.stopPropagation()}
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0b0e0d] p-7 shadow-2xl sm:rounded-3xl md:p-9">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">Session details</p>
                <h2 style={{ fontFamily: 'Bebas Neue' }} className="text-4xl md:text-5xl">{open.number ? `Session ${open.number}` : 'Session'}</h2>
              </div>
              <button type="button" onClick={closeModal} aria-label="Close" className="rounded-lg p-2 text-gray-400 transition hover:bg-white/10 hover:text-white">✕</button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[['Date', fullDate(open.date)], ['Time', open.time], ['Trainer', open.trainer]].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-wider text-gray-500">{label}</p>
                  <p className="mt-1 text-lg">{value}</p>
                </div>
              ))}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-wider text-gray-500">Status</p>
                <span className={`mt-2 inline-block rounded-full border px-3 py-1 text-sm font-medium capitalize ${chip[openStatus]}`}>{openStatus}</span>
              </div>
            </div>

            {mode === 'reschedule' && (
              <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <label className="block">
                  <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">New date</span>
                  <input type="date" min={todayKey} value={newDate} onChange={(event) => pickDate(event.target.value)} disabled={working}
                    style={{ colorScheme: 'dark' }} className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-white outline-none transition focus:border-emerald-400/70" />
                </label>
                {newDate && (
                  <div className="mt-5">
                    <p className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-400">New time {loadingTimes && <span className="ml-2 inline-block align-middle"><Spinner /></span>}</p>
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
                Cancel your session on <strong>{fullDate(open.date)}</strong> at <strong>{open.time}</strong>? This cannot be undone.
              </p>
            )}

            {modalError && <p role="alert" className="mt-5 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{modalError}</p>}

            <div className="mt-8 flex flex-wrap gap-3">
              {mode === 'view' && canChange && <>
                {!open.rescheduled && <button type="button" onClick={() => { setMode('reschedule'); setModalError('') }} className="rounded-xl border border-emerald-400/50 px-6 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-400 hover:text-black">Reschedule</button>}
                <button type="button" onClick={() => { setMode('cancel'); setModalError('') }} className="rounded-xl border border-red-400/50 px-6 py-3 text-sm font-semibold text-red-300 transition hover:bg-red-500 hover:text-white">Cancel session</button>
              </>}
              {mode === 'view' && canChange && open.rescheduled && <p className="basis-full text-sm text-gray-500">This session was already rescheduled once, so it can only be cancelled.</p>}
              {mode === 'reschedule' && <>
                <button type="button" disabled={!newDate || !newTime || working}
                  onClick={() => send('PUT', { session_date: newDate, session_time: newTime }, 'Your session was moved. See you then!')}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-6 py-3 text-sm font-semibold text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50">
                  {working && <Spinner />}Confirm new time
                </button>
                <button type="button" onClick={() => { setMode('view'); setModalError('') }} disabled={working} className="rounded-xl border border-white/15 px-6 py-3 text-sm transition hover:bg-white/10">Back</button>
              </>}
              {mode === 'cancel' && <>
                <button type="button" disabled={working} onClick={() => send('DELETE', null, 'Your session was cancelled.')}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-red-400 disabled:opacity-60">
                  {working && <Spinner />}Yes, cancel it
                </button>
                <button type="button" onClick={() => { setMode('view'); setModalError('') }} disabled={working} className="rounded-xl border border-white/15 px-6 py-3 text-sm transition hover:bg-white/10">Keep session</button>
              </>}
              {mode === 'view' && !canChange && <button type="button" onClick={closeModal} className="rounded-xl border border-white/15 px-6 py-3 text-sm transition hover:bg-white/10">Close</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MySessions
