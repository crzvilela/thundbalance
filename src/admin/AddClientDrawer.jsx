import { useRef, useState } from 'react'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useToast } from './toastContext'
import { Button, ConfirmDialog, Drawer } from './ui'
import PackFields from './PackFields'
import { packIsComplete, packPayload, startIsInThePast, usePackForm, usePackPreview } from './packForm'
import { reportCalendarResult } from './calendarSync'
import { DEFAULT_TAX_ID_TYPE, normalizeTaxId } from '../utils/taxId'
import FormField from '../components/forms/FormField'
import { INPUT_CLASS, inputBorder } from '../components/forms/inputStyles'
import PhoneInput from '../components/forms/PhoneInput'
import EmailInput from '../components/forms/EmailInput'
import PostalCodeInput from '../components/forms/PostalCodeInput'
import TaxIdInput from '../components/forms/TaxIdInput'
import { focusFirstInvalid } from '../components/forms/focusFirstInvalid'
import { formText, serverFieldError } from '../i18n/formText'
import {
  callingCodeOf, countryIsoOf, documentProblem, emailProblem, nameProblem, normalizeEmail, phoneProblem, postalCodeProblem, regionOfPhone
} from '../utils/validators'

const SERVER_FIELDS = { name: 'name', email: 'email', phone: 'phone', postal_code: 'postal', tax_id: 'taxId' }
const EMPTY = {
  name: '', email: '', phone: '', city: '', address: '', postal: '',
  taxType: DEFAULT_TAX_ID_TYPE, taxId: '', country: 'España'
}

// "Añadir cliente": creates the client with a login account and a generated
// temporary password (emailed to the client, never shown here), and optionally
// a first pack. If the welcome email fails the client still exists and this
// window offers "Reenviar credenciales".
export default function AddClientDrawer({ plans, trainers, onClose, onCreated }) {
  const { t, language } = useAdminText()
  const [fieldErrors, setFieldErrors] = useState({})
  const formRef = useRef(null)
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

  const setValue = (field, value) => {
    setProfile(current => ({ ...current, [field]: value }))
    if (fieldErrors[field]) setFieldErrors(current => ({ ...current, [field]: undefined }))
  }
  const set = (field) => (event) => setValue(field, event.target.value)
  const postalCountry = regionOfPhone(profile.phone) || countryIsoOf(profile.country)

  // 1) checks, 2) a date in the past asks first, 3) collisions are listed first, 4) then it is created
  const submit = (confirmedPast = false) => {
    if (submitting.current) return
    const codes = {
      name: nameProblem(profile.name),
      email: emailProblem(profile.email),
      phone: phoneProblem(profile.phone, { required: false }),
      postal: postalCodeProblem(profile.postal, postalCountry, { required: false }),
      taxId: documentProblem(profile.taxType, profile.taxId),
    }
    const found = Object.fromEntries(Object.entries(codes).filter(([, code]) => code).map(([key, code]) => [key, formText(language, code)]))
    setFieldErrors(found)
    if (Object.keys(found).length) { setError(''); focusFirstInvalid(formRef.current); return }
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
        email: normalizeEmail(profile.email),
        phone: profile.phone || null,                         // E.164
        country_code: profile.phone ? callingCodeOf(profile.phone) : null,
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
      const fieldError = err.field ? serverFieldError(err.detail, language) : null
      if (err.code === 'conflicts') {            // the server found collisions the preview had not shown
        setServerConflicts(err.conflicts)
        setAskConflicts(true)
      } else if (fieldError && SERVER_FIELDS[fieldError.field]) {
        setFieldErrors({ [SERVER_FIELDS[fieldError.field]]: fieldError.message })
        focusFirstInvalid(formRef.current)
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
      <div ref={formRef}>
      <div className="grid gap-x-8 md:grid-cols-2">
        <FormField label={t('cc_name')} required error={fieldErrors.name}>
          {({ id, describedBy, invalid }) => <input id={id} value={profile.name} onChange={set('name')} disabled={busy} autoComplete="off" maxLength={120}
            onBlur={() => { const code = nameProblem(profile.name); setFieldErrors(current => ({ ...current, name: code ? formText(language, code) : undefined })) }}
            aria-invalid={invalid || undefined} aria-required="true" aria-describedby={describedBy} className={`${INPUT_CLASS} ${inputBorder(invalid)}`} />}
        </FormField>
        <EmailInput label={t('cc_email')} required language={language} value={profile.email} error={fieldErrors.email}
          disabled={busy} autoComplete="off" onChange={value => setValue('email', value)} />
        <div className="md:col-span-2">
          <PhoneInput label={t('cc_phone')} language={language} value={profile.phone} error={fieldErrors.phone}
            disabled={busy} onChange={value => setValue('phone', value)} />
        </div>
        {[['city', 'cc_city', 80], ['address', 'cc_address', 200]].map(([key, label, max]) => (
          <FormField key={key} label={t(label)}>
            {({ id, describedBy }) => <input id={id} value={profile[key]} onChange={set(key)} disabled={busy} maxLength={max}
              aria-describedby={describedBy} className={`${INPUT_CLASS} ${inputBorder(false)}`} />}
          </FormField>
        ))}
        <PostalCodeInput label={t('cc_postal')} language={language} country={postalCountry} value={profile.postal}
          error={fieldErrors.postal} disabled={busy} onChange={value => setValue('postal', value)} />
        <FormField label={t('cc_country')}>
          {({ id, describedBy }) => <input id={id} value={profile.country} onChange={set('country')} disabled={busy} maxLength={60}
            aria-describedby={describedBy} className={`${INPUT_CLASS} ${inputBorder(false)}`} />}
        </FormField>
      </div>

      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-gray-400">{t('bl_optional')}</h3>
        <TaxIdInput label={t('cc_doc')} language={language} type={profile.taxType} value={profile.taxId} error={fieldErrors.taxId}
          disabled={busy} onChange={value => setValue('taxId', value)} onTypeChange={type => setValue('taxType', type)} />
      </section>
      </div>

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
