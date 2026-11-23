import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useToast } from './toastContext'
import { useRoles } from '../roles/rolesContext'
import { Button, Card, ConfirmDialog } from './ui'

// "Ruta de acceso al panel": the full address of the panel today, with Copy and "Generate a new one" (docs/ADMIN_ACCESS.md). Only the administrator sees this
// page, and only the administrator is ever told the address (GET /me/roles). Generating a new one makes the old bookmarks stop working: it asks first.
export default function AccessPath() {
  const { t } = useAdminText()
  const toast = useToast()
  const navigate = useNavigate()
  const roles = useRoles()
  const path = roles.roles?.admin_path || ''
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const full = path ? `${window.location.origin}/${path}` : ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full)
      toast.push(t('ap_copied'))
    } catch {
      toast.push(t('ap_copy_failed'), 'warning')            // the address is on the screen: it can be selected by hand
    }
  }

  const rotate = async () => {
    setBusy(true)
    try {
      const result = await adminRequest('POST', '/admin/settings/admin-path/rotate')
      setConfirming(false)
      // the panel now lives at the new address: go there (the page of settings) and ask for the roles again so the whole site knows it
      navigate(`/${result.admin_path}/system`, { replace: true })
      roles.reload()
      toast.push(t('ap_rotated'))
    } catch (error) {
      toast.push(error.message || t('ap_error'), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!path) return null
  return (
    <section className="mb-6" aria-labelledby="ap-title">
      <Card className="p-5">
        <h2 id="ap-title" className="text-lg font-semibold">{t('ap_title')}</h2>
        <p className="mt-1 text-sm text-gray-400">{t('ap_intro')}</p>
        <p className="mt-4 select-all break-all rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-gray-100" data-testid="access-path">{full}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={copy}>{t('ap_copy')}</Button>
          <Button variant="danger" onClick={() => setConfirming(true)}>{t('ap_rotate')}</Button>
        </div>
      </Card>
      <ConfirmDialog
        open={confirming} title={t('ap_confirm_title')} text={t('ap_confirm_text')} busy={busy}
        confirmLabel={t('ap_confirm_yes')} cancelLabel={t('ap_confirm_no')} onConfirm={rotate} onCancel={() => setConfirming(false)}
      />
    </section>
  )
}
