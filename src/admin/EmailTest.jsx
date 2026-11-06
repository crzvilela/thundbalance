import { useEffect, useState } from 'react'
import { adminRequest } from './api'
import { Icon } from './ui'
import { useToast } from './toastContext'
import { useAdminText } from './useAdminText'

// Sidebar block about the outgoing email: a button that sends a test message and, when the domain sending
// (Gmail API from the studio's own address) is not set up yet, a visible warning (the emails still go out the old way).
export default function EmailTest({ defaultTo = '' }) {
  const { t } = useAdminText()
  const toast = useToast()
  const [fallback, setFallback] = useState(false)
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState(defaultTo)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    adminRequest('GET', '/admin/email/health')
      .then(result => { if (!cancelled) setFallback(!!result.fallback_active) })
      .catch(() => {})                                      // the warning is a hint: a failed check shows nothing
    return () => { cancelled = true }
  }, [])

  const send = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const result = await adminRequest('POST', '/admin/email/test', { to: to.trim() })
      setFallback(!!result.fallback)
      if (!result.sent) toast.push(t('et_failed'), 'error')
      else if (result.fallback) toast.push(t('et_sent_fallback'), 'warning')
      else toast.push(`${t('et_sent')} (${result.provider === 'gmail_api' ? t('et_provider_domain') : t('et_provider_legacy')})`)
      if (result.sent) setOpen(false)
    } catch (error) {
      toast.push(error.message || t('et_failed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {fallback && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span><strong className="font-semibold">{t('et_warning')}</strong> {t('et_warning_hint')}</span>
        </p>
      )}
      {open ? (
        <form onSubmit={send} className="space-y-2">
          <input type="email" required value={to} onChange={event => setTo(event.target.value)} disabled={busy}
            aria-label={t('et_to')} placeholder={t('et_to')}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-emerald-400/60" />
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={busy}
              className="flex-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5">{t('cancel')}</button>
            <button type="submit" disabled={busy || !to.trim()}
              className="flex-[2] rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50">{busy ? t('et_sending') : t('et_send')}</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => { setTo(defaultTo); setOpen(true) }}
          className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2 text-sm text-gray-400 transition hover:bg-white/5 hover:text-white">
          <Icon name="send" className="h-[18px] w-[18px]" />{t('et_button')}
        </button>
      )}
    </div>
  )
}
