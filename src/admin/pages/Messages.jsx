import { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { adminRequest } from '../api'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { useToast } from '../toastContext'
import { Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Icon, PageHeader, Skeleton, TextInput } from '../ui'

const PAGE_SIZE = 25
const UNDO_SECONDS = 7
const CHECK = 'h-5 w-5 accent-emerald-400'

const fill = (text, values) => Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), text)

// Messages sent through the website's contact form (Contact section): Inbox and Archived, search, one
// message at a time or several at once. Archiving can be undone for a few seconds; deleting is final.
export default function Messages() {
  const { t, language } = useAdminText()
  const toast = useToast()
  const { messagesResource: badge } = useOutletContext()       // the menu badge (unread count)
  const locale = language === 'es' ? 'es-ES' : 'en-GB'

  const [tab, setTab] = useState('inbox')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(() => new Set())
  const [opened, setOpened] = useState(null)               // the message in the side panel
  const [deleting, setDeleting] = useState(null)           // ids waiting for the "irreversible" confirmation
  const [busy, setBusy] = useState(false)
  const [undo, setUndo] = useState(null)                   // { ids, seconds } after archiving

  const path = useMemo(() => {
    const query = new URLSearchParams({ archived: tab === 'archived' ? '1' : '0', limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) })
    if (q.trim()) query.set('q', q.trim())
    return `/admin/contact-messages?${query}`
  }, [tab, q, page])
  const resource = useAdminResource(path)
  const items = useMemo(() => resource.data?.items || [], [resource.data])
  const counts = resource.data?.counts
  const total = resource.data?.total || 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const reloadList = resource.reload
  const reloadBadge = badge.reload
  const refresh = useCallback(() => { reloadList(); reloadBadge() }, [reloadList, reloadBadge])

  // search: written after a short pause; a new search starts on page 1 with nothing selected
  useEffect(() => {
    if (search.trim() === q.trim()) return undefined
    const timer = window.setTimeout(() => { setQ(search.trim()); setPage(1); setSelected(new Set()) }, 350)
    return () => window.clearTimeout(timer)
  }, [search, q])

  // the undo bar counts down by itself and disappears
  useEffect(() => {
    if (!undo) return undefined
    const timer = window.setTimeout(() => setUndo(current => (current && current.seconds <= 1 ? null : current && { ...current, seconds: current.seconds - 1 })), 1000)
    return () => window.clearTimeout(timer)
  }, [undo])

  const when = (iso) => (iso ? new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
  const short = (iso) => (iso ? new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : '')

  const changeTab = (key) => { setTab(key); setPage(1); setSelected(new Set()) }
  const goPage = (next) => { setPage(next); setSelected(new Set()) }
  const toggle = (id) => setSelected(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const allSelected = items.length > 0 && items.every(item => selected.has(item.id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.map(item => item.id)))

  // one request, one transaction on the server; returns false when it failed
  const run = async (action, ids) => {
    setBusy(true)
    try {
      await adminRequest('POST', '/admin/contact-messages/bulk', { action, ids })
      setSelected(new Set())
      refresh()
      return true
    } catch (error) {
      toast.push(error.message, 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  const archive = async (ids) => {
    if (await run('archive', ids)) {
      setOpened(null)
      setUndo({ ids, seconds: UNDO_SECONDS })
    }
  }
  const unarchive = async (ids) => {
    if (await run('unarchive', ids)) { setOpened(null); setUndo(null); toast.push(fill(t('msg_unarchived_ok'), { n: ids.length })) }
  }
  const undoArchive = async () => {
    const ids = undo.ids
    setUndo(null)
    await run('unarchive', ids)
  }
  const markRead = async (ids, read) => {
    if (await run(read ? 'read' : 'unread', ids)) {
      setOpened(null)
      toast.push(fill(t(read ? 'msg_marked_read' : 'msg_marked_unread'), { n: ids.length }))
    }
  }
  const confirmDelete = async () => {
    const ids = deleting
    if (await run('delete', ids)) {
      setDeleting(null); setOpened(null); setUndo(null)
      toast.push(ids.length === 1 ? t('msg_deleted') : fill(t('msg_deleted_many'), { n: ids.length }))
    }
  }

  // opening a message marks it as read (the list is refreshed, so the dot and the menu badge go away)
  const open = async (message) => {
    setOpened(message)
    if (!message.read) {
      try {
        await adminRequest('POST', `/admin/contact-messages/${message.id}/read`)
        setOpened(current => (current && current.id === message.id ? { ...current, read: true } : current))
        refresh()
      } catch (error) {
        toast.push(error.message, 'error')
      }
    }
  }

  const tabs = [['inbox', t('msg_tab_inbox'), counts?.inbox], ['archived', t('msg_tab_archived'), counts?.archived]]
  const ids = [...selected]
  const emptyTitle = q.trim() ? 'msg_empty_search' : tab === 'archived' ? 'msg_empty_archived' : 'msg_empty_inbox'
  const replyHref = (message) => `mailto:${message.email}?subject=${encodeURIComponent(message.subject ? `Re: ${message.subject}` : t('msg_reply_subject'))}`
  const small = 'inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-medium transition'

  return (
    <div className="admin-fade">
      <PageHeader
        title={t('msg_title')} subtitle={t('msg_sub')}
        actions={<Button variant="secondary" onClick={refresh}><Icon name="refresh" className="h-4 w-4" />{t('refresh')}</Button>}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('msg_title')}>
          {tabs.map(([key, label, count]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => changeTab(key)}
              className={`flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-sm transition ${
                tab === key ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-gray-400 hover:border-white/25 hover:text-white'
              }`}>
              {label}
              <span className={`rounded-full px-1.5 text-xs tabular-nums ${tab === key ? 'bg-emerald-400/20' : 'bg-white/10'}`}>{count ?? '–'}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-80">
          <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <TextInput type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('msg_search')} aria-label={t('msg_search')} className="!pl-10" />
        </div>
      </div>

      {resource.error ? (
        <Card><ErrorState message={`${t('load_error')} (${resource.error})`} retryLabel={t('retry')} onRetry={resource.reload} /></Card>
      ) : resource.loading && !resource.data ? (
        <div className="overflow-hidden rounded-2xl border border-white/[0.08]" role="status" aria-label="…">
          {Array.from({ length: 5 }, (_, index) => <div key={index} className="flex h-20 items-center gap-4 border-b border-white/[0.06] px-5 last:border-b-0"><Skeleton className="!h-5 !w-5" /><Skeleton className="!h-10 w-full max-w-xl" /></div>)}
        </div>
      ) : items.length === 0 ? (
        <Card><EmptyState icon="inbox" title={t(emptyTitle)} /></Card>
      ) : (
        <>
          <div className="mb-2 flex min-h-[44px] flex-wrap items-center gap-x-4 gap-y-2 px-1">
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-sm text-gray-300">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className={CHECK} />
              {t('msg_select_all')}
            </label>
            {ids.length > 0 && (
              <>
                <span className="text-sm text-emerald-300" role="status">{fill(t('msg_selected'), { n: ids.length })}</span>
                <div className="flex flex-wrap gap-2">
                  {tab === 'archived'
                    ? <Button variant="secondary" onClick={() => unarchive(ids)} disabled={busy}>{t('msg_unarchive')}</Button>
                    : <Button variant="secondary" onClick={() => archive(ids)} disabled={busy}>{t('msg_archive')}</Button>}
                  <Button variant="secondary" onClick={() => markRead(ids, true)} disabled={busy}>{t('msg_mark_read_many')}</Button>
                  <Button variant="danger" onClick={() => setDeleting(ids)} disabled={busy}>{t('msg_delete')}</Button>
                </div>
              </>
            )}
          </div>

          <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
            {items.map(message => (
              <li key={message.id} className={`flex items-stretch ${selected.has(message.id) ? 'bg-emerald-400/[0.05]' : ''}`}>
                <label className="flex w-12 shrink-0 cursor-pointer items-center justify-center sm:w-14">
                  <input type="checkbox" checked={selected.has(message.id)} onChange={() => toggle(message.id)} className={CHECK} aria-label={fill(t('msg_select_one'), { name: message.name })} />
                </label>
                <button type="button" onClick={() => open(message)} aria-label={fill(t('msg_open'), { name: message.name })}
                  className="group min-w-0 flex-1 py-3.5 pr-4 text-left transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-400 sm:pr-5">
                  <span className="flex items-center gap-2">
                    {!message.read && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400" title={t('msg_unread_dot')} aria-hidden="true" />}
                    <span className={`truncate ${message.read ? 'text-gray-200' : 'font-semibold text-white'}`}>{message.name}</span>
                    <span className="hidden truncate text-sm text-gray-500 sm:inline">{message.email}</span>
                    <span className="ml-auto shrink-0 pl-2 text-xs text-gray-500">{short(message.created_at)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-gray-500 sm:hidden">{message.email}</span>
                  <span className={`mt-1 block truncate text-sm ${message.read ? 'text-gray-400' : 'text-gray-200'}`}>
                    {message.subject && <span className={message.read ? 'text-gray-300' : 'font-medium'}>{message.subject} — </span>}
                    {message.message.replace(/\s+/g, ' ')}
                  </span>
                  <span className="sr-only">{message.read ? '' : t('msg_unread_dot')}</span>
                </button>
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <nav className="mt-5 flex flex-wrap items-center justify-between gap-3" aria-label="Pagination">
              <Button variant="secondary" onClick={() => goPage(page - 1)} disabled={page <= 1}>{t('sch_prev')}</Button>
              <span className="text-sm text-gray-400">{fill(t('sch_page'), { page, pages })}</span>
              <Button variant="secondary" onClick={() => goPage(page + 1)} disabled={page >= pages}>{t('sch_next')}</Button>
            </nav>
          )}
        </>
      )}

      <Drawer
        open={!!opened} onClose={() => setOpened(null)} busy={busy} title={opened?.name || ''} subtitle={opened?.email || ''}
        footer={opened && <>
          <a href={replyHref(opened)} className={`${small} bg-emerald-400 text-black hover:bg-emerald-300`}><Icon name="arrow" className="h-4 w-4" />{t('msg_reply')}</a>
          {opened.archived
            ? <Button variant="secondary" onClick={() => unarchive([opened.id])} disabled={busy}>{t('msg_unarchive')}</Button>
            : <Button variant="secondary" onClick={() => archive([opened.id])} disabled={busy}>{t('msg_archive')}</Button>}
          <Button variant="secondary" onClick={() => markRead([opened.id], false)} disabled={busy}>{t('msg_mark_unread')}</Button>
          <Button variant="danger" onClick={() => setDeleting([opened.id])} disabled={busy}>{t('msg_delete')}</Button>
        </>}
      >
        {opened && (
          <div>
            <dl className="mb-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <div><dt className="text-xs uppercase tracking-wider text-gray-500">{t('msg_received')}</dt><dd className="mt-1">{when(opened.created_at)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wider text-gray-500">{t('fx_email')}</dt><dd className="mt-1 [overflow-wrap:anywhere]"><a href={`mailto:${opened.email}`} className="hover:text-emerald-300">{opened.email}</a></dd></div>
              {opened.phone && <div><dt className="text-xs uppercase tracking-wider text-gray-500">{t('msg_phone')}</dt><dd className="mt-1"><a href={`tel:${opened.phone.replace(/\s/g, '')}`} className="hover:text-emerald-300">{opened.phone}</a></dd></div>}
              {opened.subject && <div className="sm:col-span-2"><dt className="text-xs uppercase tracking-wider text-gray-500">{t('msg_subject')}</dt><dd className="mt-1 [overflow-wrap:anywhere]">{opened.subject}</dd></div>}
            </dl>
            <p className="whitespace-pre-wrap rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-gray-100 [overflow-wrap:anywhere]">{opened.message}</p>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!deleting} busy={busy} icon="alert"
        title={deleting?.length === 1 ? t('msg_delete_title') : fill(t('msg_delete_title_many'), { n: deleting?.length || 0 })}
        text={deleting?.length === 1 ? t('msg_delete_text') : fill(t('msg_delete_text_many'), { n: deleting?.length || 0 })}
        confirmLabel={deleting?.length > 1 ? fill(t('msg_delete_n'), { n: deleting.length }) : t('msg_delete')} cancelLabel={t('cancel')}
        onConfirm={confirmDelete} onCancel={() => setDeleting(null)}
      />

      {undo && (
        <div role="status" className="fixed bottom-5 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-between gap-4 rounded-xl border border-emerald-400/30 bg-emerald-950/90 px-4 py-3 text-sm text-emerald-100 shadow-xl backdrop-blur">
          <span>{fill(t('msg_archived_ok'), { n: undo.ids.length })}</span>
          <button type="button" onClick={undoArchive} disabled={busy} className="min-h-[44px] rounded-lg px-3 font-semibold text-emerald-300 underline underline-offset-4 hover:bg-white/10 disabled:opacity-50">{t('msg_undo')} ({undo.seconds})</button>
        </div>
      )}
    </div>
  )
}
