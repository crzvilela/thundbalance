import { useState } from 'react'
import { adminRequest } from './api'
import { useAdminText } from './useAdminText'
import { useToast } from './toastContext'
import { Badge, Button, Field, SelectInput, TextInput } from './ui'
import { DEFAULT_TAX_ID_TYPE, TAX_ID_TYPES, normalizeTaxId, taxIdProblem } from '../utils/taxId'

// "Datos de facturación" on the client's record: document and billing address
// (the same morada / cidade / cep columns the profile always had, plus the
// country). The full document is only ever shown here, to the admin.
// Remount it with a new `key` when the client changes.
export default function BillingSection({ client, onSaved }) {
  const { t } = useAdminText()
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

  const set = (field) => (event) => { setForm(current => ({ ...current, [field]: event.target.value })); setError('') }
  const missing = !form.taxId.trim() || !form.address.trim()

  const save = async () => {
    const problem = taxIdProblem(form.type, form.taxId)
    if (problem) { setError(t(`tx_${problem}`)); return }
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
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium uppercase tracking-wider text-gray-400">{t('bl_title')}</h3>
        {client.billing_missing && <Badge tone="amber">{t('bl_missing')}</Badge>}
      </div>
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
        {missing && <p className="mb-4 text-sm text-amber-200">{t('bl_missing_text')}</p>}
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label={t('bl_doc_type')}>
            <SelectInput value={form.type} onChange={set('type')} disabled={busy}>
              {TAX_ID_TYPES.map(type => <option key={type} value={type}>{t(`bl_type_${type}`)}</option>)}
            </SelectInput>
          </Field>
          <Field label={t('bl_doc')}>
            <TextInput value={form.taxId} onChange={set('taxId')} disabled={busy} autoComplete="off" maxLength={30} placeholder="12345678Z" />
          </Field>
        </div>
        <Field label={t('bl_address')}>
          <TextInput value={form.address} onChange={set('address')} disabled={busy} maxLength={200} />
        </Field>
        <div className="grid gap-x-4 sm:grid-cols-3">
          <Field label={t('bl_postal')}>
            <TextInput value={form.postal} onChange={set('postal')} disabled={busy} maxLength={20} />
          </Field>
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
