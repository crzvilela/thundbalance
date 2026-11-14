import { useState } from 'react'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useAdminResource } from './useAdminResource'
import { useToast } from './toastContext'
import { Button, Card, ConfirmDialog, TextInput } from './ui'

// "Solicitudes de eliminación": the accounts that clients asked to delete. A request deletes nothing by itself: the admin approves
// (the complete deletion of the client runs) or rejects it with a short reason. Both ask first. It shows nothing when none is pending.
export default function DeletionRequests() {
  const { t, language } = useAdminText()
  const toast = useToast()
  const resource = useAdminResource('/admin/deletion-requests')
  const items = (resource.data?.items || []).filter(item => item.status === 'pending')
  const [approving, setApproving] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  if (items.length === 0) return null

  const day = (value) => (value ? new Date(value).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-GB') : '')

  const approve = async () => {
    setBusy(true)
    try {
      await adminRequest('POST', `/admin/deletion-requests/${approving.id}/approve`, { confirm: true })
      toast.push(t('dr_approved'))
      setApproving(null)
      resource.reload()
    } catch (error) {
      toast.push(error.message, 'error')
      setApproving(null)
      resource.reload()
    } finally {
      setBusy(false)
    }
  }

  const reject = async () => {
    if (!reason.trim()) return
    setBusy(true)
    try {
      await adminRequest('POST', `/admin/deletion-requests/${rejecting.id}/reject`, { reason: reason.trim() })
      toast.push(t('dr_rejected'))
      setRejecting(null)
      setReason('')
      resource.reload()
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mb-8" aria-labelledby="dr-title">
      <Card className="border-amber-400/30 p-5">
        <h2 id="dr-title" className="text-lg font-semibold text-amber-100">{t('dr_title')} ({items.length})</h2>
        <p className="mt-1 text-sm text-gray-400">{t('dr_intro')}</p>
        <ul className="mt-4 divide-y divide-white/10">
          {items.map(item => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="break-words font-medium">{item.client_name || t('dr_unknown')}</p>
                <p className="text-xs text-gray-500">{t('dr_requested')} {day(item.created_at)}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => { setReason(''); setRejecting(item) }}>{t('dr_reject')}</Button>
                <Button variant="danger" onClick={() => setApproving(item)}>{t('dr_approve')}</Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <ConfirmDialog
        open={!!approving} busy={busy}
        title={t('dr_approve_title')} text={approving ? `${approving.client_name || ''} — ${t('dr_approve_text')}` : ''}
        confirmLabel={t('dr_approve')} cancelLabel={t('cancel')} onConfirm={approve} onCancel={() => setApproving(null)}
      />
      <ConfirmDialog
        open={!!rejecting} busy={busy} tone="neutral"
        title={t('dr_reject_title')} text={rejecting ? `${rejecting.client_name || ''} — ${t('dr_reject_text')}` : ''}
        confirmLabel={t('dr_reject')} cancelLabel={t('cancel')} onConfirm={reject} onCancel={() => setRejecting(null)}
      >
        <TextInput value={reason} onChange={event => setReason(event.target.value)} maxLength={200} placeholder={t('dr_reason')} aria-label={t('dr_reason')} />
        {!reason.trim() && <p className="mt-2 text-xs text-gray-500">{t('dr_reason_required')}</p>}
      </ConfirmDialog>
    </section>
  )
}
