import { useEffect, useState } from 'react'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useToast } from './toastContext'
import { Button, Field, TextInput } from './ui'
import { DEFAULT_TAX_ID_TYPE, normalizeTaxId } from '../utils/taxId'
import PostalCodeInput from '../components/forms/PostalCodeInput'
import TaxIdInput from '../components/forms/TaxIdInput'
import { formText, serverFieldError } from '../i18n/formText'
import { countryIsoOf, documentProblem, postalCodeProblem, regionOfPhone } from '../utils/validators'

// "Datos de facturación" on the client's record: document and billing address
// (the same morada / cidade / cep columns the profile always had, plus the
// country). The full document is only ever shown here, to the admin.
// Remount it with a new `key` when the client changes.
export default function BillingSection({ client, onSaved, onDirtyChange, bare = false }) {
  const { t, language } = useAdminText()
  const [fieldErrors, setFieldErrors] = useState({})
  const toast = useToast()
  const [form, setForm] = useState({
    type: client.tax_id_type || DEFAULT_TAX_ID_TYPE,
    taxId: client.tax_id || '',
    address: client.address || '',
    postal: client.postal_code || '',
    city: client.city || '',
    country: client.country || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const setValue = (field, value) => {
    setForm(current => ({ ...current, [field]: value }))
    setError('')
    if (fieldErrors[field]) setFieldErrors(current => ({ ...current, [field]: undefined }))
  }
  const set = (field) => (event) => setValue(field, event.target.value)
  const postalCountry = regionOfPhone(client.phone) || countryIsoOf(form.country)
  const postalChanged = form.postal !== (client.postal_code || '')
  const dirty = form.type !== (client.tax_id_type || DEFAULT_TAX_ID_TYPE) || form.taxId !== (client.tax_id || '')
    || form.address !== (client.address || '') || form.postal !== (client.postal_code || '')
    || form.city !== (client.city || '') || form.country !== (client.country || '')

  // lets the record warn before leaving with unsaved edits
  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

  const save = async () => {
    // an unchanged old postal code is not checked again
    const codes = {
      taxId: documentProblem(form.type, form.taxId),
      postal: postalChanged ? postalCodeProblem(form.postal, postalCountry, { required: false }) : null,
    }
    const found = Object.fromEntries(Object.entries(codes).filter(([, code]) => code).map(([key, code]) => [key, formText(language, code)]))
    setFieldErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    setError('')
    try {
      await adminRequest('PUT', `/admin/clients/${client.id}/billing`, {
        tax_id_type: form.type,
        tax_id: normalizeTaxId(form.taxId),
        address: form.address,
        postal_code: form.postal,
        city: form.city,
        country: form.country,
      })
      toast.push(t('bl_saved'))
      onSaved()
    } catch (err) {
      const fieldError = err.field ? serverFieldError(err.detail, language) : null
      const key = fieldError && { tax_id: 'taxId', postal_code: 'postal' }[fieldError.field]
      if (key) setFieldErrors({ [key]: fieldError.message })
      else setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      {!bare && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium uppercase tracking-wider text-gray-400">{t('bl_title')}</h3>
        </div>
      )}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        <TaxIdInput label={t('bl_doc')} language={language} type={form.type} value={form.taxId} error={fieldErrors.taxId}
          disabled={busy} onChange={value => setValue('taxId', value)} onTypeChange={type => setValue('type', type)} />
        <Field label={t('bl_address')}>
          <TextInput value={form.address} onChange={set('address')} disabled={busy} maxLength={200} />
        </Field>
        <div className="grid gap-x-4 sm:grid-cols-3">
          <PostalCodeInput label={t('bl_postal')} language={language} country={postalCountry} value={form.postal}
            validate={postalChanged} error={fieldErrors.postal} disabled={busy} onChange={value => setValue('postal', value)} />
          <Field label={t('bl_city')}>
            <TextInput value={form.city} onChange={set('city')} disabled={busy} maxLength={80} />
          </Field>
          <Field label={t('bl_country')}>
            <TextInput value={form.country} onChange={set('country')} disabled={busy} maxLength={60} placeholder="España" />
          </Field>
        </div>
        {error && <p role="alert" className="mb-3 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
        <Button variant="primary" onClick={save} loading={busy}>{t('bl_save')}</Button>
      </div>
    </section>
  )
}
