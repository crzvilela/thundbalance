import Txt from '../Txt'
import BlockGroup from '../Block'
import { useMemo, useState } from 'react'
import { adminRequest } from '../api'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { useToast } from '../toastContext'
import SegmentedType from '../../components/forms/SegmentedType'
import { Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Field, Icon, PageHeader, Skeleton, TextArea, TextInput } from '../ui'
import { formatMoney, isPriceText, monthsEquivalent, priceFromText, totalPrice } from '../../utils/pricing'
import { MAX_BENEFIT, MAX_BENEFITS, MAX_OBJECTIVE, benefitsProblem, cleanBenefits, cleanObjective, moveItem, objectiveProblem } from '../../utils/packFields'
import { refreshPricing } from '../../utils/usePricing'

const PER_WEEK = [1, 2, 3, 4, 5]                 // Monday to Friday only: never more than 5 a week
const EMPTY = { name: '', type: 'individual', weeks: '', options: [], perSession: '', objective: '', benefits: [] }

function toForm(pack) {
  return {
    name: pack.name,
    type: pack.session_type,
    weeks: String(pack.weeks),
    options: pack.sessions_per_week_options,
    perSession: String(pack.price_per_session),
    objective: pack.objective || '',
    benefits: pack.benefits || []
  }
}

// What the form means: the problems found and the figures the system works out (never typed): the total sessions (weeks x sessions
// per week) and the total price (total sessions x price per session). With ONE option of sessions per week they are one pair; with
// several, one line per option (the client chooses).
function readForm(form) {
  const single = form.options.length === 1
  const weeks = Number(form.weeks)
  let problem
  if (!form.name.trim()) problem = 'cat_err_name'
  else if (!/^\d+$/.test(form.weeks.trim()) || weeks < 1) problem = 'cat_err_weeks'
  else if (form.options.length === 0) problem = 'cat_err_options'
  else if (!isPriceText(form.perSession)) problem = 'cat_err_price'
  else problem = objectiveProblem(form.objective) || benefitsProblem(form.benefits)
  const valid = isPriceText(form.perSession) && weeks >= 1
  const perSessionNumber = valid ? priceFromText(form.perSession) : null
  const lines = valid ? form.options.map(perWeek => ({
    perWeek, sessions: weeks * perWeek, total: totalPrice(perSessionNumber, weeks * perWeek)
  })) : []
  return { single, problem, lines, perSessionNumber }
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
  const [deleting, setDeleting] = useState(null)       // the pack waiting for the confirmation to be excluded
  const [removingBenefit, setRemovingBenefit] = useState(null)   // index of the benefit waiting for the confirmation

  const view = readForm(form)
  const openNew = () => { setForm(EMPTY); setFormError(''); setEditing('new') }
  const openEdit = (pack) => { setForm(toForm(pack)); setFormError(''); setEditing(pack) }
  const set = (patch) => setForm(current => ({ ...current, ...patch }))
  const toggleOption = (value) => set({
    options: form.options.includes(value) ? form.options.filter(item => item !== value) : [...form.options, value].sort((a, b) => a - b)
  })
  const changed = () => { refreshPricing(); resource.reload() }
  const setBenefit = (index, text) => set({ benefits: form.benefits.map((item, at) => (at === index ? text : item)) })
  const removeBenefit = (index) => { set({ benefits: form.benefits.filter((_item, at) => at !== index) }); setRemovingBenefit(null) }

  const save = async () => {
    if (view.problem) { setFormError(t(view.problem)); return }
    const payload = {
      name: form.name.trim(),
      session_type: form.type,
      weeks: Number(form.weeks),
      sessions_per_week_options: form.options,
      price_per_session: priceFromText(form.perSession),
      price_per_pack: null,                     // there is no separate pack price: the total is worked out (sessions x price per session)
      objective: cleanObjective(form.objective),
      benefits: cleanBenefits(form.benefits)
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

  // Excluir pack: deleted for good when nobody used it; archived (clients keep their packs) when it is in use. The list is reloaded.
  const removePack = async (pack) => {
    setBusy(true)
    try {
      const result = await adminRequest('DELETE', `/admin/plans/${pack.id}`)
      toast.push(t(result?.outcome === 'archived' ? 'cat_delete_archived' : 'cat_deleted'))
      setDeleting(null)
      changed()
    } catch (error) {
      toast.push(error.message, 'error')
      setDeleting(null)
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
        actions={<Button variant="primary" onClick={openNew}><Icon name="bolt" className="h-4 w-4" /><Txt id="plans.new_pack" /></Button>}
      />

      {resource.error ? (
        <Card><ErrorState message={`${t('load_error')} (${resource.error})`} retryLabel={t('retry')} onRetry={resource.reload} /></Card>
      ) : resource.loading && !resource.data ? (
        <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-56" /><Skeleton className="h-56" /><Skeleton className="h-56" /></div>
      ) : (
        // the parts of the page can be moved and hidden (blocks: plans / main); the packs on sale are protected
        <BlockGroup pageKey="plans" groupKey="main" gap="mt-10" blocks={{
          on_sale: (cls) => (packs.length === 0 ? (
            <Card className={cls || undefined}><EmptyState icon="inbox" title={<Txt id="plans.empty" />} action={<Button variant="primary" onClick={openNew}><Txt id="plans.new_pack" /></Button>} /></Card>
          ) : (
            <ul className={`grid gap-4 md:grid-cols-2 xl:grid-cols-3 ${cls}`.trim()} aria-label={t('cat_on_sale')}>
              {onSale.map(pack => <PackCard key={pack.id} pack={pack} onEdit={() => openEdit(pack)} onArchive={() => setArchiving(pack)} onDelete={() => setDeleting(pack)} busy={busy} />)}
            </ul>
          )),
          archived: archived.length > 0 ? (cls) => (
            <section className={cls || undefined}>
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-400"><Txt id="plans.archived_title" /> ({archived.length})</h2>
              <p className="mb-4 max-w-2xl text-sm text-gray-500">{t('cat_archived_note')}</p>
              <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {archived.map(pack => <PackCard key={pack.id} pack={pack} onEdit={() => openEdit(pack)} onRestore={() => setArchived(pack, false)} onDelete={() => setDeleting(pack)} busy={busy} />)}
              </ul>
            </section>
          ) : null,
          trial_prices: (cls) => <TrialPrices prices={resource.data?.trial} onSaved={changed} className={cls} />
        }} />
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
        </div>
        <div className="md:col-span-2">
          <Field label={t('cat_objective')} hint={t('cat_objective_hint')}>
            <TextArea rows={2} value={form.objective} onChange={event => set({ objective: event.target.value })} maxLength={MAX_OBJECTIVE + 40}
              placeholder={t('cat_objective_ph')} disabled={busy} aria-invalid={objectiveProblem(form.objective) !== ''} />
            <span className={`mt-1 block text-right text-xs tabular-nums ${cleanObjective(form.objective).length > MAX_OBJECTIVE ? 'text-red-300' : 'text-gray-500'}`}>
              {t('cat_chars').replace('{n}', cleanObjective(form.objective).length).replace('{max}', MAX_OBJECTIVE)}
            </span>
          </Field>
        </div>
        <section className="mb-5" aria-labelledby="cat-benefits-label">
          <span id="cat-benefits-label" className="mb-2.5 block text-sm font-medium uppercase tracking-wider text-gray-400">{t('cat_benefits')}</span>
          <p className="mb-3 text-sm text-gray-500">{t('cat_benefits_hint').replace('{max}', MAX_BENEFITS)}</p>
          <ul className="space-y-3">
            {form.benefits.map((item, index) => (
              <li key={index} className="rounded-xl border border-white/10 p-3">
                <TextInput value={item} onChange={event => setBenefit(index, event.target.value)} maxLength={MAX_BENEFIT + 20}
                  placeholder={t('cat_benefit_ph')} aria-label={t('cat_benefit_n').replace('{n}', index + 1)} disabled={busy} />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`mr-auto text-xs tabular-nums ${cleanObjective(item).length > MAX_BENEFIT ? 'text-red-300' : 'text-gray-500'}`}>
                    {t('cat_chars').replace('{n}', cleanObjective(item).length).replace('{max}', MAX_BENEFIT)}
                  </span>
                  <Button variant="secondary" onClick={() => set({ benefits: moveItem(form.benefits, index, -1) })} disabled={busy || index === 0} aria-label={`${t('cat_benefit_up')}: ${t('cat_benefit_n').replace('{n}', index + 1)}`}>↑</Button>
                  <Button variant="secondary" onClick={() => set({ benefits: moveItem(form.benefits, index, 1) })} disabled={busy || index === form.benefits.length - 1} aria-label={`${t('cat_benefit_down')}: ${t('cat_benefit_n').replace('{n}', index + 1)}`}>↓</Button>
                  <Button variant="secondary" onClick={() => (item.trim() ? setRemovingBenefit(index) : removeBenefit(index))} disabled={busy} aria-label={`${t('cat_benefit_del')}: ${t('cat_benefit_n').replace('{n}', index + 1)}`}>{t('cat_benefit_del')}</Button>
                </div>
              </li>
            ))}
          </ul>
          <Button variant="secondary" className="mt-3" onClick={() => set({ benefits: [...form.benefits, ''] })} disabled={busy || form.benefits.length >= MAX_BENEFITS}>
            {t('cat_benefit_add')} ({form.benefits.length}/{MAX_BENEFITS})
          </Button>
        </section>
        <PackPreview form={form} view={view} />
        {formError && <p role="alert" className="rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{formError}</p>}
      </Drawer>

      <ConfirmDialog
        open={removingBenefit !== null} busy={busy}
        title={t('cat_benefit_del_title')} text={removingBenefit !== null ? `“${form.benefits[removingBenefit] || ''}” — ${t('cat_benefit_del_text')}` : ''}
        confirmLabel={t('cat_benefit_del')} cancelLabel={t('cancel')}
        onConfirm={() => removeBenefit(removingBenefit)} onCancel={() => setRemovingBenefit(null)}
      />

      <ConfirmDialog
        open={!!deleting} busy={busy}
        title={t('cat_delete_title')} text={deleting ? `${deleting.name} — ${t('cat_delete_text')}` : ''}
        confirmLabel={t('cat_delete')} cancelLabel={t('cancel')}
        onConfirm={() => removePack(deleting)} onCancel={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={!!archiving} busy={busy}
        title={t('cat_archive_title')} text={archiving ? `${archiving.name} — ${t('cat_archive_text')}` : ''}
        confirmLabel={t('cat_archive')} cancelLabel={t('cancel')}
        onConfirm={() => setArchived(archiving, true)} onCancel={() => setArchiving(null)}
      />
    </div>
  )
}

// The two figures the system works out (read-only) and a preview of the card the client will see, drawn from the form as it is typed.
function PackPreview({ form, view }) {
  const { t } = useAdminText()
  const weeks = Number(form.weeks)
  const first = view.lines[0]
  const benefits = cleanBenefits(form.benefits)
  const objective = cleanObjective(form.objective)
  return (
    <section className="mb-5 grid gap-4 md:grid-cols-2" aria-label={t('cat_preview_title')}>
      <div className="rounded-xl border border-white/10 p-4">
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-400">{t('cat_calc_title')}</h3>
        <dl className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-gray-400">{t('cat_calc_sessions')}</dt>
            <dd className="tabular-nums" data-testid="calc-sessions">{view.single && first ? first.sessions : '—'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-gray-400">{t('cat_calc_total')}</dt>
            <dd className="tabular-nums" data-testid="calc-total">{view.single && first && first.total != null ? formatMoney(first.total) : '—'}</dd>
          </div>
        </dl>
        {view.lines.length > 1 && (
          <ul className="mt-3 space-y-1 text-sm text-gray-300">
            {view.lines.map(line => (
              <li key={line.perWeek}>{t('cat_calc_line').replace('{n}', line.perWeek).replace('{sessions}', line.sessions).replace('{total}', formatMoney(line.total))}</li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-gray-500">{view.lines.length > 1 ? t('cat_calc_choice') : t('cat_calc_note')}</p>
      </div>
      <div className="rounded-xl border border-white/15 bg-white/[0.03] p-4">
        <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-gray-400">{t('cat_preview_title')}</h3>
        <p className="break-words text-lg font-semibold">{form.name.trim() || t('cat_preview_name')}</p>
        {weeks >= 1 && <p className="mt-1 text-sm text-gray-400">{t('cat_weeks_n').replace('{n}', weeks)}</p>}
        {objective && <p className="mt-2 break-words text-sm text-gray-300">{objective}</p>}
        <p className="mt-3 text-2xl font-semibold tabular-nums">{view.perSessionNumber != null ? formatMoney(view.perSessionNumber) : '—'} <span className="text-sm font-normal text-gray-400">{t('cat_price_session')}</span></p>
        {view.single && first && first.total != null && <p className="text-sm text-gray-400">{t('cat_calc_total')}: {formatMoney(first.total)}</p>}
        {benefits.length > 0 && (
          <>
            <p className="mt-3 text-xs uppercase tracking-wider text-gray-500">{t('cat_preview_incl')}</p>
            <ul className="mt-1 space-y-1 text-sm text-gray-200">
              {benefits.map((item, index) => <li key={index} className="flex gap-2"><span aria-hidden="true">✓</span><span className="break-words">{item}</span></li>)}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}

// 4 weeks = 1 month, 12 = 3 months, 24 = 6 months; any other number is just "N weeks"
function WeeksText({ weeks }) {
  const { t } = useAdminText()
  const months = monthsEquivalent(weeks)
  return <>{t('cat_weeks_n').replace('{n}', weeks)}{months ? ` = ${t(`cat_eq_${months}`)}` : ''}</>
}

function PackCard({ pack, onEdit, onArchive, onRestore, onDelete, busy = false }) {
  const { t } = useAdminText()
  const single = pack.sessions_per_week_options.length === 1
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
            <dt className="text-sm text-gray-400">{t('cat_calc_sessions')}</dt>
            <dd className="text-right tabular-nums">{single ? pack.total_sessions : <span className="text-sm text-gray-400">{t('cat_pack_by_choice')}</span>}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-gray-400">{t('cat_calc_total')}</dt>
            <dd className="text-right tabular-nums">{single ? formatMoney(pack.price_total) : <span className="text-sm text-gray-400">{t('cat_pack_by_choice')}</span>}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-sm text-gray-400">{t('cat_options')}</dt>
            <dd className="flex flex-wrap justify-end gap-1.5">
              {pack.sessions_per_week_options.map(value => <span key={value} className="rounded-full border border-white/10 px-2.5 py-0.5 text-sm text-gray-200">{value}</span>)}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onEdit}><Txt id="plans.edit" /></Button>
          {pack.active
            ? <Button variant="secondary" onClick={onArchive} aria-label={`${t('cat_archive')} ${pack.name}`}><Txt id="plans.archive" /></Button>
            : <Button variant="primary" onClick={onRestore} loading={busy} aria-label={`${t('cat_restore')} ${pack.name}`}><Txt id="plans.restore" /></Button>}
        </div>
        <button type="button" onClick={onDelete} disabled={busy} aria-label={`${t('cat_delete')}: ${pack.name}`}
          className="mt-3 w-full min-h-10 rounded-xl px-3 text-sm text-red-300 transition hover:bg-red-500/10 hover:text-red-200 disabled:opacity-40">
          {t('cat_delete')}
        </button>
      </Card>
    </li>
  )
}

// The price of a trial session, individual and dual (the trial form of the site reads them from the server).
function TrialPrices({ prices, onSaved, className = '' }) {
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
    <section className={className || undefined} aria-labelledby="cat-trial-title">
      <Card className="p-6">
        <h2 id="cat-trial-title" className="text-xl font-semibold"><Txt id="plans.trial_title" /></h2>
        <p className="mt-1 max-w-2xl text-sm text-gray-400">{t('cat_trial_sub')}</p>
        <div className="mt-5 grid gap-x-8 sm:grid-cols-2 lg:max-w-xl">
          {['individual', 'dual'].map(type => (
            <Field key={type} label={t(`cat_trial_${type}`)}>
              <TextInput inputMode="decimal" value={shown[type]} onChange={event => setDraft({ ...shown, [type]: event.target.value })} placeholder="0.00" disabled={busy} />
            </Field>
          ))}
        </div>
        {error && <p role="alert" className="mb-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
        <Button variant="primary" onClick={save} loading={busy} disabled={!draft}>{busy ? t('pl_saving') : <Txt id="plans.save_trial" />}</Button>
      </Card>
    </section>
  )
}
