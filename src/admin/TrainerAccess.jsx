import { useState } from 'react'
import { Link } from 'react-router-dom'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useAdminResource } from './useAdminResource'
import { useToast } from './toastContext'
import { REASON_KEY, TRAINER_PANEL_ROUTE_READY, grantedDate, reasonKey, trainerPanelPath } from './trainerAccessHelpers'
import { emailProblem, normalizeEmail } from '../utils/validators'
import { formText } from '../i18n/formText'
import SectionCard from '../components/admin/SectionCard'
import { Badge, Button, ConfirmDialog, Drawer, ErrorState, Field, Icon, Skeleton, TextInput } from './ui'

const fill = (text, values) => Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), text)

// "Definir acceso": the email, "Verificar" (the server tells whether it can be used), and only then the
// confirmation step. Nothing is saved before the admin confirms.
function SetAccessDrawer({ trainer, onClose, onGranted }) {
  const { t, language } = useAdminText()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [formatError, setFormatError] = useState('')
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState(null)            // the answer of /check for the email that was verified
  const [problem, setProblem] = useState('')            // a text for a failed check or grant
  const [confirming, setConfirming] = useState(false)
  const [granting, setGranting] = useState(false)

  const change = (value) => { setEmail(value); setResult(null); setProblem(''); setFormatError('') }

  const verify = async () => {
    const code = emailProblem(email)
    if (code) { setFormatError(formText(language, code)); return }
    setChecking(true)
    setProblem('')
    setResult(null)
    try {
      const data = await adminRequest('POST', '/admin/trainer-access/check', { trainer_id: trainer.trainer_id, email: normalizeEmail(email) })
      setResult(data)
    } catch (error) {
      setProblem(error.code === 'firebase_unavailable' ? t('ta_r_firebase') : error.message)
    } finally {
      setChecking(false)
    }
  }

  const grant = async () => {
    setGranting(true)
    try {
      await adminRequest('POST', '/admin/trainer-access', { trainer_id: trainer.trainer_id, email: normalizeEmail(email), confirm: true })
      toast.push(t('ta_granted_ok'))
      onGranted()
    } catch (error) {
      setConfirming(false)
      if (error.code && REASON_KEY[error.code]) setResult({ can_grant: false, reason: error.code })   // the server checked again and said no
      else setProblem(error.message)
    } finally {
      setGranting(false)
    }
  }

  const clean = normalizeEmail(email)
  return (
    <>
      <Drawer open onClose={onClose} busy={checking || granting} title={t('ta_set_title')} subtitle={trainer.name}
        footer={<>
          <Button variant="secondary" onClick={onClose} disabled={checking || granting}>{t('cancel')}</Button>
          {result?.can_grant && <Button variant="primary" onClick={() => setConfirming(true)}>{t('ta_continue')}</Button>}
        </>}>
        <p className="mb-6 text-base text-gray-300">{t('ta_set_help')}</p>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1 basis-72">
            <Field label={t('ta_email')}>
              <TextInput type="email" inputMode="email" autoComplete="off" autoFocus value={email} placeholder="nombre@email.com"
                onChange={event => change(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); verify() } }}
                aria-invalid={!!formatError} aria-describedby={formatError ? 'ta-email-error' : undefined} disabled={checking || granting} />
            </Field>
            {formatError && <p id="ta-email-error" role="alert" className="-mt-3 mb-3 flex items-start gap-1.5 text-sm text-red-300"><Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />{formatError}</p>}
          </div>
          <Button variant="secondary" className="mt-7" onClick={verify} loading={checking} disabled={!email.trim()}>{checking ? t('ta_checking') : t('ta_verify')}</Button>
        </div>

        {result && !result.can_grant && (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" /><span>{t(reasonKey(result.reason))}</span>
          </p>
        )}
        {result?.can_grant && (
          <div role="status" className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/[0.07] p-4 text-sm text-emerald-100">
            <p className="mb-2 flex items-center gap-2 font-semibold"><Icon name="check" className="h-4 w-4" />{t('ta_ok_title')}</p>
            <ul className="space-y-1 text-emerald-100/90">
              <li>{t('ta_ok_account')}</li>
              <li>{t('ta_ok_verified')}</li>
              <li>{fill(t('ta_ok_summary'), { email: clean, name: trainer.name })}</li>
            </ul>
          </div>
        )}
        {problem && <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{problem}</p>}
      </Drawer>

      <ConfirmDialog
        open={confirming} busy={granting} tone="neutral" icon="check"
        title={t('ta_confirm_title')} text={fill(t('ta_confirm_text'), { email: clean, name: trainer.name })}
        confirmLabel={t('ta_confirm_yes')} cancelLabel={t('cancel')}
        onConfirm={grant} onCancel={() => setConfirming(false)}
      />
    </>
  )
}

function PanelButton({ trainer }) {
  const { t } = useAdminText()
  if (TRAINER_PANEL_ROUTE_READY) {
    return (
      <Link to={trainerPanelPath(trainer.trainer_id)}
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-gray-100 transition hover:border-white/30 hover:bg-white/10">
        <Icon name="overview" className="h-4 w-4" />{t('ta_panel')}
      </Link>
    )
  }
  return (
    <span title={t('ta_soon')}>
      <Button variant="secondary" disabled aria-disabled="true" aria-label={`${t('ta_panel')} (${t('ta_soon')})`}><Icon name="overview" className="h-4 w-4" />{t('ta_panel')}</Button>
    </span>
  )
}

// Admin > Entrenadores > "Acceso al área de entrenadores": who can see the trainer area, one email per trainer.
export default function TrainerAccess() {
  const { t, language } = useAdminText()
  const toast = useToast()
  const list = useAdminResource('/admin/trainer-access')
  const [setting, setSetting] = useState(null)         // the trainer whose access is being set
  const [removing, setRemoving] = useState(null)       // the trainer whose access is being withdrawn
  const [busy, setBusy] = useState(false)
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const trainers = Array.isArray(list.data) ? list.data : []

  const remove = async () => {
    setBusy(true)
    try {
      await adminRequest('DELETE', `/admin/trainer-access/${removing.trainer_id}`)
      toast.push(t('ta_removed_ok'))
      setRemoving(null)
      list.reload()
    } catch (error) {
      toast.push(error.message, 'error')
      setRemoving(null)
      list.reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard title={t('ta_title')} className="mb-6">
      <p className="mb-5 text-sm text-gray-400">{t('ta_help')}</p>
      {list.error ? (
        <ErrorState message={`${t('load_error')} (${list.error})`} retryLabel={t('retry')} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : (
        <ul className="divide-y divide-white/[0.07] overflow-hidden rounded-2xl border border-white/[0.08]">
          {trainers.map(trainer => {
            const active = trainer.access_status === 'active'
            return (
              <li key={trainer.trainer_id} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5 sm:px-5">
                <span className="flex min-w-0 basis-44 items-center gap-3">
                  <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border border-white/20" style={{ background: trainer.color || 'transparent' }} />
                  <span className="truncate text-base font-semibold text-white">{trainer.name}</span>
                </span>
                <span className="basis-32"><Badge tone={active ? 'emerald' : 'neutral'}>{active ? t('ta_active') : t('ta_none')}</Badge></span>
                <span className="min-w-0 flex-1 basis-52 text-sm text-gray-400">
                  {active ? (
                    <>
                      <span className="block truncate text-gray-200">{trainer.email}</span>
                      <span className="block text-xs">{t('ta_since')} {grantedDate(trainer.granted_at, locale)}</span>
                    </>
                  ) : '—'}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {active ? (
                    <>
                      <PanelButton trainer={trainer} />
                      <Button variant="danger" onClick={() => setRemoving(trainer)}>{t('ta_remove')}</Button>
                    </>
                  ) : (
                    <Button variant="secondary" onClick={() => setSetting(trainer)}>{t('ta_set')}</Button>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {setting && (
        <SetAccessDrawer trainer={setting} onClose={() => setSetting(null)} onGranted={() => { setSetting(null); list.reload() }} />
      )}
      <ConfirmDialog
        open={!!removing} busy={busy}
        title={t('ta_remove_title')} text={removing ? `${removing.name} (${removing.email}). ${t('ta_remove_text')}` : ''}
        confirmLabel={t('ta_remove_yes')} cancelLabel={t('cancel')}
        onConfirm={remove} onCancel={() => setRemoving(null)}
      />
    </SectionCard>
  )
}
