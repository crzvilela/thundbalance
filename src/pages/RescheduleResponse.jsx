import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { answerProposal, loadProposal } from '../api/reschedule'
import { useI18n } from '../i18n/I18nContext'
import { formatDay, formatTime } from '../utils/sessionDates'

// The page the email's two buttons open. Opening it ONLY reads (so mail previewers and antivirus can not decide
// for the client); the proposal is accepted or declined by the click on a button (a POST), no login needed.
// The language is the site's (the email's ?lang= is used when the visitor has none saved).
const panel = 'rounded-3xl border border-white/10 bg-white/[0.03] p-8 md:p-10'
const primary = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-400 px-6 py-3 text-sm font-semibold text-black transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60'
const secondary = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/25 px-6 py-3 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60'
const spinner = <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />

function RescheduleResponse() {
  const { token } = useParams()
  const [searchParams] = useSearchParams()
  const { t, locale } = useI18n()
  const [view, setView] = useState(null)         // { state, first_name, session_date, ... } | { state: 'notfound' }
  const [outcome, setOutcome] = useState('')      // after a click: accepted | declined | expired | slot_taken | unavailable | notfound
  const [busy, setBusy] = useState('')            // 'accept' | 'decline'
  const [problem, setProblem] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const highlight = searchParams.get('action')    // the button the email link was about (only a hint: nothing is sent)

  useEffect(() => {
    let active = true
    loadProposal(token).then(
      data => { if (active) { setView(data); setProblem(false) } },
      () => { if (active) setProblem(true) },
    )
    return () => { active = false }
  }, [token, attempt])

  const answer = useCallback(async (accept) => {
    if (busy) return                              // no double clicks
    setBusy(accept ? 'accept' : 'decline'); setProblem(false)
    try {
      const result = await answerProposal(token, accept)
      setOutcome(result.outcome)
    } catch {
      setProblem(true)
    } finally {
      setBusy('')
    }
  }, [busy, token])

  const day = (date, time) => (date ? `${formatDay(date, locale)}, ${formatTime(time)}` : '')
  const message = (title, text, extra) => (
    <div role="status" className={`${panel} text-center`}>
      <h2 style={{ fontFamily: 'Bebas Neue' }} className="mb-3 text-4xl">{t(title)}</h2>
      <p className="mx-auto max-w-md text-gray-300">{text}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">{extra}<Link to="/" className={extra ? secondary : primary}>{t('rr_home')}</Link></div>
    </div>
  )

  let content
  if (problem && !view) {
    content = message('rr_error', t('rr_error'), <button type="button" onClick={() => setAttempt(count => count + 1)} className={primary}>{t('rr_retry')}</button>)
  } else if (!view) {
    content = <div role="status" className={`${panel} text-gray-400`}>{t('rr_loading')}</div>
  } else if (outcome === 'accepted' || (!outcome && view.state === 'accepted')) {
    content = message('rr_accepted_title', t('rr_accepted_text', { to: day(view.counter_date, view.counter_time) }))
  } else if (outcome === 'declined' || (!outcome && view.state === 'declined')) {
    content = message('rr_declined_title', t('rr_declined_text', { from: day(view.session_date, view.session_time) }))
  } else if (outcome === 'slot_taken') {
    content = message('rr_unavailable_title', t('rr_slot_taken'))
  } else if (outcome === 'expired' || (!outcome && view.state === 'expired')) {
    content = message('rr_expired_title', t('rr_expired_text'))
  } else if (outcome === 'notfound' || view.state === 'notfound') {
    content = message('rr_notfound_title', t('rr_notfound_text'))
  } else if (outcome === 'unavailable' || view.state === 'unavailable') {
    content = message('rr_unavailable_title', t('rr_unavailable_text'))
  } else {
    content = (
      <div className={panel}>
        {view.first_name && <p className="mb-2 text-lg">{t('rr_hello', { name: view.first_name })}</p>}
        <p className="mb-6 text-gray-300">{t('rr_waiting_text')}</p>
        <dl className="mb-8 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <dt className="text-xs uppercase tracking-wider text-gray-400">{t('rr_from')}</dt>
            <dd className="mt-1 text-base first-letter:uppercase">{day(view.session_date, view.session_time)}</dd>
          </div>
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.06] p-4">
            <dt className="text-xs uppercase tracking-wider text-emerald-300">{t('rr_to')}</dt>
            <dd className="mt-1 text-base first-letter:uppercase">{day(view.counter_date, view.counter_time)}</dd>
          </div>
        </dl>
        {problem && <p role="alert" className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">{t('rr_error')}</p>}
        <div className="grid gap-3 sm:flex">
          <button type="button" disabled={!!busy} onClick={() => answer(true)} className={highlight === 'decline' ? secondary : primary}>
            {busy === 'accept' && spinner}{busy === 'accept' ? t('rr_accepting') : t('rr_accept')}
          </button>
          <button type="button" disabled={!!busy} onClick={() => answer(false)} className={highlight === 'decline' ? primary : secondary}>
            {busy === 'decline' && spinner}{busy === 'decline' ? t('rr_declining') : t('rr_decline')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />
      <main className="mx-auto max-w-2xl px-5 pb-24 pt-36">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">{t('rr_eyebrow')}</p>
        <h1 style={{ fontFamily: 'Bebas Neue' }} className="mb-8 text-5xl md:text-6xl">{t('rr_title')}</h1>
        {content}
      </main>
    </div>
  )
}

export default RescheduleResponse
