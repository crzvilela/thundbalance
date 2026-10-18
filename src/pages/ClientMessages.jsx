import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase/auth'
import Navbar from '../components/Navbar'
import ConfirmModal from '../components/inbox/ConfirmModal'
import MessageCard from '../components/inbox/MessageCard'
import { deleteMessage, loadInbox, markAllRead, markRead, runAction } from '../api/inbox'
import { adjustUnread, refreshUnread, setUnread } from '../hooks/useUnreadCount'
import { useI18n } from '../i18n/I18nContext'
import { resultKey } from '../utils/inboxFormat'

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'
const PAGE_SIZE = 20
// the answers that ask "are you sure?" first
const CONFIRMED_FIRST = { trial_decline: 'decline', reschedule_reject: 'reject' }

// The client's messages: the studio's notes and the automatic ones, newest first, with the buttons of each one.
function ClientMessages() {
  const navigate = useNavigate()
  const { t, language } = useI18n()
  const [signedIn, setSignedIn] = useState(false)
  const [filter, setFilter] = useState('all')                 // all | unread
  const [page, setPage] = useState(1)
  const [reloads, setReloads] = useState(0)
  const [view, setView] = useState(null)                      // { key, items, total, pages } or { key, error }
  const [now, setNow] = useState(() => new Date())
  const [expanded, setExpanded] = useState(() => new Set())
  const [busy, setBusy] = useState(null)                      // id of the message whose button is working (no double clicks)
  const [outcomes, setOutcomes] = useState({})                // id -> what the server answered to a button
  const [results, setResults] = useState({})                  // id -> translation key of the sentence under the buttons
  const [errors, setErrors] = useState({})                    // id -> translation key of the reason an action failed
  const [asking, setAsking] = useState(null)                  // { kind: 'decline' | 'reject' | 'delete', item, action }
  const [notice, setNotice] = useState('')
  const [markingAll, setMarkingAll] = useState(false)
  const working = useRef(false)

  useEffect(() => onAuthStateChanged(auth, (user) => {
    if (!user) { navigate('/login', { replace: true }); return }
    setSignedIn(true)
  }), [navigate])

  // the relative dates ("2 hours ago") follow the clock
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  // What is on screen depends on the language (the server writes the texts), the page, the filter and a reload counter.
  const key = `${language}|${page}|${filter}|${reloads}`
  useEffect(() => {
    if (!signedIn) return undefined
    let active = true
    loadInbox({ lang: language, page, filter, size: PAGE_SIZE }).then(
      data => {
        if (!active) return
        setView({ key, items: data.items, total: data.total, pages: data.pages })
        setUnread(data.unread)
      },
      problem => { if (active) setView({ key, error: problem.message }) }
    )
    return () => { active = false }
  }, [signedIn, key, language, page, filter])

  const loading = !view || view.key !== key
  const items = view?.items || []
  const hasUnread = items.some(item => !item.read)

  const changeFilter = (next) => { if (next !== filter) { setFilter(next); setPage(1) } }

  const read = useCallback(async (item) => {
    if (item.read) return
    setView(current => (current && current.items ? { ...current, items: current.items.map(entry => (entry.id === item.id ? { ...entry, read: true } : entry)) } : current))
    adjustUnread(-1)                                       // the number in the menu changes at once
    try {
      await markRead(item.id)
    } catch {
      setReloads(count => count + 1)                       // it did not go through: show what the server says
    } finally {
      refreshUnread({ force: true })
    }
  }, [])

  const toggle = useCallback((item) => {
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
    read(item)                                             // opening a message reads it
  }, [read])

  const readAll = async () => {
    if (markingAll) return
    setMarkingAll(true)
    try {
      await markAllRead()
      setView(current => (current && current.items ? { ...current, items: current.items.map(entry => ({ ...entry, read: true })) } : current))
      setUnread(0)
      if (filter === 'unread') setReloads(count => count + 1)
    } catch (problem) {
      setNotice(problem.message)
    } finally {
      setMarkingAll(false)
    }
  }

  const act = useCallback(async (item, action) => {
    if (working.current) return
    working.current = true
    setBusy(item.id)
    setErrors(current => ({ ...current, [item.id]: '' }))
    setResults(current => ({ ...current, [item.id]: '' }))
    try {
      const answer = await runAction(item.id, action.type, language)
      setView(current => (current && current.items ? { ...current, items: current.items.map(entry => (entry.id === item.id ? answer.item : entry)) } : current))
      setOutcomes(current => ({ ...current, [item.id]: answer.outcome }))
      setResults(current => ({ ...current, [item.id]: resultKey(action.type, answer.outcome) }))
      refreshUnread({ force: true })
    } catch (problem) {
      setErrors(current => ({ ...current, [item.id]: problem.message }))
    } finally {
      working.current = false
      setBusy(null)
      setAsking(null)
    }
  }, [language])

  const onAction = useCallback((item, action) => {
    if (CONFIRMED_FIRST[action.type]) setAsking({ kind: CONFIRMED_FIRST[action.type], item, action })
    else act(item, action)
  }, [act])

  const onDelete = useCallback((item) => setAsking({ kind: 'delete', item }), [])

  const confirmDelete = async () => {
    const { item } = asking
    if (working.current) return
    working.current = true
    setBusy(item.id)
    try {
      await deleteMessage(item.id)
      setView(current => (current && current.items ? { ...current, items: current.items.filter(entry => entry.id !== item.id), total: Math.max(0, current.total - 1) } : current))
      setNotice('in_deleted')
      if (items.length <= 1) {                               // the page is empty now: the one before, or a fresh look
        if (page > 1) setPage(page - 1)
        else setReloads(count => count + 1)
      }
      if (!item.read) adjustUnread(-1)
      refreshUnread({ force: true })
    } catch (problem) {
      setErrors(current => ({ ...current, [item.id]: problem.message }))
    } finally {
      working.current = false
      setBusy(null)
      setAsking(null)
    }
  }

  const modal = asking && (
    asking.kind === 'delete' ? (
      <ConfirmModal
        title={t('in_delete_title')} text={t('in_delete_text')} confirmLabel={t('in_delete')} cancelLabel={t('in_keep')} danger
        busy={busy === asking.item.id} onConfirm={confirmDelete} onCancel={() => setAsking(null)}
      />
    ) : (
      <ConfirmModal
        title={t(asking.kind === 'decline' ? 'in_decline_title' : 'in_reject_title')}
        text={t(asking.kind === 'decline' ? 'in_decline_text' : 'in_reject_text')}
        confirmLabel={t(asking.kind === 'decline' ? 'in_decline_ok' : 'in_reject_ok')} cancelLabel={t('in_keep')}
        busy={busy === asking.item.id} onConfirm={() => act(asking.item, asking.action)} onCancel={() => setAsking(null)}
      />
    )
  )

  return (
    <div className="min-h-screen bg-[#080a09] text-white">
      <Navbar />

      <main className="relative mx-auto max-w-3xl px-4 pb-24 pt-32 sm:px-5 md:pt-44">
        <div className="pointer-events-none absolute left-0 top-24 h-72 w-72 rounded-full bg-emerald-500/5 blur-3xl" />

        <header className="relative mb-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">{t('dash_client_space')}</p>
          <h1 className="text-5xl md:text-6xl" style={{ fontFamily: 'Bebas Neue' }}>{t('in_title')}</h1>
          <p className="mt-3 max-w-xl text-sm text-gray-300">{t('in_intro')}</p>
        </header>

        <div className="relative mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl border border-white/15 p-1" role="group" aria-label={t('in_title')}>
            {[['all', 'in_filter_all'], ['unread', 'in_filter_unread']].map(([value, label]) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => changeFilter(value)}
                className={`min-h-[44px] rounded-lg px-5 text-sm font-semibold transition ${FOCUS} ${filter === value ? 'bg-emerald-400 text-black' : 'text-gray-300 hover:text-white'}`}>
                {t(label)}
              </button>
            ))}
          </div>
          <button type="button" onClick={readAll} disabled={markingAll || !hasUnread}
            className={`inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-white/25 px-5 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto ${FOCUS}`}>
            {markingAll && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />}
            {t('in_mark_all')}
          </button>
        </div>

        {notice && (
          <p role="status" className="relative mb-6 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-3 text-sm text-emerald-100">{t(notice)}</p>
        )}

        {view?.error && !loading ? (
          <div role="alert" className="relative rounded-3xl border border-white/10 bg-white/[0.025] p-10 text-center">
            <p className="mb-5 text-gray-200">{t('in_error')}</p>
            <button type="button" onClick={() => setReloads(count => count + 1)} className={`min-h-[44px] rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black hover:bg-gray-200 ${FOCUS}`}>{t('in_retry')}</button>
          </div>
        ) : loading ? (
          <div role="status" aria-label={t('in_loading')} className="relative space-y-4">
            {[0, 1, 2].map(row => <div key={row} className="h-40 animate-pulse rounded-3xl border border-white/10 bg-white/[0.04]" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="relative rounded-3xl border border-white/10 bg-white/[0.025] p-10 text-center text-gray-300">
            <p>{t(filter === 'unread' ? 'in_empty_unread' : 'in_empty')}</p>
            {filter === 'unread' && <button type="button" onClick={() => changeFilter('all')} className={`mt-4 min-h-[44px] rounded-lg px-3 text-sm font-semibold text-emerald-300 underline underline-offset-4 ${FOCUS}`}>{t('in_filter_all')}</button>}
          </div>
        ) : (
          <>
            <ul className="relative space-y-4">
              {items.map(item => (
                <li key={item.id}>
                  <MessageCard
                    item={item} now={now} expanded={expanded.has(item.id)} busy={busy === item.id}
                    outcome={outcomes[item.id]} result={results[item.id]} error={errors[item.id]}
                    onToggle={toggle} onRead={read} onAction={onAction} onDelete={onDelete}
                  />
                </li>
              ))}
            </ul>

            {view.pages > 1 && (
              <nav className="relative mt-8 flex flex-wrap items-center justify-between gap-3" aria-label={t('in_title')}>
                <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className={`min-h-[44px] rounded-xl border border-white/25 px-5 text-sm font-semibold transition hover:bg-white/10 disabled:opacity-40 ${FOCUS}`}>{t('in_prev')}</button>
                <span className="text-sm text-gray-400">{t('in_page', { page, pages: view.pages })}</span>
                <button type="button" disabled={page >= view.pages} onClick={() => setPage(page + 1)} className={`min-h-[44px] rounded-xl border border-white/25 px-5 text-sm font-semibold transition hover:bg-white/10 disabled:opacity-40 ${FOCUS}`}>{t('in_next')}</button>
              </nav>
            )}
          </>
        )}

        <p className="relative mt-10 text-center text-sm text-gray-400">
          <Link to="/dashboard" className={`rounded underline underline-offset-4 hover:text-white ${FOCUS}`}>{t('ms_dashboard')}</Link>
        </p>
      </main>

      {modal}
    </div>
  )
}

export default ClientMessages
