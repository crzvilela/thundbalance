import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase/auth'
import { API_URL } from '../config'
import { authFetch } from '../api/authFetch'
import { useFeatures } from '../api/features'
import { loadMyRequests } from '../api/reschedule'
import { bySession, changeState } from '../utils/changeRequest'
import { madridNow, sessionStatus } from '../utils/sessionDates'

// Everything the client's calendar and My Sessions need, loaded for the SIGNED-IN client only (every call carries their token):
// sessions, the open trial session, the pending pack request, their change requests and the rules the server states.
// Shared by My Sessions and the dashboard calendar, so both show the same thing the same way.

// Sessions come as rows: [id, 'YYYY-MM-DD', 'HH:MM:SS', trainerName, status, rescheduled, number]
const toSession = (row) => ({
  id: row[0], date: String(row[1]), time: String(row[2]).slice(0, 5),
  trainer: row[3], status: row[4], rescheduled: !!row[5], number: row[6]
})

const EMPTY_REQUESTS = { items: [], max_per_session: 1, notice_hours: null, note_max: 300 }

export function useClientSessions() {
  const navigate = useNavigate()
  const { rescheduleMinHours } = useFeatures()      // the notice hours when the requests could not be read
  const [now, setNow] = useState(() => new Date())
  const today = madridNow(now).date

  const [sessions, setSessions] = useState([])
  const [trial, setTrial] = useState(null)             // { status, session_date, session_time, trainer, goal, experience, created_at }
  const [packRequest, setPackRequest] = useState(null) // the pack request waiting for the studio, if any
  const [trainerIds, setTrainerIds] = useState({})
  const [requestInfo, setRequestInfo] = useState(EMPTY_REQUESTS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')                // a translation key

  // the "completed" state follows the clock: look again every minute
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000)
    return () => window.clearInterval(timer)
  }, [])

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

      // The change requests of this client and the rules the page shows (the server owns the numbers).
      try {
        const info = await loadMyRequests()
        setRequestInfo(previous => ({ ...previous, ...info, items: Array.isArray(info.items) ? info.items : [] }))
      } catch {
        // the sessions are still shown; the change button simply keeps what it knew
      }

      // The open trial session of this login email (not part of the sessions list).
      try {
        const trialResponse = await authFetch(`${API_URL}/client/trial`)
        const body = trialResponse.ok ? await trialResponse.json() : null
        setTrial(body?.trial || null)
      } catch {
        setTrial(null)
      }

      // The pack request that waits for the studio (the dashboard's "pending" state).
      try {
        const workflowResponse = await authFetch(`${API_URL}/client/workflow`)
        const workflow = workflowResponse.ok ? await workflowResponse.json() : null
        setPackRequest(workflow?.state === 'pending' ? workflow.request : null)
      } catch {
        setPackRequest(null)
      }

      // Trainer rows are [id, name, specialty]; the sessions only carry names.
      const trainers = trainersResponse.ok ? await trainersResponse.json() : []
      setTrainerIds(Object.fromEntries(trainers.map(row => [row[1], row[0]])))
      setError('')
    } catch (problem) {
      setError(problem instanceof TypeError ? 'ms_err_network' : (problem.message?.startsWith('ms_') ? problem.message : 'ms_err_sessions'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => onAuthStateChanged(auth, (user) => {
    if (!user) { navigate('/login', { replace: true }); return }
    load(user.email)
  }), [navigate, load])

  // Reads everything again (after an action, or "Try again" when the server was asleep).
  const reload = useCallback(async () => {
    const email = auth.currentUser?.email
    if (!email) return
    setLoading(true)
    setError('')
    await load(email)
  }, [load])

  const requestsBySession = useMemo(() => bySession(requestInfo.items), [requestInfo])
  // the notice hours come from the server (the page never writes the number): with the requests, or from the public configuration
  const rules = useMemo(() => ({ limit: requestInfo.max_per_session, hours: requestInfo.notice_hours ?? rescheduleMinHours }), [requestInfo, rescheduleMinHours])
  const changeOf = useCallback((session) => changeState(session, requestsBySession.get(session.id) || [], rules, now), [requestsBySession, rules, now])

  // the state shown for a session: with a change waiting for the studio (or for the client) it is "change pending"
  const statusOf = useCallback((session) => {
    const base = sessionStatus(session, now)
    if (base === 'upcoming' || base === 'rescheduled') {
      const state = changeOf(session).state
      if (state === 'pending' || state === 'proposal') return 'change_pending'
    }
    return base
  }, [now, changeOf])

  const byDay = useMemo(() => {
    const map = new Map()
    for (const session of sessions) {
      if (!map.has(session.date)) map.set(session.date, [])
      map.get(session.date).push(session)
    }
    return map
  }, [sessions])

  return {
    sessions, trial, packRequest, trainerIds, requestInfo, loading, error, reload,
    now, today, rules, changeOf, statusOf, byDay
  }
}
