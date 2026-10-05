import { useMemo, useState } from 'react'
import { adminRequest } from '../api'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { useToast } from '../toastContext'
import { WEEKDAYS } from '../availability'
import {
  Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Field, Icon,
  PageHeader, SelectInput, Skeleton, TextInput
} from '../ui'

const START_OPTIONS = Array.from({ length: 18 }, (_, index) => `${String(index + 5).padStart(2, '0')}:00`) // 05:00-22:00
const END_OPTIONS = Array.from({ length: 18 }, (_, index) => `${String(index + 6).padStart(2, '0')}:00`) // 06:00-23:00
const DEFAULT_WINDOW = { start: '07:00', end: '14:00' }

// Monday to Friday 07:00-14:00 as a starting point for a new trainer.
const starterHours = () => Object.fromEntries(WEEKDAYS.map((day, index) => [day, index < 5 ? { ...DEFAULT_WINDOW } : null]))

// Weekly working hours: one row per weekday (tick = works, with from/until).
function HoursEditor({ hours, setHours }) {
  const { t, dayFull } = useAdminText()
  const setDay = (day, patch) => setHours(current => ({ ...current, [day]: patch === null ? null : { ...(current[day] || DEFAULT_WINDOW), ...patch } }))
  const copyMonday = () => {
    const monday = hours.Monday || DEFAULT_WINDOW
    setHours(current => ({ ...current, ...Object.fromEntries(WEEKDAYS.slice(0, 5).map(day => [day, { ...monday }])) }))
  }

  return (
    <div>
      <div className="space-y-2">
        {WEEKDAYS.map(day => {
          const window = hours[day]
          return (
            <div key={day} className={`grid grid-cols-[7.5rem_1fr] items-center gap-3 rounded-xl border px-4 py-2.5 sm:grid-cols-[9rem_6rem_1fr] ${window ? 'border-white/10 bg-white/[0.03]' : 'border-white/[0.05] bg-transparent'}`}>
              <label className="flex cursor-pointer items-center gap-3 select-none">
                <input type="checkbox" checked={!!window} onChange={event => setDay(day, event.target.checked ? {} : null)} className="h-5 w-5 accent-emerald-400" />
                <span className={window ? 'font-medium' : 'text-gray-500'}>{dayFull(day)}</span>
              </label>
              {window ? (
                <div className="col-span-2 flex items-center gap-2 sm:col-span-2">
                  <SelectInput aria-label={`${dayFull(day)} ${t('tn_from')}`} value={window.start} onChange={event => setDay(day, { start: event.target.value })} className="!w-auto !py-2">
                    {START_OPTIONS.map(option => <option key={option}>{option}</option>)}
                  </SelectInput>
                  <span className="text-gray-500">–</span>
                  <SelectInput aria-label={`${dayFull(day)} ${t('tn_to')}`} value={window.end} onChange={event => setDay(day, { end: event.target.value })} className="!w-auto !py-2">
                    {END_OPTIONS.map(option => <option key={option}>{option}</option>)}
                  </SelectInput>
                  {window.start >= window.end && <Icon name="alert" className="h-5 w-5 text-red-300" />}
                </div>
              ) : (
                <span className="col-span-1 text-sm text-gray-600 sm:col-span-2">{t('tn_off')}</span>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-3">
        <Button variant="secondary" onClick={copyMonday}>{t('tn_apply_week')}</Button>
      </div>
    </div>
  )
}

const hoursInvalid = (hours) => WEEKDAYS.some(day => hours[day] && hours[day].start >= hours[day].end)

function TrainerCard({ trainer, onChanged }) {
  const { t } = useAdminText()
  const toast = useToast()
  const [hours, setHours] = useState(trainer.hours)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing, setRemoving] = useState(false)

  const dirty = useMemo(() => JSON.stringify(hours) !== JSON.stringify(trainer.hours), [hours, trainer.hours])
  const workingDays = WEEKDAYS.filter(day => hours[day]).length

  const save = async () => {
    if (hoursInvalid(hours)) { setError(t('tn_invalid')); return }
    setSaving(true)
    setError('')
    try {
      await adminRequest('PUT', `/admin/trainers/${trainer.id}/availability`, { hours })
      toast.push(t('tn_saved'))
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setRemoving(true)
    try {
      const result = await adminRequest('DELETE', `/admin/trainers/${trainer.id}`)
      toast.push(t(result.outcome === 'archived' ? 'tn_archived' : 'tn_removed'))
      setConfirmRemove(false)
      onChanged()
    } catch (err) {
      toast.push(err.message, 'error')
      setConfirmRemove(false)
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400/25 to-emerald-700/10 text-xl font-semibold text-emerald-200">
          {trainer.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-2xl font-semibold">{trainer.name}</p>
          <p className="truncate text-sm text-gray-500">{trainer.specialty || '—'} · {workingDays} {t('tn_days_word')}</p>
        </div>
        {dirty && <Badge tone="amber">{t('tn_unsaved')}</Badge>}
      </div>

      <HoursEditor hours={hours} setHours={setHours} />

      {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}

      <div className="mt-5 flex flex-wrap justify-between gap-3">
        <Button variant="danger" onClick={() => setConfirmRemove(true)}>{t('tn_remove')}</Button>
        <Button variant="primary" onClick={save} disabled={!dirty} loading={saving}>{saving ? t('tn_saving') : t('tn_save')}</Button>
      </div>

      <ConfirmDialog
        open={confirmRemove} busy={removing}
        title={t('tn_remove_title')} text={`${trainer.name} — ${t('tn_remove_text')}`}
        confirmLabel={t('tn_remove')} cancelLabel={t('cancel')}
        onConfirm={remove} onCancel={() => setConfirmRemove(false)}
      />
    </Card>
  )
}

function NewTrainer({ open, onClose, onCreated }) {
  const { t } = useAdminText()
  const toast = useToast()
  const [name, setName] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [hours, setHours] = useState(starterHours)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    if (name.trim().length < 2) { setError(t('tn_name')); return }
    if (hoursInvalid(hours)) { setError(t('tn_invalid')); return }
    setBusy(true)
    setError('')
    try {
      await adminRequest('POST', '/admin/trainers', { name: name.trim(), specialty: specialty.trim() || null, hours })
      toast.push(t('tn_created'))
      setName(''); setSpecialty(''); setHours(starterHours())
      onCreated()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open={open} onClose={onClose} busy={busy} size="lg"
      title={t('tn_new_title')} subtitle={t('tn_new_sub')}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button variant="primary" onClick={create} loading={busy}>{busy ? t('tn_creating') : t('tn_create')}</Button>
      </>}
    >
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <Field label={t('tn_name')}><TextInput value={name} onChange={event => setName(event.target.value)} maxLength={60} disabled={busy} autoFocus /></Field>
          <Field label={t('tn_specialty')}><TextInput value={specialty} onChange={event => setSpecialty(event.target.value)} placeholder={t('tn_specialty_ph')} maxLength={80} disabled={busy} /></Field>
          <p className="rounded-xl border border-sky-400/20 bg-sky-400/5 px-4 py-3 text-sm text-sky-100">{t('tn_note')}</p>
          {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
        </div>
        <HoursEditor hours={hours} setHours={setHours} />
      </div>
    </Drawer>
  )
}

export default function Trainers() {
  const { t } = useAdminText()
  const resource = useAdminResource('/admin/trainer-availability')
  const trainers = useMemo(() => (Array.isArray(resource.data) ? resource.data : []), [resource.data])
  const [adding, setAdding] = useState(false)

  return (
    <div className="admin-fade">
      <PageHeader
        title={t('tn_title')} subtitle={t('tn_sub')}
        actions={<>
          <Button variant="secondary" onClick={resource.reload}><Icon name="refresh" className="h-4 w-4" />{t('refresh')}</Button>
          <Button variant="primary" onClick={() => setAdding(true)}><Icon name="bolt" className="h-4 w-4" />{t('tn_add')}</Button>
        </>}
      />
      <p className="mb-6 flex items-center gap-2 rounded-xl border border-sky-400/20 bg-sky-400/5 px-4 py-3 text-sm text-sky-100">
        <Icon name="clock" className="h-4 w-4 shrink-0" />{t('tn_note')}
      </p>

      {resource.error ? (
        <Card><ErrorState message={`${t('load_error')} (${resource.error})`} retryLabel={t('retry')} onRetry={resource.reload} /></Card>
      ) : resource.loading && !resource.data ? (
        <div className="grid gap-5 xl:grid-cols-2"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
      ) : trainers.length === 0 ? (
        <Card><EmptyState icon="clients" title={t('tn_empty')} action={<Button variant="primary" onClick={() => setAdding(true)}>{t('tn_add')}</Button>} /></Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {trainers.map(trainer => (
            // The key includes the saved hours so a saved card re-reads them.
            <TrainerCard key={`${trainer.id}-${JSON.stringify(trainer.hours)}`} trainer={trainer} onChanged={resource.reload} />
          ))}
        </div>
      )}

      <NewTrainer open={adding} onClose={() => setAdding(false)} onCreated={resource.reload} />
    </div>
  )
}
