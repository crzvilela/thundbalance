import { useEffect, useMemo, useRef, useState } from 'react'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useAdminResource } from './useAdminResource'
import { useToast } from './toastContext'
import { wallClock } from './calendar/calendarConfig'
import { AUDIENCE_KEY, STATUS_TONE, audiencesOf } from './broadcast'
import { Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Icon, SelectInput, Skeleton, TextInput } from './ui'

const PAGE_SIZE = 20
const fill = (text, values) => Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), text)
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'

function StatusBadge({ status }) {
  const { t } = useAdminText()
  const icon = status === 'scheduled' ? 'clock' : status === 'sent' ? 'check' : 'archive'      // icon + text, never only colour
  return <Badge tone={STATUS_TONE[status] || 'neutral'}><Icon name={icon} className="h-3.5 w-3.5" />{t(`bx_st_${status}`)}</Badge>
}

// The audiences of a message as small tags ("Todos · Entrenadores").
function AudienceTags({ message }) {
  const { t } = useAdminText()
  return audiencesOf(message).map(audience => (
    <span key={audience} className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-medium text-gray-200">{t(AUDIENCE_KEY[audience] || 'bx_to_all')}</span>
  ))
}

function Info({ label, children }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className="mt-1 break-words text-base text-white">{children}</dd>
    </div>
  )
}

// One message in full: every language it was written in (with the button text of each), the button, the dates and
// the numbers. Who read it is listed ONLY for a message to one person (and when); for the others there are totals.
function Detail({ id, onClose, onArchive, onRestore, busy }) {
  const { t, language } = useAdminText()
  const detail = useAdminResource(`/admin/messages/${id}`)
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const when = (iso) => (iso ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(wallClock(iso)) : '')
  const data = detail.data
  const languages = data ? [data.main_lang, ...['en', 'es', 'ca'].filter(code => code !== data.main_lang && data.translations?.[code])] : []

  return (
    <Drawer
      open onClose={onClose} busy={busy} title={data?.title || '…'} subtitle={data ? t(`bx_st_${data.status}`) : ''}
      footer={<>
        <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>{t('bx_close')}</Button>
        {data && (data.archived
          ? <Button variant="primary" className="flex-1" onClick={() => onRestore(id)} disabled={busy}>{t('bx_restore')}</Button>
          : <Button variant="secondary" className="flex-1" onClick={() => onArchive(id)} disabled={busy}><Icon name="archive" className="h-4 w-4" />{t('bx_archive')}</Button>)}
      </>}
    >
      {detail.error ? (
        <ErrorState message={`${t('load_error')} (${detail.error})`} retryLabel={t('retry')} onRetry={detail.reload} />
      ) : !data ? (
        <div className="space-y-3" role="status"><Skeleton className="h-8" /><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
      ) : (
        <>
          <dl className="mb-8 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <Info label={t('bx_h_to')}><AudienceTags message={data} />{data.audience === 'user' && data.people?.[0] ? <span className="ml-1 text-gray-300">· {data.people[0].email}</span> : null}</Info>
            <Info label={t('bx_h_status')}><StatusBadge status={data.status} /></Info>
            <Info label={t('bx_h_sends')}>{when(data.visible_from)}</Info>
            <Info label={t('bx_h_expires')}>{data.expires_at ? when(data.expires_at) : t('bx_h_no_expiry')}</Info>
            {data.archived && <Info label={t('bx_tab_archived')}>{fill(t('bx_d_archived_on'), { who: data.archived_by || '—', when: when(data.archived_at) })}</Info>}
            <Info label={t('bx_d_recipients')}>{data.recipients}</Info>
            <Info label={t('bx_d_reads')}>{fill(t(data.recipients === 1 ? 'bx_h_read_one' : 'bx_h_read'), { read: data.read, total: data.recipients })}</Info>
          </dl>

          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-400">{t('bx_d_content')}</h3>
          <div className="mb-8 space-y-4">
            {languages.map(code => {
              const mine = code === data.main_lang
              const own = mine ? { title: data.title, body: data.body, label: data.action_label } : {
                title: data.translations[code].title || data.title, body: data.translations[code].body || data.body,
                label: data.translations[code].action_label || data.action_label
              }
              return (
                <section key={code} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">{code.toUpperCase()}{mine ? ` · ${t('bx_d_main')}` : ''}</p>
                  <p className="text-lg font-semibold text-white [overflow-wrap:anywhere]">{own.title}</p>
                  <p className="mt-2 whitespace-pre-wrap text-gray-200 [overflow-wrap:anywhere]">{own.body}</p>
                  {own.label && <p className="mt-3 inline-flex rounded-lg border border-white/20 px-3 py-1.5 text-sm font-semibold text-white">{own.label}</p>}
                </section>
              )
            })}
          </div>

          {data.action_label && (
            <div className="mb-8">
              <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-400">{t('bx_d_button')}</h3>
              <p className="text-base text-gray-300 [overflow-wrap:anywhere]">{t('bx_d_goes_to')} {data.action_target}</p>
            </div>
          )}

          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-400">{t('bx_d_readers')}</h3>
          {data.audience === 'user' && data.people?.length ? (
            <ul className="space-y-2">
              {data.people.map(person => (
                <li key={person.email} className="flex flex-wrap items-center gap-3 text-base">
                  <span className="[overflow-wrap:anywhere]">{person.email}</span>
                  <Badge tone={person.read ? 'emerald' : 'neutral'}><Icon name={person.read ? 'check' : 'clock'} className="h-3.5 w-3.5" />{t(person.read ? 'bx_d_read_yes' : 'bx_d_read_no')}</Badge>
                  {person.read && person.read_at && <span className="text-sm text-gray-400">{fill(t('bx_d_read_at'), { when: when(person.read_at) })}</span>}
                  {person.archived_by_client && <span className="text-sm text-gray-400">{t('bx_d_removed')}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-gray-400">{t('bx_d_counts_only')}</p>}
          {data.created_by && <p className="mt-8 text-sm text-gray-500">{fill(t('bx_d_created'), { who: data.created_by })}</p>}
        </>
      )}
    </Drawer>
  )
}

// The history: newest first, one row each. The search by title, the filter by state and the pages are done by the
// server, so they work on every message, not only on the ones already loaded. A click opens the detail.
export default function BroadcastHistory({ highlight }) {
  const { t, language } = useAdminText()
  const toast = useToast()
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const [search, setSearch] = useState('')          // what is typed
  const [q, setQ] = useState('')                    // what is asked, a moment after the typing stops
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [archivedTab, setArchivedTab] = useState(false)     // false: the history ("Sent"); true: the archive ("Archived")
  const [openId, setOpenId] = useState(null)
  const [archiving, setArchiving] = useState(null)
  const [busy, setBusy] = useState(false)
  const scrolled = useRef(false)

  useEffect(() => {
    if (search.trim() === q) return undefined
    const timer = window.setTimeout(() => { setQ(search.trim()); setPage(1) }, 350)
    return () => window.clearTimeout(timer)
  }, [search, q])

  const path = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) })
    if (q) query.set('q', q)
    if (status !== 'all') query.set('status', status)
    if (archivedTab) query.set('archived', 'true')
    return `/admin/messages?${query}`
  }, [page, q, status, archivedTab])
  const resource = useAdminResource(path)
  const items = useMemo(() => resource.data?.items || [], [resource.data])
  const pages = resource.data?.pages || 1
  const filtered = !!(q || status !== 'all')

  useEffect(() => {
    if (!highlight || scrolled.current || !items.some(item => item.id === highlight)) return
    scrolled.current = true
    document.getElementById(`sent-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlight, items])

  const when = (iso) => (iso ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(wallClock(iso)) : '')

  // Nothing is deleted: the message is archived (it leaves every client's inbox, stays here under "Archived") or restored.
  const change = async (idToChange, path, done) => {
    setBusy(true)
    try {
      await adminRequest('POST', `/admin/messages/${idToChange}/${path}`)
      toast.push(t(done))
      setArchiving(null); setOpenId(null)
      if (items.length <= 1 && page > 1) setPage(page - 1)
      else resource.reload()
    } catch (error) {
      toast.push(error.message || t('action_error'), 'error')
      setArchiving(null)
    } finally {
      setBusy(false)
    }
  }
  const counts = resource.data?.counts

  const tabs = [[false, 'bx_h_tab_sent', counts?.active], [true, 'bx_h_tab_archived', counts?.archived]]

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label={t('bx_h_pages')}>
        {tabs.map(([value, label, count]) => (
          <button key={label} type="button" role="tab" aria-selected={archivedTab === value} onClick={() => { setArchivedTab(value); setPage(1) }}
            className={`flex min-h-[44px] items-center gap-2 rounded-full border px-5 text-sm transition ${FOCUS} ${archivedTab === value ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-gray-400 hover:border-white/25 hover:text-white'}`}>
            {t(label)}
            <span className={`rounded-full px-1.5 text-xs tabular-nums ${archivedTab === value ? 'bg-emerald-400/20' : 'bg-white/10'}`}>{count ?? '–'}</span>
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-80">
          <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <TextInput type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('bx_h_search')} aria-label={t('bx_h_search')} className="!pl-10" />
        </div>
        <label className="flex items-center gap-3 text-sm text-gray-300">
          <span>{t('bx_h_status')}</span>
          <SelectInput value={status} onChange={event => { setStatus(event.target.value); setPage(1) }} className="!w-auto !py-2.5">
            {['all', 'scheduled', 'sent', 'expired'].map(value => <option key={value} value={value}>{t(`bx_st_${value}`)}</option>)}
          </SelectInput>
        </label>
        <Button variant="secondary" className="ml-auto" onClick={resource.reload}><Icon name="refresh" className="h-4 w-4" />{t('refresh')}</Button>
      </div>

      {resource.error ? (
        <Card><ErrorState message={`${t('load_error')} (${resource.error})`} retryLabel={t('retry')} onRetry={resource.reload} /></Card>
      ) : resource.loading && !resource.data ? (
        <div className="space-y-3" role="status" aria-label="…"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
      ) : items.length === 0 ? (
        <Card><EmptyState icon={archivedTab ? 'archive' : 'send'} title={t(filtered ? 'bx_h_empty_filtered' : archivedTab ? 'bx_h_empty_archived' : 'bx_h_empty')} /></Card>
      ) : (
        <>
          <ul className="space-y-3">
            {items.map(item => (
              <li key={item.id} id={`sent-${item.id}`}>
                <button type="button" onClick={() => setOpenId(item.id)} aria-label={fill(t('bx_h_open'), { title: item.title })}
                  className={`block w-full rounded-2xl border bg-white/[0.03] p-5 text-left transition hover:border-white/25 hover:bg-white/[0.05] ${FOCUS} ${item.id === highlight ? 'border-emerald-400/60 ring-2 ring-emerald-400/30' : 'border-white/[0.08]'}`}>
                  <span className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <span className="min-w-0 flex-1 basis-60 text-base font-semibold text-white [overflow-wrap:anywhere]">{item.title}</span>
                    <StatusBadge status={item.status} />
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-gray-400">
                    <span className="flex flex-wrap items-center gap-1.5 [overflow-wrap:anywhere]"><AudienceTags message={item} />{item.person ? <span>· {item.person}</span> : null}</span>
                    <span>{t('bx_h_sends')}: {when(item.visible_from)}</span>
                    <span>{t('bx_h_expires')}: {item.expires_at ? when(item.expires_at) : t('bx_h_no_expiry')}</span>
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-gray-300">
                    <span>{item.recipients} {t('bx_d_recipients').toLowerCase()}</span>
                    <span className="text-emerald-300">{fill(t(item.recipients === 1 ? 'bx_h_read_one' : 'bx_h_read'), { read: item.read, total: item.recipients })}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <nav className="mt-6 flex flex-wrap items-center justify-between gap-3" aria-label={t('bx_h_pages')}>
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('sch_prev')}</Button>
              <span className="text-sm text-gray-400">{fill(t('sch_page'), { page, pages })} · {resource.data.total}</span>
              <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('sch_next')}</Button>
            </nav>
          )}
        </>
      )}

      {openId && <Detail key={openId} id={openId} busy={busy} onClose={() => setOpenId(null)} onArchive={setArchiving} onRestore={(target) => change(target, 'restore', 'bx_restored')} />}

      <ConfirmDialog
        open={!!archiving} busy={busy} tone="neutral" icon="archive"
        title={t('bx_archive_title')} text={t('bx_archive_text')}
        confirmLabel={t('bx_archive')} cancelLabel={t('cancel')}
        onConfirm={() => change(archiving, 'archive', 'bx_archived')} onCancel={() => setArchiving(null)}
      />
    </div>
  )
}
