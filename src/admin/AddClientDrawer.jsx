import { useRef, useState } from 'react'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useToast } from './toastContext'
import { Button, ConfirmDialog, Drawer, Field, SelectInput, TextInput } from './ui'
import PackFields from './PackFields'
import { packIsComplete, packPayload, startIsInThePast, usePackForm, usePackPreview } from './packForm'
import { reportCalendarResult } from './calendarSync'
import { DEFAULT_TAX_ID_TYPE, TAX_ID_TYPES, normalizeTaxId, taxIdProblem } from '../utils/taxId'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const EMPTY = {
  name: '', email: '', countryCode: '+34', phone: '', city: '', address: '', postal: '',
  taxType: DEFAULT_TAX_ID_TYPE, taxId: '', country: 'España'
}

// "Añadir cliente": creates the client with a login account and a generated
// temporary password (emailed to the client, never shown here), and optionally
// a first pack. If the welcome email fails the client still exists and this
// window offers "Reenviar credenciales".
export default function AddClientDrawer({ plans, trainers, onClose, onCreated }) {
  const { t } = useAdminText()
  const toast = useToast()
  const [profile, setProfile] = useState(EMPTY)
  const [withPack, setWithPack] = useState(false)
  const [pack, setPack] = usePackForm(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null)   // { id, email } once the client exists but the email failed
  const [resending, setResending] = useState(false)
  const submitting = useRef(false)               // blocks a double click before React re-renders
  const [askPast, setAskPast] = useState(false)
  const [askConflicts, setAskConflicts] = useState(false)
  const [serverConflicts, setServerConflicts] = useState(null)
  const preview = usePackPreview(null, pack, withPack)        // a new client has no sessions of their own yet
  const conflicts = serverConflicts || preview.data?.conflicts || []
  const updatePack = (patch) => { setServerConflicts(null); setAskConflicts(false); setPack(patch) }

  const set = (field) => (event) => setProfile(current => ({ ...current, [field]: event.target.value }))

  // 1) checks, 2) a date in the past asks first, 3) collisions are listed first, 4) then it is created
  const submit = (confirmedPast = false) => {
    if (submitting.current) return
    if (!profile.name.trim()) { setError(t('cc_err_name')); return }
    if (!EMAIL.test(profile.email.trim())) { setError(t('cc_err_email')); return }
    const documentProblem = taxIdProblem(profile.taxType, profile.taxId)
    if (documentProblem) { setError(t(`tx_${documentProblem}`)); return }
    if (withPack && !packIsComplete(pack)) { setError(t('pk_fill')); return }
    if (withPack && startIsInThePast(pack) && !confirmedPast) { setAskPast(true); return }
    if (withPack && conflicts.length > 0) { setAskConflicts(true); return }
    send(false)
  }

  const send = async (allowConflicts) => {
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const result = await adminRequest('POST', '/admin/clients', {
        name: profile.name.trim(),
        email: profile.email.trim(),
        phone: profile.phone.trim() || null,
        country_code: profile.phone.trim() ? profile.countryCode.trim() || null : null,
        city: profile.city.trim() || null,
        address: profile.address.trim() || null,
        postal_code: profile.postal.trim() || null,
        tax_id_type: normalizeTaxId(profile.taxId) ? profile.taxType : null,
        tax_id: normalizeTaxId(profile.taxId) || null,
        country: profile.country.trim() || null,
        ...(withPack ? { pack: { ...packPayload(pack), allow_conflicts: allowConflicts } } : {})
      })
      onCreated(result)
      reportCalendarResult(toast, t, result.pack && { failed: result.pack.calendar_failed })
      if (result.email?.sent) {
        toast.push(`${t('cc_created')} ${t('cc_email_ok')} ${profile.email.trim().toLowerCase()}`)
        onClose()
      } else {
        toast.push(t('cc_created'))
        setCreated(result)
      }
    } catch (err) {
      if (err.code === 'conflicts') {            // the server found collisions the preview had not shown
        setServerConflicts(err.conflicts)
        setAskConflicts(true)
      } else {
        setError(err.message)
      }
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  const resend = async () => {
    setResending(true)
    try {
      const result = await adminRequest('POST', `/admin/clients/${created.id}/resend-credentials`)
      if (result.email?.sent) {
        toast.push(`${t('cc_resent')} ${profile.email.trim().toLowerCase()}`)
        onClose()
      } else {
        toast.push(t('cc_email_failed'), 'warning')
      }
    } catch (err) {
      toast.push(err.message, 'error')
    } finally {
      setResending(false)
    }
  }

  if (created) {
    return (
      <Drawer open onClose={onClose} title={t('cc_title')} subtitle={profile.name}
        footer={<Button variant="secondary" className="flex-1" onClick={onClose}>{t('cc_close')}</Button>}>
        <div role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-5 text-amber-100">
          <p className="mb-4 text-base">{t('cc_email_failed')}</p>
          <Button variant="primary" onClick={resend} loading={resending}>{resending ? t('cc_resending') : t('cc_resend')}</Button>
        </div>
      </Drawer>
    )
  }

  return (
    <Drawer
      open onClose={onClose} busy={busy}
      title={t('cc_title')} subtitle={t('cc_sub')}
      footer={<>
        <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button variant="primary" className="flex-[2]" onClick={() => submit()} loading={busy}>{busy ? t('cc_creating') : t('cc_create')}</Button>
      </>}
    >
      <div className="grid gap-x-8 md:grid-cols-2">
        <Field label={`${t('cc_name')} *`}>
          <TextInput value={profile.name} onChange={set('name')} disabled={busy} autoComplete="off" maxLength={120} />
        </Field>
        <Field label={`${t('cc_email')} *`}>
          <TextInput type="email" value={profile.email} onChange={set('email')} disabled={busy} autoComplete="off" />
        </Field>
        <Field label={t('cc_phone')}>
          <div className="flex gap-3">
            <TextInput value={profile.countryCode} onChange={set('countryCode')} disabled={busy} aria-label={t('cc_code')} className="!w-24 shrink-0" maxLength={6} />
            <TextInput type="tel" value={profile.phone} onChange={set('phone')} disabled={busy} autoComplete="off" />
          </div>
        </Field>
        <Field label={t('cc_city')}>
          <TextInput value={profile.city} onChange={set('city')} disabled={busy} maxLength={80} />
        </Field>
        <Field label={t('cc_address')}>
          <TextInput value={profile.address} onChange={set('address')} disabled={busy} maxLength={200} />
        </Field>
        <Field label={t('cc_postal')}>
          <TextInput value={profile.postal} onChange={set('postal')} disabled={busy} maxLength={20} />
        </Field>
        <Field label={t('cc_country')}>
          <TextInput value={profile.country} onChange={set('country')} disabled={busy} maxLength={60} />
        </Field>
      </div>

      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">{t('bl_optional')}</h3>
        <div className="grid gap-x-8 md:grid-cols-2">
          <Field label={t('cc_doc_type')}>
            <SelectInput value={profile.taxType} onChange={set('taxType')} disabled={busy}>
              {TAX_ID_TYPES.map(type => <option key={type} value={type}>{t(`bl_type_${type}`)}</option>)}
            </SelectInput>
          </Field>
          <Field label={t('cc_doc')}>
            <TextInput value={profile.taxId} onChange={set('taxId')} disabled={busy} autoComplete="off" maxLength={30} placeholder="12345678Z" />
          </Field>
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <label className="flex cursor-pointer items-center gap-3 text-base font-medium">
          <input type="checkbox" checked={withPack} onChange={event => setWithPack(event.target.checked)} disabled={busy} className="h-4 w-4 accent-emerald-400" />
          {t('cc_pack_toggle')}
        </label>
        <p className="mt-2 text-sm text-gray-500">{t('cc_pack_hint')}</p>
        {withPack && (
          <div className="mt-6 border-t border-white/10 pt-6">
            <PackFields form={pack} set={updatePack} plans={plans} trainers={trainers} busy={busy} preview={preview} serverConflicts={serverConflicts} />
          </div>
        )}
      </section>

      {askConflicts && withPack && conflicts.length > 0 && (
        <div role="alert" className="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-100">
          <p className="mb-3 text-sm">{t('cf_question')}</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setAskConflicts(false)} disabled={busy}>{t('cf_change')}</Button>
            <Button variant="primary" onClick={() => { setAskConflicts(false); send(true) }} loading={busy}>{t('cf_create_anyway')}</Button>
          </div>
        </div>
      )}
      {busy && withPack && <p className="mt-4 text-sm text-amber-300">{t('approving_hint')}</p>}
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
      <ConfirmDialog
        open={askPast} tone="neutral" icon="calendar"
        title={t('pk_past_title')} text={t('pk_past_text')}
        confirmLabel={t('pk_past_ok')} cancelLabel={t('cancel')}
        onConfirm={() => { setAskPast(false); submit(true) }} onCancel={() => setAskPast(false)}
      />
    </Drawer>
  )
}
