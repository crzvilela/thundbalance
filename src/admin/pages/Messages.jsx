import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { adminRequest } from '../api'
import { useAdminText } from '../useAdminText'
import { useToast } from '../toastContext'
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Icon, PageHeader, Skeleton } from '../ui'

// Messages sent through the website's contact form (Contact section).
export default function Messages() {
  const { t, language } = useAdminText()
  const toast = useToast()
  const { messages, messagesResource } = useOutletContext()
  const [filter, setFilter] = useState('all')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const locale = language === 'es' ? 'es-ES' : 'en-GB'

  const unread = useMemo(() => messages.filter(message => !message.read).length, [messages])
  const visible = useMemo(() => (filter === 'unread' ? messages.filter(message => !message.read) : messages), [messages, filter])
  const when = (iso) => (iso ? new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

  const toggleRead = async (message) => {
    try {
      await adminRequest('POST', `/admin/contact-messages/${message.id}/${message.read ? 'unread' : 'read'}`)
      messagesResource.reload()
    } catch (error) {
      toast.push(error.message, 'error')
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await adminRequest('DELETE', `/admin/contact-messages/${deleteTarget.id}`)
      toast.push(t('msg_deleted'))
      setDeleteTarget(null)
      messagesResource.reload()
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const tabs = [['all', t('msg_all'), messages.length], ['unread', t('msg_unread'), unread]]

  return (
    <div className="admin-fade">
      <PageHeader
        title={t('msg_title')} subtitle={t('msg_sub')}
        actions={<Button variant="secondary" onClick={messagesResource.reload}><Icon name="refresh" className="h-4 w-4" />{t('refresh')}</Button>}
      />

      <div className="mb-5 flex flex-wrap gap-2" role="tablist">
        {tabs.map(([key, label, count]) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}
            className={`flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-sm transition ${
              filter === key ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-gray-400 hover:border-white/25 hover:text-white'
            }`}>
            {label}
            <span className={`rounded-full px-1.5 text-xs tabular-nums ${filter === key ? 'bg-emerald-400/20' : 'bg-white/10'}`}>{count}</span>
          </button>
        ))}
      </div>

      {messagesResource.error ? (
        <Card><ErrorState message={`${t('load_error')} (${messagesResource.error})`} retryLabel={t('retry')} onRetry={messagesResource.reload} /></Card>
      ) : messagesResource.loading && !messagesResource.data ? (
        <div className="space-y-3"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      ) : visible.length === 0 ? (
        <Card><EmptyState icon="inbox" title={filter === 'unread' ? t('msg_empty_unread') : t('msg_empty')} /></Card>
      ) : (
        <ul className="space-y-3">
          {visible.map(message => (
            <li key={message.id}>
              <Card className={`p-5 ${message.read ? '' : 'border-emerald-400/30'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold">{message.name}</p>
                      {!message.read && <Badge tone="emerald">{t('msg_new')}</Badge>}
                    </div>
                    <a href={`mailto:${message.email}`} className="inline-flex min-h-[44px] items-center text-sm text-gray-400 [overflow-wrap:anywhere] hover:text-emerald-300">{message.email}</a>
                  </div>
                  <p className="text-xs text-gray-500">{when(message.created_at)}</p>
                </div>

                <p className="mt-3 whitespace-pre-wrap text-gray-200 [overflow-wrap:anywhere]">{message.message}</p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={`mailto:${message.email}?subject=${encodeURIComponent(t('msg_reply_subject'))}`}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-400 px-4 text-sm font-medium text-black transition hover:bg-emerald-300"
                  >
                    <Icon name="arrow" className="h-4 w-4" />{t('msg_reply')}
                  </a>
                  <Button variant="secondary" onClick={() => toggleRead(message)}>{message.read ? t('msg_mark_unread') : t('msg_mark_read')}</Button>
                  <Button variant="danger" onClick={() => setDeleteTarget(message)}>{t('msg_delete')}</Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!deleteTarget} busy={busy}
        title={t('msg_delete_title')} text={t('msg_delete_text')}
        confirmLabel={t('msg_delete')} cancelLabel={t('cancel')}
        onConfirm={remove} onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
