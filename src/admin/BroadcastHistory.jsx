import { useEffect, useMemo, useRef, useState } from 'react'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useAdminResource } from './useAdminResource'
import { useToast } from './toastContext'
import { wallClock } from './calendar/calendarConfig'
import { AUDIENCE_KEY, STATUS_TONE, filterHistory } from './broadcast'
import { Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Icon, SelectInput, Skeleton, TextInput } from './ui'

const PAGE_SIZE = 20
const SERVER_SIZE = 100          // the most the server gives at once; the search and the filter work on these
const fill = (text, values) => Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), text)
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'

function StatusBadge({ status }) {
  const { t } = useAdminText()
  const icon = status === 'scheduled' ? 'clock' : status === 'sent' ? 'check' : 'archive'      // icon + text, never only colour
  return <Badge tone={STATUS_TONE[status] || 'neutral'}><Icon name={icon} className="h-3.5 w-3.5" />{t(`bx_st_${status}`)}</Badge>
}

function Info({ label, children }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className="mt-1 break-words text-base text-white">{children}</dd>
    </div>
  )
}

// One message in full: every language it was written in, the button, the dates and the numbers. Who read it is
// listed ONLY for a message to one person; for the others there are totals.
function Detail({ id, onClose, onDelete, busy }) {
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
        {data && <Button variant="danger" className="flex-1" onClick={() => onDelete(id)} disabled={busy}>{t('bx_delete')}</Button>}
      </>}
    >
      {detail.error ? (
        <ErrorState message={`${t('load_error')} (${detail.error})`} retryLabel={t('retry')} onRetry={detail.reload} />
      ) : !data ? (
        <div className="space-y-3" role="status"><Skeleton className="h-8" /><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
      ) : (
        <>
          <dl className="mb-8 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <Info label={t('bx_h_to')}>{t(AUDIENCE_KEY[data.audience])}{data.audience === 'user' && data.people?.[0] ? ` · ${data.people[0].email}` : ''}</Info>
            <Info label={t('bx_h_status')}><StatusBadge status={data.status} /></Info>
            <Info label={t('bx_h_sends')}>{when(data.visible_from)}</Info>
            <Info label={t('bx_h_expires')}>{data.expires_at ? when(data.expires_at) : t('bx_h_no_expiry')}</Info>
            <Info label={t('bx_d_recipients')}>{data.recipients}</Info>
            <Info label={t('bx_d_reads')}>{fill(t(data.recipients === 1 ? 'bx_h_read_one' : 'bx_h_read'), { read: data.read, total: data.recipients })}</Info>
          </dl>

          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-400">{t('bx_d_content')}</h3>
          <div className="mb-8 space-y-4">
            {languages.map(code => {
              const own = code === data.main_lang ? { title: data.title, body: data.body } : { title: data.translations[code].title || data.title, body: data.translations[code].body || data.body }
              return (
                <section key={code} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">{code.toUpperCase()}{code === data.main_lang ? ` · ${t('bx_d_main')}` : ''}</p>
                  <p className="text-lg font-semibold text-white [overflow-wrap:anywhere]">{own.title}</p>
                  <p className="mt-2 whitespace-pre-wrap text-gray-200 [overflow-wrap:anywhere]">{own.body}</p>
                </section>
              )
            })}
          </div>

          {data.action_label && (
            <div className="mb-8">
              <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-400">{t('bx_d_button')}</h3>
              <p className="text-base text-white">{data.action_label} <span className="text-gray-400 [overflow-wrap:anywhere]">→ {data.action_target}</span></p>
            </div>
          )}

          <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-400">{t('bx_d_readers')}</h3>
          {data.audience === 'user' && data.people?.length ? (
            <ul className="space-y-2">
              {data.people.map(person => (
                <li key={person.email} className="flex flex-wrap items-center gap-3 text-base">
                  <span className="[overflow-wrap:anywhere]">{person.email}</span>
                  <Badge tone={person.read ? 'emerald' : 'neutral'}><Icon name={person.read ? 'check' : 'clock'} className="h-3.5 w-3.5" />{t(person.read ? 'bx_d_read_yes' : 'bx_d_read_no')}</Badge>
                  {person.deleted_by_client && <span className="text-sm text-gray-400">{t('bx_d_removed')}</span>}
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

// The history: newest first, searched by title, filtered by state, one row each. A click opens the detail.
export default function BroadcastHistory({ highlight }) {
  const { t, language } = useAdminText()
  const toast = useToast()
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const resource = useAdminResource(`/admin/messages?page=1&size=${SERVER_SIZE}`)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [busy, setBusy] = useState(false)
  const scrolled = useRef(false)

  const items = useMemo(() => resource.data?.items || [], [resource.data])
  const visible = useMemo(() => filterHistory(items, { q, status }), [items, q, status])
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const rows = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const filtered = !!(q.trim() || status !== 'all')

  useEffect(() => {
    if (!highlight || scrolled.current || !items.some(item => item.id === highlight)) return
    scrolled.current = true
    document.getElementById(`sent-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlight, items])

  const when = (iso) => (iso ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(wallClock(iso)) : '')

  const remove = async () => {
    setBusy(true)
    try {
      await adminRequest('DELETE', `/admin/messages/${deleting}`)
      toast.push(t('bx_deleted'))
      setDeleting(null); setOpenId(null)
      resource.reload()
    } catch (error) {
      toast.push(error.message || t('action_error'), 'error')
      setDeleting(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-80">
          <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <TextInput type="search" value={q} onChange={event => { setQ(event.target.value); setPage(1) }} placeholder={t('bx_h_search')} aria-label={t('bx_h_search')} className="!pl-10" />
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
      ) : visible.length === 0 ? (
        <Card><EmptyState icon="send" title={t(filtered ? 'bx_h_empty_filtered' : 'bx_h_empty')} /></Card>
      ) : (
        <>
          <ul className="space-y-3">
            {rows.map(item => (
              <li key={item.id} id={`sent-${item.id}`}>
                <button type="button" onClick={() => setOpenId(item.id)} aria-label={fill(t('bx_h_open'), { title: item.title })}
                  className={`block w-full rounded-2xl border bg-white/[0.03] p-5 text-left transition hover:border-white/25 hover:bg-white/[0.05] ${FOCUS} ${item.id === highlight ? 'border-emerald-400/60 ring-2 ring-emerald-400/30' : 'border-white/[0.08]'}`}>
                  <span className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <span className="min-w-0 flex-1 basis-60 text-base font-semibold text-white [overflow-wrap:anywhere]">{item.title}</span>
                    <StatusBadge status={item.status} />
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-gray-400">
                    <span>{t(AUDIENCE_KEY[item.audience])}</span>
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
              <span className="text-sm text-gray-400">{fill(t('sch_page'), { page, pages })}</span>
              <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('sch_next')}</Button>
            </nav>
          )}
          {(resource.data?.total || 0) > items.length && (
            <p className="mt-4 text-center text-sm text-gray-500">{fill(t('bx_h_latest'), { shown: items.length, total: resource.data.total })}</p>
          )}
        </>
      )}

      {openId && <Detail key={openId} id={openId} busy={busy} onClose={() => setOpenId(null)} onDelete={setDeleting} />}

      <ConfirmDialog
        open={!!deleting} busy={busy} icon="alert"
        title={t('bx_delete_title')} text={t('bx_delete_text')}
        confirmLabel={t('bx_delete')} cancelLabel={t('cancel')}
        onConfirm={remove} onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
