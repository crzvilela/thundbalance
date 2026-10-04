import { useMemo, useState } from 'react'
import { adminRequest } from '../api'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { useToast } from '../toastContext'
import { Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Field, Icon, PageHeader, Skeleton, TextInput } from '../ui'

const EMPTY = { name: '', months: '', weeks: '', price: '' }

// /plans rows: [id, name, months, price, weeks]
function toForm(plan) {
  return { name: plan[1], months: String(plan[2] ?? ''), weeks: String(plan[4] ?? ''), price: String(plan[3] ?? '') }
}

export default function Plans() {
  const { t } = useAdminText()
  const toast = useToast()
  const resource = useAdminResource('/plans')
  const plans = useMemo(() => resource.data || [], [resource.data])

  const [editing, setEditing] = useState(null) // null | 'new' | plan row
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleting, setDeleting] = useState(null)

  const openNew = () => { setForm(EMPTY); setFormError(''); setEditing('new') }
  const openEdit = (plan) => { setForm(toForm(plan)); setFormError(''); setEditing(plan) }

  const save = async () => {
    const payload = {
      nome: form.name.trim(),
      duracao_meses: Number(form.months),
      duration_weeks: Number(form.weeks),
      preco: Number(form.price)
    }
    const valid = payload.nome && payload.duracao_meses >= 1 && payload.duration_weeks >= 1 && form.price !== '' && payload.preco >= 0
    if (!valid) { setFormError(t('pl_invalid')); return }

    setBusy(true)
    setFormError('')
    try {
      if (editing === 'new') {
        await adminRequest('POST', '/admin/plans', payload)
        toast.push(t('pl_created'))
      } else {
        await adminRequest('PUT', `/admin/plans/${editing[0]}`, payload)
        toast.push(t('pl_updated'))
      }
      setEditing(null)
      resource.reload()
    } catch (error) {
      setFormError(error.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await adminRequest('DELETE', `/admin/plans/${deleting[0]}`)
      toast.push(t('pl_deleted'))
      setDeleting(null)
      resource.reload()
    } catch (error) {
      toast.push(error.message, 'error')
      setDeleting(null)
    } finally {
      setBusy(false)
    }
  }

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value })

  return (
    <div className="admin-fade">
      <PageHeader
        title={t('pl_title')} subtitle={t('pl_sub')}
        actions={<Button variant="primary" onClick={openNew}><Icon name="bolt" className="h-4 w-4" />{t('pl_new')}</Button>}
      />

      {resource.error ? (
        <Card><ErrorState message={`${t('load_error')} (${resource.error})`} retryLabel={t('retry')} onRetry={resource.reload} /></Card>
      ) : resource.loading && !resource.data ? (
        <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-48" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
      ) : plans.length === 0 ? (
        <Card><EmptyState icon="inbox" title={t('pl_empty')} action={<Button variant="primary" onClick={openNew}>{t('pl_new')}</Button>} /></Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map(plan => (
            <li key={plan[0]}>
              <Card className="group relative h-full overflow-hidden p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400/30">
                <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-emerald-400/5 blur-2xl" />
                <Badge tone="emerald">{plan[2]} {t('pl_months_short')} · {plan[4]} {t('pl_weeks_short')}</Badge>
                <h2 className="mt-4 text-xl font-semibold">{plan[1]}</h2>
                <p className="mt-2 text-4xl font-semibold tabular-nums">€{Number(plan[3]).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                <div className="mt-6 flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => openEdit(plan)}>{t('pl_edit_title')}</Button>
                  <Button variant="danger" onClick={() => setDeleting(plan)} aria-label={`${t('pl_delete')} ${plan[1]}`}>{t('pl_delete')}</Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Drawer
        open={!!editing} onClose={() => setEditing(null)} busy={busy}
        title={editing === 'new' ? t('pl_new_title') : t('pl_edit_title')}
        footer={<>
          <Button variant="secondary" className="flex-1" onClick={() => setEditing(null)} disabled={busy}>{t('cancel')}</Button>
          <Button variant="primary" className="flex-[2]" onClick={save} loading={busy}>{busy ? t('pl_saving') : t('pl_save')}</Button>
        </>}
      >
        <Field label={t('pl_name')}><TextInput value={form.name} onChange={set('name')} maxLength={80} disabled={busy} /></Field>
        <Field label={t('pl_months')}><TextInput type="number" min="1" value={form.months} onChange={set('months')} disabled={busy} /></Field>
        <Field label={t('pl_weeks')} hint={t('pl_weeks_hint')}><TextInput type="number" min="1" value={form.weeks} onChange={set('weeks')} disabled={busy} /></Field>
        <Field label={t('pl_price')}><TextInput type="number" min="0" step="0.01" value={form.price} onChange={set('price')} disabled={busy} /></Field>
        {formError && <p role="alert" className="rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{formError}</p>}
      </Drawer>

      <ConfirmDialog
        open={!!deleting} busy={busy}
        title={t('pl_delete_title')} text={deleting ? `${deleting[1]} — ${t('pl_delete_text')}` : ''}
        confirmLabel={t('pl_delete')} cancelLabel={t('cancel')}
        onConfirm={remove} onCancel={() => setDeleting(null)}
      />
    </div>
  )
}
