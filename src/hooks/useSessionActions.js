import { useEffect, useState } from 'react'
import { API_URL } from '../config'
import { authFetch } from '../api/authFetch'
import { loadDay } from '../api/schedule'
import { answerMyProposal, createRescheduleRequest } from '../api/reschedule'
import { useI18n } from '../i18n/I18nContext'
import { madridNow } from '../utils/sessionDates'

// What the client can DO with a session, shared by My Sessions and the dashboard (the same rules, the same messages): the open modal, the toast,
// the hours offered, cancel, ask for a change of date and answer a proposal of the studio. `data` is what useClientSessions returned.

// The server speaks in technical sentences: the visitor only ever sees our own translated ones.
function friendlyCancel(problem) {
  if (problem instanceof TypeError) return 'ms_err_network'                       // fetch could not reach the server
  if (/past|started|ended/i.test(String(problem?.message || ''))) return 'ms_err_past'
  return 'ms_err_cancel'
}

export function useSessionActions(data) {
  const { t, language } = useI18n()
  const { reload } = data
  const [toast, setToast] = useState(null)   // { tone: 'success' | 'error', text }
  const [open, setOpen] = useState(null)     // { id, mode }
  const [answering, setAnswering] = useState(null)      // id of the proposal being answered (no double clicks)

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), toast.tone === 'error' ? 9000 : 5000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const showToast = (tone, text) => setToast({ tone, text })

  // The hours offered are the ones when ANY trainer is free (the modal then checks the session's own trainer and, if he or she
  // is busy, offers the trainers who are free then).
  const loadTimes = async (session, value) => {
    let list
    try {
      list = await loadDay(value, { force: true })
    } catch {
      throw new Error('ms_err_times')
    }
    const current = madridNow(new Date())
    return list.map(item => String(item).slice(0, 5)).filter(time => value !== current.date || time > current.time)
  }

  // Cancelling stays immediate. The server answers 200 with {error} for business rules, so check both.
  const cancel = async (session) => {
    try {
      const response = await authFetch(`${API_URL}/sessions/${session.id}`, { method: 'DELETE' })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.error) throw new Error(result.error || 'failed')
    } catch (problem) {
      throw new Error(friendlyCancel(problem), { cause: problem })
    }
    setOpen(null)
    showToast('success', t('ms_cancelled_ok'))
    await reload()
  }

  // The client no longer moves a session by themselves: they send ONE request and the studio decides.
  const requestChange = async (session, date, time, note, trainerId) => {
    await createRescheduleRequest(session.id, { date, time, note, lang: language, trainerId })
    setOpen(null)
    showToast('success', t('ms_request_sent'))
    await reload()
  }

  const respondTo = async (request, accept) => {
    if (answering) return
    setAnswering(request.id)
    try {
      await answerMyProposal(request.id, accept)
      setOpen(null)
      showToast('success', t(accept ? 'ms_proposal_accepted' : 'ms_proposal_declined'))
      await reload()
    } catch (problem) {
      showToast('error', t(problem.message))
      await reload()
    } finally {
      setAnswering(null)
    }
  }

  return { toast, setToast, showToast, open, setOpen, answering, loadTimes, cancel, requestChange, respondTo }
}
