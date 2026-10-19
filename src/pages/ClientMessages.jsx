import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { BsArchive } from 'react-icons/bs'
import { auth } from '../firebase/auth'
import Navbar from '../components/Navbar'
import ConfirmModal from '../components/inbox/ConfirmModal'
import MessageCard from '../components/inbox/MessageCard'
import { archiveMessage, archiveRead, loadInbox, markAllRead, markRead, runAction, unarchiveMessage } from '../api/inbox'
import { adjustUnread, refreshUnread, setUnread } from '../hooks/useUnreadCount'
import { useI18n } from '../i18n/I18nContext'
import { resultKey } from '../utils/inboxFormat'

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'
const PAGE_SIZE = 20
const UNDO_SECONDS = 7
// the answers that ask "are you sure?" first
const CONFIRMED_FIRST = { trial_decline: 'decline', reschedule_reject: 'reject' }
const fill = (text, values) => Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), text)

// The client's messages: the studio's notes and the automatic ones, newest first, with the buttons of each one.
// Nothing is deleted: a message is archived (it leaves the inbox and the number in the menu) and can be brought back.
function ClientMessages() {
  const navigate = useNavigate()
  const { t, language } = useI18n()
  const [signedIn, setSignedIn] = useState(false)
  const [tab, setTab] = useState('inbox')                     // inbox | archived
  const [filter, setFilter] = useState('all')                 // all | unread (only inside the inbox)
  const [page, setPage] = useState(1)
  const [reloads, setReloads] = useState(0)
  const [view, setView] = useState(null)                      // { key, items, total, pages, counts } or { key, error }
  const [now, setNow] = useState(() => new Date())
  const [expanded, setExpanded] = useState(() => new Set())
  const [busy, setBusy] = useState(null)                      // id of the message whose button is working (no double clicks)
  const [outcomes, setOutcomes] = useState({})                // id -> what the server answered to a button
  const [results, setResults] = useState({})                  // id -> translation key of the sentence under the buttons
  const [errors, setErrors] = useState({})                    // id -> translation key of the reason an action failed
  const [asking, setAsking] = useState(null)                  // { kind: 'decline' | 'reject', item, action }
  const [notice, setNotice] = useState('')
  const [undo, setUndo] = useState(null)                      // { id, seconds } after archiving one message
  const [markingAll, setMarkingAll] = useState(false)
  const [archivingRead, setArchivingRead] = useState(false)
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

  // the undo bar counts down by itself and goes away
  useEffect(() => {
    if (!undo) return undefined
    const timer = window.setTimeout(() => setUndo(current => (current && current.seconds <= 1 ? null : current && { ...current, seconds: current.seconds - 1 })), 1000)
    return () => window.clearTimeout(timer)
  }, [undo])

  // What is on screen depends on the language (the server writes the texts), the tab, the filter, the page and a reload counter.
  const asked = tab === 'archived' ? 'archived' : filter
  const key = `${language}|${page}|${asked}|${reloads}`
  useEffect(() => {
    if (!signedIn) return undefined
    let active = true
    loadInbox({ lang: language, page, filter: asked, size: PAGE_SIZE }).then(
      data => {
        if (!active) return
        setView({ key, items: data.items, total: data.total, pages: data.pages, counts: data.counts })
        setUnread(data.unread)
      },
      problem => { if (active) setView({ key, error: problem.message }) }
    )
    return () => { active = false }
  }, [signedIn, key, language, page, asked])

  const loading = !view || view.key !== key
  const items = view?.items || []
  const counts = view?.counts
  const hasUnread = items.some(item => !item.read)
  const reload = () => setReloads(count => count + 1)

  const changeTab = (next) => { if (next !== tab) { setTab(next); setPage(1); setUndo(null) } }
  const changeFilter = (next) => { if (next !== filter) { setFilter(next); setPage(1) } }

  const patchItems = useCallback((change) => setView(current => (current && current.items ? { ...current, items: change(current.items) } : current)), [])

  const read = useCallback(async (item) => {
    if (item.read) return
    patchItems(list => list.map(entry => (entry.id === item.id ? { ...entry, read: true } : entry)))
    adjustUnread(-1)                                       // the number in the menu changes at once
    try {
      await markRead(item.id)
    } catch {
      setReloads(count => count + 1)                       // it did not go through: show what the server says
    } finally {
      refreshUnread({ force: true })
    }
  }, [patchItems])

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
      patchItems(list => list.map(entry => ({ ...entry, read: true })))
      setUnread(0)
      if (filter === 'unread') reload()
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
      patchItems(list => list.map(entry => (entry.id === item.id ? answer.item : entry)))
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
  }, [language, patchItems])

  const onAction = useCallback((item, action) => {
    if (CONFIRMED_FIRST[action.type]) setAsking({ kind: CONFIRMED_FIRST[action.type], item, action })
    else act(item, action)
  }, [act])

  // Archiving asks nothing: it can be undone for a few seconds, and from the Archived tab for ever.
  const archive = useCallback(async (item) => {
    if (working.current) return
    working.current = true
    setBusy(item.id)
    setErrors(current => ({ ...current, [item.id]: '' }))
    try {
      await archiveMessage(item.id)
      patchItems(list => list.filter(entry => entry.id !== item.id))
      setView(current => (current && current.counts ? { ...current, total: Math.max(0, current.total - 1), counts: { ...current.counts, inbox: current.counts.inbox - 1, archived: current.counts.archived + 1 } } : current))
      if (!item.read) adjustUnread(-1)
      refreshUnread({ force: true })
      setUndo({ id: item.id, seconds: UNDO_SECONDS })
      if (items.length <= 1) { if (page > 1) setPage(page - 1); else reload() }
    } catch (problem) {
      setErrors(current => ({ ...current, [item.id]: problem.message }))
    } finally {
      working.current = false
      setBusy(null)
    }
  }, [items.length, page, patchItems])

  const unarchive = useCallback(async (item) => {
    if (working.current) return
    working.current = true
    setBusy(item.id)
    try {
      await unarchiveMessage(item.id)
      patchItems(list => list.filter(entry => entry.id !== item.id))
      setView(current => (current && current.counts ? { ...current, total: Math.max(0, current.total - 1), counts: { ...current.counts, inbox: current.counts.inbox + 1, archived: current.counts.archived - 1 } } : current))
      setNotice('in_unarchived')
      refreshUnread({ force: true })
      if (items.length <= 1) { if (page > 1) setPage(page - 1); else reload() }
    } catch (problem) {
      setErrors(current => ({ ...current, [item.id]: problem.message }))
    } finally {
      working.current = false
      setBusy(null)
    }
  }, [items.length, page, patchItems])

  const undoArchive = async () => {
    const { id } = undo
    setUndo(null)
    try {
      await unarchiveMessage(id)
    } catch (problem) {
      setNotice(problem.message)
    }
    reload()
    refreshUnread({ force: true })
  }

  const archiveAllRead = async () => {
    if (archivingRead) return
    setArchivingRead(true)
    try {
      const answer = await archiveRead()
      setNotice(answer.archived ? fill(t('in_archived_many'), { n: answer.archived }) : 'in_archived_none')
      reload()
      refreshUnread({ force: true })
    } catch (problem) {
      setNotice(problem.message)
    } finally {
      setArchivingRead(false)
    }
  }

  const modal = asking && (
    <ConfirmModal
      title={t(asking.kind === 'decline' ? 'in_decline_title' : 'in_reject_title')}
      text={t(asking.kind === 'decline' ? 'in_decline_text' : 'in_reject_text')}
      confirmLabel={t(asking.kind === 'decline' ? 'in_decline_ok' : 'in_reject_ok')} cancelLabel={t('in_keep')}
      busy={busy === asking.item.id} onConfirm={() => act(asking.item, asking.action)} onCancel={() => setAsking(null)}
    />
  )

  const tabs = [['inbox', 'in_tab_inbox', counts?.inbox], ['archived', 'in_tab_archived', counts?.archived]]
  const noticeText = notice && (notice.startsWith('in_') ? t(notice) : notice)

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

        <div className="relative mb-5 flex flex-wrap gap-2" role="tablist" aria-label={t('in_title')}>
          {tabs.map(([value, label, count]) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => changeTab(value)}
              className={`flex min-h-[44px] items-center gap-2 rounded-full border px-5 text-sm font-semibold transition ${FOCUS} ${tab === value ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-300' : 'border-white/15 text-gray-300 hover:text-white'}`}>
              {t(label)}
              <span className={`rounded-full px-2 text-xs tabular-nums ${tab === value ? 'bg-emerald-400/20' : 'bg-white/10'}`}>{count ?? '–'}</span>
            </button>
          ))}
        </div>

        {tab === 'inbox' && (
          <div className="relative mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-xl border border-white/15 p-1" role="group" aria-label={t('in_title')}>
              {[['all', 'in_filter_all'], ['unread', 'in_filter_unread']].map(([value, label]) => (
                <button key={value} type="button" aria-pressed={filter === value} onClick={() => changeFilter(value)}
                  className={`min-h-[44px] rounded-lg px-5 text-sm font-semibold transition ${FOCUS} ${filter === value ? 'bg-emerald-400 text-black' : 'text-gray-300 hover:text-white'}`}>
                  {t(label)}
                </button>
              ))}
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <button type="button" onClick={readAll} disabled={markingAll || !hasUnread}
                className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/25 px-5 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`}>
                {markingAll && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />}
                {t('in_mark_all')}
              </button>
              <button type="button" onClick={archiveAllRead} disabled={archivingRead}
                className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/25 px-5 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-50 ${FOCUS}`}>
                {archivingRead ? <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" /> : <BsArchive aria-hidden="true" className="h-4 w-4" />}
                {t('in_archive_read')}
              </button>
            </div>
          </div>
        )}

        {noticeText && (
          <p role="status" className="relative mb-6 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-3 text-sm text-emerald-100">{noticeText}</p>
        )}

        {view?.error && !loading ? (
          <div role="alert" className="relative rounded-3xl border border-white/10 bg-white/[0.025] p-10 text-center">
            <p className="mb-5 text-gray-200">{t('in_error')}</p>
            <button type="button" onClick={reload} className={`min-h-[44px] rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black hover:bg-gray-200 ${FOCUS}`}>{t('in_retry')}</button>
          </div>
        ) : loading ? (
          <div role="status" aria-label={t('in_loading')} className="relative space-y-4">
            {[0, 1, 2].map(row => <div key={row} className="h-40 animate-pulse rounded-3xl border border-white/10 bg-white/[0.04]" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="relative rounded-3xl border border-white/10 bg-white/[0.025] p-10 text-center text-gray-300">
            <p>{t(tab === 'archived' ? 'in_empty_archived' : filter === 'unread' ? 'in_empty_unread' : 'in_empty')}</p>
            {tab === 'inbox' && filter === 'unread' && <button type="button" onClick={() => changeFilter('all')} className={`mt-4 min-h-[44px] rounded-lg px-3 text-sm font-semibold text-emerald-300 underline underline-offset-4 ${FOCUS}`}>{t('in_filter_all')}</button>}
          </div>
        ) : (
          <>
            <ul className="relative space-y-4">
              {items.map(item => (
                <li key={item.id}>
                  <MessageCard
                    item={item} now={now} expanded={expanded.has(item.id)} busy={busy === item.id}
                    outcome={outcomes[item.id]} result={results[item.id]} error={errors[item.id]}
                    onToggle={toggle} onRead={read} onAction={onAction} onArchive={archive} onUnarchive={unarchive}
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

      {undo && (
        <div role="status" className="fixed bottom-5 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-between gap-4 rounded-xl border border-emerald-400/30 bg-emerald-950/95 px-4 py-3 text-sm text-emerald-100 shadow-xl backdrop-blur">
          <span>{t('in_archived')}</span>
          <button type="button" onClick={undoArchive} className="min-h-[44px] rounded-lg px-3 font-semibold text-emerald-300 underline underline-offset-4 hover:bg-white/10">{t('in_undo')} ({undo.seconds})</button>
        </div>
      )}

      {modal}
    </div>
  )
}

export default ClientMessages
