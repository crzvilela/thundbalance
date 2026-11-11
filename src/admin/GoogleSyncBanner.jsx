import { useState } from 'react'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useAdminResource } from './useAdminResource'
import { useToast } from './toastContext'
import { Button } from './ui'

// More than a few events deleted in Google at once: the server cancels nothing by itself and asks the admin first
// (GET /admin/google-sync/status, POST /admin/google-sync/confirm). Shows nothing when there is no warning.
export default function GoogleSyncBanner({ onChanged }) {
  const { t } = useAdminText()
  const toast = useToast()
  const status = useAdminResource('/admin/google-sync/status')
  const [busy, setBusy] = useState(false)
  const pending = status.data?.pending
  if (!pending) return null

  const confirm = async () => {
    setBusy(true)
    try {
      const result = await adminRequest('POST', '/admin/google-sync/confirm')
      toast.push(t('gs_confirm_ok').replace('{n}', String(result.cancelled ?? 0)))
      status.reload()
      if (onChanged) onChanged()
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
      <div>
        <p className="font-semibold">{t('gs_banner').replace('{n}', String(pending.count))}</p>
        <p className="mt-1 text-amber-100/80">{t('gs_banner_hint')}</p>
      </div>
      <Button variant="danger" onClick={confirm} loading={busy}>{t('gs_confirm')}</Button>
    </div>
  )
}
