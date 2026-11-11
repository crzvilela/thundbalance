import { useMemo, useState } from 'react'
import { adminRequest } from '../api'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { useToast } from '../toastContext'
import SegmentedType from '../../components/forms/SegmentedType'
import { Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Field, Icon, PageHeader, Skeleton, TextInput } from '../ui'
import { formatMoney, isPriceText, monthsEquivalent, packPriceLooksOff, packQuote, priceFromText, suggestedPackPrice } from '../../utils/pricing'
import { refreshPricing } from '../../utils/usePricing'

const PER_WEEK = [1, 2, 3, 4, 5, 6, 7]
const EMPTY = { name: '', type: 'individual', weeks: '', options: [], perSession: '', perPack: '', packTouched: false }

function toForm(pack) {
  return {
    name: pack.name,
    type: pack.session_type,
    weeks: String(pack.weeks),
    options: pack.sessions_per_week_options,
    perSession: String(pack.price_per_session),
    perPack: pack.price_per_pack == null ? '' : String(pack.price_per_pack),
    packTouched: pack.price_per_pack != null          // an explicit pack price was set: it is not "suggested" any more
  }
}

// What the form means: the pack price shown (suggested with ONE option until the admin types one), and the problems found.
function readForm(form) {
  const single = form.options.length === 1
  const weeks = Number(form.weeks)
  const suggestion = single ? suggestedPackPrice(priceFromText(form.perSession), weeks, form.options[0]) : null
  const packShown = !single ? '' : (form.packTouched ? form.perPack : (suggestion == null ? '' : String(suggestion)))
  let problem = ''
  if (!form.name.trim()) problem = 'cat_err_name'
  else if (!/^\d+$/.test(form.weeks.trim()) || weeks < 1) problem = 'cat_err_weeks'
  else if (form.options.length === 0) problem = 'cat_err_options'
  else if (!isPriceText(form.perSession)) problem = 'cat_err_price'
  else if (single && form.packTouched && form.perPack.trim() !== '' && !isPriceText(form.perPack)) problem = 'cat_err_pack_price'
  const off = single && form.packTouched && isPriceText(form.perSession) && isPriceText(form.perPack) &&
    packPriceLooksOff(priceFromText(form.perSession), priceFromText(form.perPack), weeks, form.options[0])
  return { single, suggestion, packShown, problem, off }
}

export default function Plans() {
  const { t } = useAdminText()
  const toast = useToast()
  const resource = useAdminResource('/admin/pack-catalog')
  const packs = useMemo(() => resource.data?.packs || [], [resource.data])
  const onSale = packs.filter(pack => pack.active)
  const archived = packs.filter(pack => !pack.active)

  const [editing, setEditing] = useState(null) // null | 'new' | pack
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [archiving, setArchiving] = useState(null)

  const view = readForm(form)
  const openNew = () => { setForm(EMPTY); setFormError(''); setEditing('new') }
  const openEdit = (pack) => { setForm(toForm(pack)); setFormError(''); setEditing(pack) }
  const set = (patch) => setForm(current => ({ ...current, ...patch }))
  const toggleOption = (value) => set({
    options: form.options.includes(value) ? form.options.filter(item => item !== value) : [...form.options, value].sort((a, b) => a - b)
  })
  const changed = () => { refreshPricing(); resource.reload() }

  const save = async () => {
    if (view.problem) { setFormError(t(view.problem)); return }
    const payload = {
      name: form.name.trim(),
      session_type: form.type,
      weeks: Number(form.weeks),
      sessions_per_week_options: form.options,
      price_per_session: priceFromText(form.perSession),
      // only an explicit pack price is sent (with one option); otherwise the total is price per session x sessions
      price_per_pack: view.single && form.packTouched && form.perPack.trim() !== '' ? priceFromText(form.perPack) : null
    }
    setBusy(true)
    setFormError('')
    try {
      if (editing === 'new') {
        await adminRequest('POST', '/admin/pack-catalog', payload)
        toast.push(t('cat_created'))
      } else {
        await adminRequest('PUT', `/admin/pack-catalog/${editing.id}`, payload)
        toast.push(t('cat_updated'))
      }
      setEditing(null)
      changed()
    } catch (error) {
      setFormError(error.message)
    } finally {
      setBusy(false)
    }
  }

  const setArchived = async (pack, archive) => {
    setBusy(true)
    try {
      await adminRequest('POST', `/admin/pack-catalog/${pack.id}/${archive ? 'archive' : 'restore'}`)
      toast.push(t(archive ? 'cat_archived_ok' : 'cat_restored'))
      setArchiving(null)
      changed()
    } catch (error) {
      toast.push(error.message, 'error')
      setArchiving(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-fade">
      <PageHeader pageKey="plans"
        title={t('cat_title')} subtitle={t('cat_sub')}
        actions={<Button variant="primary" onClick={openNew}><Icon name="bolt" className="h-4 w-4" />{t('cat_new')}</Button>}
      />

      {resource.error ? (
        <Card><ErrorState message={`${t('load_error')} (${resource.error})`} retryLabel={t('retry')} onRetry={resource.reload} /></Card>
      ) : resource.loading && !resource.data ? (
        <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-56" /><Skeleton className="h-56" /><Skeleton className="h-56" /></div>
      ) : (
        <>
          {packs.length === 0 ? (
            <Card><EmptyState icon="inbox" title={t('cat_empty')} action={<Button variant="primary" onClick={openNew}>{t('cat_new')}</Button>} /></Card>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label={t('cat_on_sale')}>
              {onSale.map(pack => <PackCard key={pack.id} pack={pack} onEdit={() => openEdit(pack)} onArchive={() => setArchiving(pack)} />)}
            </ul>
          )}

          {archived.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-400">{t('cat_archived_title')} ({archived.length})</h2>
              <p className="mb-4 max-w-2xl text-sm text-gray-500">{t('cat_archived_note')}</p>
              <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {archived.map(pack => <PackCard key={pack.id} pack={pack} onEdit={() => openEdit(pack)} onRestore={() => setArchived(pack, false)} busy={busy} />)}
              </ul>
            </section>
          )}

          <TrialPrices prices={resource.data?.trial} onSaved={changed} />
        </>
      )}

      <Drawer
        open={!!editing} onClose={() => setEditing(null)} busy={busy}
        title={editing === 'new' ? t('cat_new_title') : t('cat_edit_title')}
        footer={<>
          <Button variant="secondary" className="flex-1" onClick={() => setEditing(null)} disabled={busy}>{t('cancel')}</Button>
          <Button variant="primary" className="flex-[2]" onClick={save} loading={busy}>{busy ? t('pl_saving') : t('cat_save')}</Button>
        </>}
      >
        {editing && editing !== 'new' && editing.sold > 0 && (
          <p className="mb-5 rounded-xl border border-sky-400/20 bg-sky-400/5 px-4 py-3 text-sm text-sky-100">{t('cat_edit_sold_note').replace('{n}', editing.sold)}</p>
        )}
        <div className="grid gap-x-8 md:grid-cols-2">
          <div className="md:col-span-2">
            <Field label={t('cat_name')} hint={t('cat_name_hint')}>
              <TextInput value={form.name} onChange={event => set({ name: event.target.value })} maxLength={80} disabled={busy} />
            </Field>
          </div>
          <div className="md:col-span-2 mb-5">
            <SegmentedType
              value={form.type} onChange={type => set({ type })} disabled={busy}
              labels={{ legend: t('ty_type'), individual: t('ty_individual'), dual: t('ty_dual') }}
            />
            {form.type === 'dual' && <p className="mt-2 text-xs text-gray-500">{t('cat_dual_note')}</p>}
          </div>
          <Field label={t('cat_weeks')} hint={t('cat_weeks_hint')}>
            <TextInput type="number" inputMode="numeric" min="1" step="1" value={form.weeks} onChange={event => set({ weeks: event.target.value })} disabled={busy} />
          </Field>
          <div className="mb-5">
            <span className="mb-2.5 block text-sm font-medium uppercase tracking-wider text-gray-400" id="cat-options-label">{t('cat_options')}</span>
            <div role="group" aria-labelledby="cat-options-label" className="flex flex-wrap gap-2">
              {PER_WEEK.map(value => {
                const on = form.options.includes(value)
                return (
                  <button key={value} type="button" aria-pressed={on} onClick={() => toggleOption(value)} disabled={busy}
                    className={`min-h-[44px] min-w-[44px] rounded-full border px-4 text-sm transition ${on ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-200' : 'border-white/10 text-gray-400 hover:border-white/25 hover:text-white'}`}>
                    {value}
                  </button>
                )
              })}
            </div>
            <span className="mt-1.5 block text-sm text-gray-500">{form.options.length > 1 ? t('cat_options_many') : t('cat_options_hint')}</span>
          </div>
          <Field label={t('cat_price_session')} hint={t('cat_price_session_hint')}>
            <TextInput inputMode="decimal" value={form.perSession} onChange={event => set({ perSession: event.target.value })} placeholder="0.00" disabled={busy} />
          </Field>
          <Field label={t('cat_price_pack')} hint={!view.single ? t('cat_pack_disabled') : (form.packTouched ? t('cat_pack_custom') : t('cat_pack_suggested'))}>
            <div className="flex gap-2">
              <TextInput
                inputMode="decimal" value={view.packShown} placeholder="—" disabled={busy || !view.single}
                onChange={event => set({ perPack: event.target.value, packTouched: true })}
              />
              {view.single && form.packTouched && (
                <Button variant="secondary" onClick={() => set({ perPack: '', packTouched: false })} disabled={busy} aria-label={t('cat_pack_reset')}>↺</Button>
              )}
            </div>
          </Field>
        </div>
        {view.off && (
          <p role="status" className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            {t('cat_warn_off').replace('{expected}', formatMoney(view.suggestion))}
          </p>
        )}
        {formError && <p role="alert" className="rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{formError}</p>}
      </Drawer>

      <ConfirmDialog
        open={!!archiving} busy={busy}
        title={t('cat_archive_title')} text={archiving ? `${archiving.name} — ${t('cat_archive_text')}` : ''}
        confirmLabel={t('cat_archive')} cancelLabel={t('cancel')}
        onConfirm={() => setArchived(archiving, true)} onCancel={() => setArchiving(null)}
      />
    </div>
  )
}

// 4 weeks = 1 month, 12 = 3 months, 24 = 6 months; any other number is just "N weeks"
function WeeksText({ weeks }) {
  const { t } = useAdminText()
  const months = monthsEquivalent(weeks)
  return <>{t('cat_weeks_n').replace('{n}', weeks)}{months ? ` = ${t(`cat_eq_${months}`)}` : ''}</>
}

function PackCard({ pack, onEdit, onArchive, onRestore, busy = false }) {
  const { t } = useAdminText()
  const single = pack.sessions_per_week_options.length === 1
  const quote = packQuote(pack, pack.sessions_per_week_options[0])
  const explicit = single && pack.price_per_pack != null
  return (
    <li>
      <Card className={`group relative h-full overflow-hidden p-6 transition-all duration-200 ${pack.active ? 'hover:-translate-y-0.5 hover:border-emerald-400/30' : 'opacity-75'}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={pack.session_type === 'dual' ? 'sky' : 'emerald'}>{pack.session_type === 'dual' ? t('ty_dual') : t('ty_individual')}</Badge>
          <Badge tone={pack.active ? 'emerald' : 'neutral'}>{pack.active ? t('cat_active') : t('cat_archived')}</Badge>
          {pack.sold > 0 && <span className="text-xs text-gray-500">{t('cat_sold').replace('{n}', pack.sold)}</span>}
        </div>
        <h2 className="mt-4 break-words text-xl font-semibold">{pack.name}</h2>
        <p className="mt-1 text-sm text-gray-400"><WeeksText weeks={pack.weeks} /></p>

        <dl className="mt-4 space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-gray-400">{t('cat_price_session')}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{formatMoney(pack.price_per_session)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-gray-400">{t('cat_price_pack')}</dt>
            <dd className="text-right tabular-nums">
              {single
                ? <>{formatMoney(quote.total)} <span className="block text-xs text-gray-500">{explicit ? t('cat_pack_custom_short') : t('cat_pack_auto_short')}</span></>
                : <span className="text-sm text-gray-400">{t('cat_pack_by_choice')}</span>}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-sm text-gray-400">{t('cat_options')}</dt>
            <dd className="flex flex-wrap justify-end gap-1.5">
              {pack.sessions_per_week_options.map(value => <span key={value} className="rounded-full border border-white/10 px-2.5 py-0.5 text-sm text-gray-200">{value}</span>)}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onEdit}>{t('cat_edit')}</Button>
          {pack.active
            ? <Button variant="secondary" onClick={onArchive} aria-label={`${t('cat_archive')} ${pack.name}`}>{t('cat_archive')}</Button>
            : <Button variant="primary" onClick={onRestore} loading={busy} aria-label={`${t('cat_restore')} ${pack.name}`}>{t('cat_restore')}</Button>}
        </div>
      </Card>
    </li>
  )
}

// The price of a trial session, individual and dual (the trial form of the site reads them from the server).
function TrialPrices({ prices, onSaved }) {
  const { t } = useAdminText()
  const toast = useToast()
  const [draft, setDraft] = useState(null)            // null = what the server has; edited text once the admin types
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const shown = draft || { individual: String(prices?.individual ?? ''), dual: String(prices?.dual ?? '') }
  const valid = isPriceText(shown.individual) && isPriceText(shown.dual)

  const save = async () => {
    if (!valid) { setError(t('cat_err_price')); return }
    setBusy(true)
    setError('')
    try {
      await adminRequest('PUT', '/admin/trial-prices', { individual: priceFromText(shown.individual), dual: priceFromText(shown.dual) })
      toast.push(t('cat_trial_saved'))
      setDraft(null)
      onSaved()
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-10" aria-labelledby="cat-trial-title">
      <Card className="p-6">
        <h2 id="cat-trial-title" className="text-xl font-semibold">{t('cat_trial_title')}</h2>
        <p className="mt-1 max-w-2xl text-sm text-gray-400">{t('cat_trial_sub')}</p>
        <div className="mt-5 grid gap-x-8 sm:grid-cols-2 lg:max-w-xl">
          {['individual', 'dual'].map(type => (
            <Field key={type} label={t(`cat_trial_${type}`)}>
              <TextInput inputMode="decimal" value={shown[type]} onChange={event => setDraft({ ...shown, [type]: event.target.value })} placeholder="0.00" disabled={busy} />
            </Field>
          ))}
        </div>
        {error && <p role="alert" className="mb-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
        <Button variant="primary" onClick={save} loading={busy} disabled={!draft}>{busy ? t('pl_saving') : t('cat_trial_save')}</Button>
      </Card>
    </section>
  )
}
