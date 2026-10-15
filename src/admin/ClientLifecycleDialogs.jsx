import { useEffect, useState } from 'react'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useToast } from './toastContext'
import { Button, Icon, TextInput } from './ui'

// Shared shell of the two dialogs: centred on desktop, a bottom sheet on
// phones; it scrolls inside itself so the buttons never leave the screen.
function Shell({ title, icon, tone, busy, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])
  const danger = tone === 'danger'
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-3 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { if (!busy) onClose() }} />
      <div role="alertdialog" aria-modal="true" aria-label={title}
        className="admin-toast relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col rounded-3xl border border-white/10 bg-[#0d1110] shadow-2xl">
        <div className="overflow-y-auto p-5 sm:p-8">
          <span className={`mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border ${danger ? 'border-red-400/25 bg-red-400/10 text-red-300' : 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'}`}>
            <Icon name={icon} />
          </span>
          <h2 className="text-xl font-semibold text-white sm:text-2xl">{title}</h2>
          {children}
        </div>
        <div className="flex flex-col-reverse gap-3 border-t border-white/10 p-4 sm:flex-row sm:p-5">{footer}</div>
      </div>
    </div>
  )
}

function Checkbox({ checked, onChange, disabled, children }) {
  return (
    <label className="mt-5 flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-gray-200">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-400" />
      <span>{children}</span>
    </label>
  )
}

// "Archivar": reversible. The option to cancel future sessions is UNCHECKED by
// default; checking it shows how many and asks a second time.
export function ArchiveDialog({ client, futureSessions, onClose, onDone }) {
  const { t } = useAdminText()
  const toast = useToast()
  const [cancelSessions, setCancelSessions] = useState(false)
  const [second, setSecond] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await adminRequest('POST', `/admin/clients/${client.id}/archive`, {
        cancel_future_sessions: cancelSessions,
        confirm_cancel: cancelSessions
      })
      toast.push(t('lc_archived_ok'))
      if (result.calendar?.failed) toast.push(`${result.calendar.failed} ${t('lc_events_failed')}`, 'warning')
      onDone(result)
    } catch (err) {
      setError(err.message || t('action_error'))
      setSecond(false)
    } finally {
      setBusy(false)
    }
  }

  const needsSecond = cancelSessions && futureSessions > 0
  const submit = () => (needsSecond && !second ? setSecond(true) : send())

  return (
    <Shell title={second ? t('lc_cancel_title') : t('lc_archive_title')} icon="archive" tone={second ? 'danger' : 'neutral'} busy={busy} onClose={onClose}
      footer={<>
        <Button variant="secondary" className="min-h-[44px] flex-1" onClick={second ? () => setSecond(false) : onClose} disabled={busy}>
          {second ? t('lc_back') : t('cancel')}
        </Button>
        <Button variant={second ? 'danger' : 'primary'} className="min-h-[44px] flex-1" onClick={submit} loading={busy}>
          {second ? t('lc_cancel_confirm') : t('lc_archive_do')}
        </Button>
      </>}
    >
      {second ? (
        <p className="mt-3 text-base text-gray-300">
          <strong className="text-white">{futureSessions}</strong> {t('lc_cancel_text')}
        </p>
      ) : (
        <>
          <p className="mt-3 text-base text-gray-400">{t('lc_archive_text')}</p>
          <Checkbox checked={cancelSessions} onChange={setCancelSessions} disabled={busy}>
            {t('lc_cancel_option')}
            {cancelSessions && (
              <span className="mt-1 block text-gray-400">
                {futureSessions > 0 ? `${futureSessions} ${t('lc_sessions_to_cancel')}` : t('lc_no_future')}
              </span>
            )}
          </Checkbox>
        </>
      )}
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
    </Shell>
  )
}

// "Eliminar definitivamente": irreversible. The final button needs the box AND
// the full name typed. A partial failure lists what was and was not deleted and
// can simply be repeated.
const STEP_LABELS = { calendar: 'lc_step_calendar', database: 'lc_step_database', firebase: 'lc_step_firebase', profile: 'lc_step_profile' }

export function DeleteDialog({ client, onClose, onDone }) {
  const { t } = useAdminText()
  const toast = useToast()
  const [understood, setUnderstood] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState(null)   // { steps, remaining } after a partial failure

  const normal = (text) => String(text || '').trim().split(/\s+/).join(' ').toLowerCase()
  const ready = understood && normal(name) === normal(client.name) && normal(name) !== ''

  const send = async () => {
    setBusy(true)
    setError('')
    try {
      await adminRequest('POST', `/admin/clients/${client.id}/delete`, { confirm_data: understood, confirm_name: name })
      toast.push(t('lc_deleted_ok'))
      onDone()
    } catch (err) {
      if (err.code === 'delete_incomplete') setReport(err.detail)
      else setError(err.message || t('action_error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title={t('lc_delete_title')} icon="alert" tone="danger" busy={busy} onClose={onClose}
      footer={<>
        <Button variant="secondary" className="min-h-[44px] flex-1" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button variant="danger" className="min-h-[44px] flex-1 !border-red-400 !bg-red-500/20" onClick={send} loading={busy} disabled={!ready}>
          {report ? t('lc_retry') : t('lc_delete_do')}
        </Button>
      </>}
    >
      <p className="mt-3 rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-100">{t('lc_delete_warning')}</p>
      <Checkbox checked={understood} onChange={setUnderstood} disabled={busy}>{t('lc_delete_option')}</Checkbox>
      <label className="mt-5 block text-sm text-gray-300">
        {t('lc_type_name')} <strong className="text-white">{client.name}</strong>
        <TextInput value={name} onChange={event => setName(event.target.value)} disabled={busy} autoComplete="off"
          aria-label={t('lc_type_name')} className="mt-2" />
      </label>

      {report && (
        <div role="alert" className="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
          <p className="mb-2 font-medium">{t('lc_incomplete')}</p>
          <ul className="space-y-1">
            {Object.keys(STEP_LABELS).map(id => {
              const done = report.steps?.some(step => step.id === id && step.ok)
              return (
                <li key={id} className="flex items-center gap-2">
                  <Icon name={done ? 'check' : 'alert'} className={`h-4 w-4 ${done ? 'text-emerald-300' : 'text-amber-300'}`} />
                  <span>{t(STEP_LABELS[id])}: {done ? t('lc_done') : t('lc_pending')}</span>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-amber-200/80">{t('lc_incomplete_hint')}</p>
        </div>
      )}
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
    </Shell>
  )
}
