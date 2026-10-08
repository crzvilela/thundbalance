import { useRef, useState } from 'react'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useToast } from './toastContext'
import { Button, Drawer, Field, TextInput } from './ui'
import PackFields from './PackFields'
import { packIsComplete, packPayload, usePackForm } from './packForm'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const EMPTY = { name: '', email: '', countryCode: '+34', phone: '', city: '', address: '', postal: '' }

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

  const set = (field) => (event) => setProfile(current => ({ ...current, [field]: event.target.value }))

  const submit = async () => {
    if (submitting.current) return
    if (!profile.name.trim()) { setError(t('cc_err_name')); return }
    if (!EMAIL.test(profile.email.trim())) { setError(t('cc_err_email')); return }
    if (withPack && !packIsComplete(pack)) { setError(t('pk_fill')); return }
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
        ...(withPack ? { pack: packPayload(pack) } : {})
      })
      onCreated(result)
      if (result.email?.sent) {
        toast.push(`${t('cc_created')} ${t('cc_email_ok')} ${profile.email.trim().toLowerCase()}`)
        onClose()
      } else {
        toast.push(t('cc_created'))
        setCreated(result)
      }
    } catch (err) {
      setError(err.message)
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
        <Button variant="primary" className="flex-[2]" onClick={submit} loading={busy}>{busy ? t('cc_creating') : t('cc_create')}</Button>
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
      </div>

      <section className="mt-2 rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <label className="flex cursor-pointer items-center gap-3 text-base font-medium">
          <input type="checkbox" checked={withPack} onChange={event => setWithPack(event.target.checked)} disabled={busy} className="h-4 w-4 accent-emerald-400" />
          {t('cc_pack_toggle')}
        </label>
        <p className="mt-2 text-sm text-gray-500">{t('cc_pack_hint')}</p>
        {withPack && (
          <div className="mt-6 border-t border-white/10 pt-6">
            <PackFields form={pack} set={setPack} plans={plans} trainers={trainers} busy={busy} />
          </div>
        )}
      </section>

      {busy && withPack && <p className="mt-4 text-sm text-amber-300">{t('approving_hint')}</p>}
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
    </Drawer>
  )
}
