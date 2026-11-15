import { useMemo, useState } from 'react'
import { adminRequest } from '../api'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { useToast } from '../toastContext'
import { Badge, Button, Card, ConfirmDialog, ErrorState, Field, PageHeader, Skeleton, TextArea, TextInput } from '../ui'
import LegalBlocks from '../../legal/LegalBlocks'
import { DOCS, ROUTES, modelText } from '../../legal/legalModels'
import { pendingMarks, updatedDate } from '../../legal/legalRender'

// "Textos legales": the company data the legal pages show (legal_settings) and the text of each document and language (legal_documents).
// What is not edited here is the model text of the code (src/legal/legalModels.js); "Restaurar modelo" goes back to it.
const LANGS = [['es', 'ES'], ['en', 'EN'], ['ca', 'CA']]
const TEXT_FIELDS = [['holder', 'lt_holder'], ['tax_id', 'lt_tax_id'], ['address', 'lt_address'], ['email', 'lt_email'], ['phone', 'lt_phone'], ['registry', 'lt_registry'], ['dpo_name', 'lt_dpo']]
const RETENTION = [['retention_contact_days', 'lt_ret_contact'], ['retention_trial_days', 'lt_ret_trial'], ['retention_email_log_days', 'lt_ret_email']]

const fromSettings = (settings = {}) => ({
  ...Object.fromEntries(TEXT_FIELDS.map(([key]) => [key, settings[key] || ''])),
  ...Object.fromEntries(RETENTION.map(([key]) => [key, settings[`${key}_custom`] ?? ''])),
  last_review: settings.last_review || '',
  reviewed: Boolean(settings.reviewed)
})

export default function LegalTexts() {
  const { t } = useAdminText()
  const resource = useAdminResource('/admin/legal')
  if (resource.error) return <Card><ErrorState message={`${t('load_error')} (${resource.error})`} retryLabel={t('retry')} onRetry={resource.reload} /></Card>
  if (!resource.data) return <Skeleton className="h-64" />
  return <LegalEditor data={resource.data} reload={resource.reload} />
}

function LegalEditor({ data, reload }) {
  const { t } = useAdminText()
  const toast = useToast()
  const [form, setForm] = useState(() => fromSettings(data.settings))
  const [saving, setSaving] = useState(false)
  const [doc, setDoc] = useState(DOCS[0])
  const [lang, setLang] = useState('es')
  const [body, setBody] = useState(() => data.documents?.[DOCS[0]]?.es?.body || modelText(DOCS[0], 'es'))
  const [busy, setBusy] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)

  const override = data.documents?.[doc]?.[lang]
  const choose = (nextDoc, nextLang) => {                // another document or language: its text (the edited one, or the model)
    setDoc(nextDoc)
    setLang(nextLang)
    setBody(data.documents?.[nextDoc]?.[nextLang]?.body || modelText(nextDoc, nextLang))
  }

  // what the preview uses: the data being typed, and the retention periods that apply when a box is empty
  const previewSettings = useMemo(() => ({
    ...Object.fromEntries(TEXT_FIELDS.map(([key]) => [key, form[key].trim()])),
    retention_contact_days: form.retention_contact_days || data.defaults?.retention_contact_days,
    retention_trial_days: form.retention_trial_days || data.defaults?.retention_trial_days,
    retention_email_log_days: form.retention_email_log_days || data.defaults?.retention_email_log_days
  }), [form, data])

  const setField = (key) => (event) => setForm(current => ({ ...current, [key]: event.target.value }))

  const saveSettings = async () => {
    setSaving(true)
    try {
      const payload = {
        ...Object.fromEntries(TEXT_FIELDS.map(([key]) => [key, form[key]])),
        ...Object.fromEntries(RETENTION.map(([key]) => [key, form[key] === '' ? null : Number(form[key])])),
        last_review: form.last_review || null,
        reviewed: form.reviewed
      }
      await adminRequest('PUT', '/admin/legal/settings', payload)
      toast.push(t('lt_saved'), 'success')
      reload()
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const saveText = async () => {
    setBusy(true)
    try {
      await adminRequest('PUT', `/admin/legal/documents/${doc}/${lang}`, { body })
      toast.push(t('lt_text_saved'), 'success')
      reload()
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const restore = async () => {
    setBusy(true)
    try {
      await adminRequest('DELETE', `/admin/legal/documents/${doc}/${lang}`)
      toast.push(t('lt_restored'), 'success')
      setConfirmRestore(false)
      setBody(modelText(doc, lang))
      reload()
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const pending = pendingMarks(body, previewSettings)
  return (
    <div className="admin-fade">
      <PageHeader pageKey="legal" title={t('lt_title')} subtitle={t('lt_sub')} />

      <Card className="mb-6 p-5">
        <h2 className="text-lg font-semibold">{t('lt_company')}</h2>
        <p className="mb-5 mt-1 text-sm text-gray-400">{t('lt_company_hint')}</p>
        {data.missing?.length > 0 && <p className="mb-4 text-sm text-amber-300">{t('lt_missing')}: {data.missing.map(key => t(`lt_${key === 'holder' ? 'holder' : key}`)).join(', ')}</p>}
        <div className="grid gap-x-5 sm:grid-cols-2">
          {TEXT_FIELDS.map(([key, label]) => (
            <Field key={key} label={t(label)}><TextInput value={form[key]} onChange={setField(key)} maxLength={key === 'address' || key === 'registry' ? 250 : 150} /></Field>
          ))}
        </div>
        <h3 className="mb-1 mt-2 text-sm font-medium uppercase tracking-wider text-gray-400">{t('lt_retention')}</h3>
        <p className="mb-3 text-sm text-gray-500">{t('lt_retention_hint')}</p>
        <div className="grid gap-x-5 sm:grid-cols-3">
          {RETENTION.map(([key, label]) => (
            <Field key={key} label={t(label)}><TextInput type="number" min="1" max="3650" value={form[key]} placeholder={String(data.defaults?.[key] ?? '')} onChange={setField(key)} /></Field>
          ))}
        </div>
        <div className="grid items-end gap-x-5 sm:grid-cols-2">
          <Field label={t('lt_last_review')}><TextInput type="date" value={form.last_review} onChange={setField('last_review')} /></Field>
          <Field label={t('lt_reviewed')} hint={t('lt_reviewed_hint')}>
            <input type="checkbox" checked={form.reviewed} onChange={(event) => setForm(current => ({ ...current, reviewed: event.target.checked }))} className="h-6 w-6 accent-emerald-400" />
          </Field>
        </div>
        <Button variant="primary" loading={saving} onClick={saveSettings}>{t('lt_save')}</Button>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 text-lg font-semibold">{t('lt_texts')}</h2>
        <div className="grid gap-x-5 sm:grid-cols-2">
          <Field label={t('lt_doc')}>
            <select value={doc} onChange={(event) => choose(event.target.value, lang)} className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3.5 text-base text-white">
              {DOCS.map(key => <option key={key} value={key}>{t(`lt_d_${key}`)}</option>)}
            </select>
          </Field>
          <Field label={t('lt_lang')}>
            <div className="flex gap-2" role="group" aria-label={t('lt_lang')}>
              {LANGS.map(([code, label]) => (
                <button key={code} type="button" onClick={() => choose(doc, code)} aria-pressed={lang === code}
                  className={`min-h-12 flex-1 rounded-xl border px-4 text-sm transition ${lang === code ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200' : 'border-white/10 text-gray-400 hover:text-white'}`}>{label}</button>
              ))}
            </div>
          </Field>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-gray-400">
          <Badge tone={override ? 'sky' : 'neutral'}>{override ? t('lt_edited') : t('lt_model')}</Badge>
          <span>{t('lt_updated')}: {updatedDate(override, { last_review: data.settings.last_review })}</span>
          {pending > 0 && <Badge tone="amber">{pending} {t('lt_pending')}</Badge>}
          <a href={ROUTES[doc]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white">{t('lt_view')}</a>
        </div>
        <Field label={t('lt_edit')} hint={t('lt_edit_hint')}>
          <TextArea value={body} onChange={(event) => setBody(event.target.value)} rows={18} maxLength={40000} className="font-mono text-sm" spellCheck="false" />
        </Field>
        <div className="mb-8 flex flex-wrap gap-3">
          <Button variant="primary" loading={busy} onClick={saveText}>{t('lt_save_text')}</Button>
          <Button variant="secondary" disabled={busy || !override} onClick={() => setConfirmRestore(true)}>{t('lt_restore')}</Button>
        </div>

        <h3 className="mb-2 text-sm font-medium uppercase tracking-wider text-gray-400">{t('lt_preview')}</h3>
        <div className="rounded-xl border border-white/10 bg-black/40 p-5"><LegalBlocks text={body} settings={previewSettings} admin /></div>
      </Card>

      <ConfirmDialog open={confirmRestore} title={t('lt_restore_title')} text={t('lt_restore_text')} confirmLabel={t('lt_restore')} cancelLabel={t('cancel')}
        onConfirm={restore} onCancel={() => setConfirmRestore(false)} busy={busy} />
    </div>
  )
}
