import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { API_URL } from '../config'
import { useI18n } from '../i18n/I18nContext'

const PLACE = 'ThundBalance, Carrer de Pallars 286, 08005 Barcelona'

// Public page opened from the email. Opening it only READS the session: nothing
// is confirmed until the visitor presses a button (a POST), so link scanners and
// previewers in mail apps can not confirm or decline by accident.
function TrialConfirm() {
  const { token } = useParams()
  const [searchParams] = useSearchParams()
  const { t, locale } = useI18n()
  const [view, setView] = useState(null)        // { state, first_name, date, time } | { state: 'not_found' | 'error' }
  const [mode, setMode] = useState(searchParams.get('action') === 'decline' ? 'decline' : 'confirm')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)        // message key + tone once an answer was sent
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // The link carries a secret: keep it out of search engines.
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])

  useEffect(() => {
    let active = true
    fetch(`${API_URL}/trial-sessions/confirmation/${encodeURIComponent(token)}`)
      .then(response => {
        if (response.status === 404) return { state: 'not_found' }
        if (!response.ok) throw new Error('server')
        return response.json()
      })
      .then(data => { if (active) setView(data) })
      .catch(() => { if (active) setView({ state: 'error' }) })
    return () => { active = false }
  }, [token, attempt])

  const answer = async action => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_URL}/trial-sessions/confirmation/${encodeURIComponent(token)}/${action}`, { method: 'POST' })
      if (!response.ok) throw new Error('server')
      const { outcome } = await response.json()
      const sameAnswer = (action === 'confirm' && outcome === 'already_confirmed') || (action === 'decline' && outcome === 'already_declined')
      if (outcome === 'confirmed') setDone({ title: 'tc_confirmed_title', text: 'tc_confirmed_text', good: true })
      else if (outcome === 'declined') setDone({ title: 'tc_declined_title', text: 'tc_declined_text', retry: true })
      else if (sameAnswer) setDone({ title: action === 'confirm' ? 'tc_confirmed_title' : 'tc_declined_title', text: action === 'confirm' ? 'tc_already_confirmed' : 'tc_already_declined', good: action === 'confirm', retry: action === 'decline' })
      else if (outcome === 'already_confirmed') setDone({ title: 'tc_confirmed_title', text: 'tc_conflict_confirmed', good: true })
      else if (outcome === 'already_declined') setDone({ title: 'tc_declined_title', text: 'tc_conflict_declined', retry: true })
      else if (outcome === 'expired') setView({ state: 'expired' })
      else setView({ state: 'unavailable' })
    } catch {
      setError('tc_error')
    } finally {
      setBusy(false)
    }
  }

  const when = view?.date
    ? `${new Date(`${view.date}T00:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${view.time}`
    : ''

  const panel = 'rounded-3xl border border-white/10 bg-white/[0.025] p-8 md:p-10'
  const primary = 'inline-flex w-full items-center justify-center gap-3 rounded-xl bg-white px-8 py-4 text-sm font-semibold uppercase tracking-[3px] text-black transition hover:bg-gray-200 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 sm:w-auto'
  const secondary = 'inline-flex w-full items-center justify-center rounded-xl border border-white/20 px-8 py-4 text-sm uppercase tracking-[3px] transition hover:bg-white/10 sm:w-auto'
  const spinner = <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />

  const message = (title, text, extra) => (
    <div role="status" className={`${panel} text-center`}>
      <h2 style={{ fontFamily: 'Bebas Neue' }} className="mb-3 text-4xl">{t(title)}</h2>
      <p className="mx-auto max-w-md text-gray-300">{t(text)}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {extra}
        <Link to="/" className={extra ? secondary : primary}>{t('tc_home')}</Link>
      </div>
    </div>
  )

  let content
  if (done) {
    content = (
      <div role="status" className={`${panel} text-center`}>
        {done.good && <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/15 text-3xl text-emerald-300">✓</span>}
        <h2 style={{ fontFamily: 'Bebas Neue' }} className="mb-3 text-4xl">{t(done.title)}</h2>
        <p className="mx-auto max-w-md text-gray-300">{t(done.text)}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/" className={primary}>{t('tc_home')}</Link>
          {done.retry && <Link to="/trial-session" className={secondary}>{t('tc_new_request')}</Link>}
        </div>
      </div>
    )
  } else if (!view) {
    content = <div role="status" className={`${panel} text-gray-400`}>{t('tc_loading')}</div>
  } else if (view.state === 'not_found') {
    content = message('tc_notfound_title', 'tc_notfound_text')
  } else if (view.state === 'expired') {
    content = message('tc_expired_title', 'tc_expired_text')
  } else if (view.state === 'unavailable') {
    content = message('tc_unavailable_title', 'tc_unavailable_text')
  } else if (view.state === 'error') {
    content = message('tc_error', 'tc_error', <button type="button" onClick={() => { setView(null); setAttempt(count => count + 1) }} className={primary}>{t('tc_retry')}</button>)
  } else if (view.state === 'confirmed' || view.state === 'declined') {
    const confirmed = view.state === 'confirmed'
    content = message(confirmed ? 'tc_confirmed_title' : 'tc_declined_title', confirmed ? 'tc_already_confirmed' : 'tc_already_declined',
      confirmed ? null : <Link to="/trial-session" className={primary}>{t('tc_new_request')}</Link>)
  } else {
    const declining = mode === 'decline'
    content = (
      <div className={panel}>
        <p className="mb-2 text-lg">{t('tc_hello', { name: view.first_name })}</p>
        <p className="mb-6 text-gray-300">{t(declining ? 'tc_decline_text' : 'tc_ready_text')}</p>
        <dl className="mb-8 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
            <dt className="text-xs uppercase tracking-wider text-gray-500">{t('tc_when')}</dt>
            <dd className="mt-1 text-lg capitalize">{when}</dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
            <dt className="text-xs uppercase tracking-wider text-gray-500">{t('tc_place')}</dt>
            <dd className="mt-1 text-lg">{PLACE}</dd>
          </div>
        </dl>
        {error && <p role="alert" className="mb-5 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{t(error)}</p>}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {declining ? (
            <>
              <button type="button" disabled={busy} onClick={() => answer('decline')} className={primary}>
                {busy && spinner}{busy ? t('tc_declining') : t('tc_decline_yes')}
              </button>
              <button type="button" disabled={busy} onClick={() => setMode('confirm')} className={secondary}>{t('tc_switch_confirm')}</button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => answer('confirm')} className={primary}>
                {busy && spinner}{busy ? t('tc_confirming') : t('tc_confirm')}
              </button>
              <button type="button" disabled={busy} onClick={() => setMode('decline')} className={secondary}>{t('tc_decline')}</button>
            </>
          )}
        </div>
      </div>
    )
  }

  const heading = view?.state === 'pending_confirmation' && !done ? t(mode === 'decline' ? 'tc_decline_title' : 'tc_ready_title') : t('tc_eyebrow')

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />
      <main className="mx-auto max-w-2xl px-5 pb-24 pt-36">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">{t('tc_eyebrow')}</p>
        <h1 style={{ fontFamily: 'Bebas Neue' }} className="mb-8 text-5xl md:text-6xl">{heading}</h1>
        {content}
      </main>
    </div>
  )
}

export default TrialConfirm
