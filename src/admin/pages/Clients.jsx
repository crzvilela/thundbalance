import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { adminRequest } from '../api'
import { resolveImageUrl } from '../../api/landingPage'
import { useAdminText } from '../useAdminText'
import { useAdminResource } from '../useAdminResource'
import { useToast } from '../toastContext'
import { dateKey, parseDateKey } from '../requests'
import { PackStatusBadge, PackSummary, RenewDrawer, TrainingCalendar } from '../PackPanel'
import AddClientDrawer from '../AddClientDrawer'
import BillingSection from '../BillingSection'
import { Tabs, TabPanel } from '../../components/admin/Tabs'
import DetailHeader, { MoreMenu } from '../../components/admin/DetailHeader'
import StatChip from '../../components/admin/StatChip'
import SectionCard from '../../components/admin/SectionCard'
import { formatPhone, toE164 } from '../../utils/validators'
import { ADMIN_EMAIL } from '../../config'
import { auth } from '../../firebase/auth'
import { ArchiveDialog, DeleteDialog } from '../ClientLifecycleDialogs'
import {
  Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Icon,
  PageHeader, SelectInput, Skeleton, TextInput
} from '../ui'

function initials(name) {
  return String(name || '?').split(' ').slice(0, 2).map(part => part[0]).join('').toUpperCase()
}

function Avatar({ client, size = 'h-12 w-12 text-base' }) {
  const photo = resolveImageUrl(client.photo)
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-emerald-400/25 to-emerald-700/10 font-semibold text-emerald-200`}>
      {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : initials(client.name)}
    </span>
  )
}

// The admin account and the account of whoever is signed in can not be archived
// or deleted (the server refuses them too; here the actions are just hidden).
function isProtectedAccount(email) {
  const value = String(email || '').trim().toLowerCase()
  return !!value && (value === ADMIN_EMAIL || value === String(auth.currentUser?.email || '').trim().toLowerCase())
}

function ProgressBar({ done, total }) {
  const percent = total ? Math.round((done / total) * 100) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all duration-700" style={{ width: `${percent}%` }} />
    </div>
  )
}

const TAB_IDS = ['resumen', 'sesiones', 'packs', 'datos', 'facturacion', 'actividad']
const TAB_PREFIX = 'client-file'

function Detail({ label, children, wide = false }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className="mt-1 break-words text-base text-white">{children || <span className="text-gray-500">—</span>}</dd>
    </div>
  )
}

function ClientDrawer({ clientId, plans, trainers, onClose, onChanged }) {
  const { t, language } = useAdminText()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const detail = useAdminResource(`/admin/clients/${clientId}`)
  const [planChoice, setPlanChoice] = useState('')
  const [saving, setSaving] = useState(false)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [renewing, setRenewing] = useState(false)
  const [resending, setResending] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [copyingLink, setCopyingLink] = useState(false)
  const [billingDirty, setBillingDirty] = useState(false)
  const [editingBilling, setEditingBilling] = useState(null)   // null = follow billing_missing
  const [showDocument, setShowDocument] = useState(false)
  const [pendingLeave, setPendingLeave] = useState(null)       // a tab id, or '__close'
  const [lifecycle, setLifecycle] = useState(null)             // 'archive' | 'delete'
  const [restoring, setRestoring] = useState(false)

  const client = detail.data
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const today = dateKey(new Date())
  const sessions = useMemo(() => client?.sessions || [], [client])
  const shownPacks = useMemo(() => (client?.packs || []).filter(pack => pack.shown), [client])
  const oldPacks = useMemo(() => (client?.packs || []).filter(pack => !pack.shown), [client])
  const fmtDate = (key, options = { day: 'numeric', month: 'short', year: 'numeric' }) => (key ? parseDateKey(key).toLocaleDateString(locale, options) : '—')

  const groups = useMemo(() => {
    const fmt = (key) => (key ? parseDateKey(key).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
    const result = []
    for (const pack of client?.packs || []) {
      const own = sessions.filter(session => session.pack_id === pack.id)
      if (own.length) result.push({ key: `pack-${pack.id}`, title: pack.name, subtitle: `${fmt(pack.start_date)} → ${fmt(pack.end_date)}${pack.sessions_per_week ? ` · ${pack.sessions_per_week}/${t('pk_per_week').toLowerCase()}` : ''}`, sessions: own })
    }
    const loose = sessions.filter(session => !session.pack_id)
    if (loose.length) result.push({ key: 'none', title: t('pk_group_none'), subtitle: '', sessions: loose })
    return result
  }, [client, sessions, language, t])
  const active = sessions.filter(session => session.status !== 'Cancelled')
  const done = active.filter(session => session.date < today).length
  const upcoming = active.filter(session => session.date >= today).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
  const nextSession = upcoming[0] || null
  const lastSession = active.filter(session => session.date < today).sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0] || null
  const failedSync = sessions.filter(session => session.calendar_sync_status === 'failed').length
  const okSync = sessions.filter(session => session.calendar_sync_status === 'ok').length
  const pendingSync = sessions.filter(session => session.calendar_sync_status === 'pending').length

  // ---------------------------------------------------------------- tabs
  const hasActivity = !!client && (client.calendar_feed_generated || client.must_change_password || failedSync + okSync + pendingSync > 0)
  const tabs = useMemo(() => {
    const list = [
      { id: 'resumen', label: t('fx_tab_summary'), icon: 'overview' },
      { id: 'sesiones', label: t('fx_tab_sessions'), icon: 'calendar' },
      { id: 'packs', label: t('fx_tab_packs'), icon: 'bolt' },
      { id: 'datos', label: t('fx_tab_personal'), icon: 'clients' },
      { id: 'facturacion', label: t('fx_tab_billing'), icon: 'doc', alert: !!client?.billing_missing },
    ]
    if (hasActivity) list.push({ id: 'actividad', label: t('fx_tab_activity'), icon: 'pulse', alert: failedSync > 0 })
    return list
  }, [t, client, hasActivity, failedSync])
  const requested = searchParams.get('tab')
  const activeTab = TAB_IDS.includes(requested) && tabs.some(tab => tab.id === requested) ? requested : 'resumen'

  const applyTab = (id) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      if (id === 'resumen') next.delete('tab')
      else next.set('tab', id)
      return next
    }, { replace: true })
  }
  const goTab = (id) => {
    if (id === activeTab) return
    if (billingDirty) setPendingLeave(id)
    else applyTab(id)
  }
  const requestClose = () => {
    if (billingDirty) setPendingLeave('__close')
    else onClose()
  }
  const confirmLeave = () => {
    const target = pendingLeave
    setPendingLeave(null)
    setBillingDirty(false)
    if (target === '__close') onClose()
    else if (target) applyTab(target)
  }
  const editing = editingBilling ?? !!client?.billing_missing

  // ------------------------------------------------------------- actions
  const assign = async () => {
    setSaving(true)
    try {
      await adminRequest('POST', '/admin/assign-plan', { user_id: clientId, plan_id: Number(planChoice) })
      toast.push(t('cl_plan_saved'))
      setPlanChoice('')
      detail.reload()
      onChanged()
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const copyCalendarLink = async () => {
    setCopyingLink(true)
    try {
      // creates the link on first use; the panel shows "generated" afterwards
      const links = await adminRequest('GET', `/admin/clients/${clientId}/calendar-feed`)
      // the same link as the email button: opens Google Calendar ready to subscribe
      await navigator.clipboard.writeText(links.google)
      toast.push(t('cal_copied'))
      detail.reload()
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setCopyingLink(false)
    }
  }

  const resend = async () => {
    setResending(true)
    try {
      const result = await adminRequest('POST', `/admin/clients/${clientId}/resend-credentials`)
      if (result.email?.sent) toast.push(`${t('cc_resent')} ${client.email}`)
      else toast.push(t('cc_email_failed'), 'warning')
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setResending(false)
    }
  }

  const syncCalendar = async () => {
    setSyncing(true)
    try {
      const result = await adminRequest('POST', `/admin/clients/${clientId}/sync-calendar`)
      if (!result.created && !result.updated && !result.failed) {
        toast.push(t('cs_nothing'))
      } else {
        // created, updated and failed are always shown; the first reason helps when something failed
        const reason = result.failed && result.errors?.[0] ? ` (${result.errors[0]})` : ''
        toast.push(
          `${t('cs_created')}: ${result.created} · ${t('cs_updated')}: ${result.updated} · ${t('cs_failed')}: ${result.failed}${reason}`,
          result.failed ? 'warning' : 'success'
        )
      }
      detail.reload()
      onChanged()
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setSyncing(false)
    }
  }

  const cancelSession = async () => {
    setCancelling(true)
    try {
      await adminRequest('POST', `/admin/sessions/${cancelTarget.id}/cancel`)
      toast.push(t('cl_cancelled_ok'))
      setCancelTarget(null)
      detail.reload()
      onChanged()
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setCancelling(false)
    }
  }

  const copyPhone = async () => {
    try {
      await navigator.clipboard.writeText(formatPhone(client.phone, client.country_code))
      toast.push(t('fx_copied'))
    } catch {
      toast.push(t('action_error'), 'error')
    }
  }

  // ------------------------------------------------------------- pieces
  const phoneText = client?.phone ? formatPhone(client.phone, client.country_code) : ''
  const mainPack = client?.pack || null
  const meta = client && (
    <>
      <a href={`mailto:${client.email}`} className="inline-flex min-h-[32px] items-center truncate hover:text-emerald-300">{client.email}</a>
      {phoneText && (
        <span className="inline-flex items-center gap-1">
          <a href={`tel:${toE164(client.phone, client.country_code)}`} className="inline-flex min-h-[32px] items-center hover:text-emerald-300">{phoneText}</a>
          <button type="button" onClick={copyPhone} aria-label={`${t('fx_copy')}: ${phoneText}`} title={t('fx_copy')}
            className="rounded-lg p-1.5 text-gray-500 transition hover:bg-white/10 hover:text-white"><Icon name="copy" className="h-4 w-4" /></button>
        </span>
      )}
      {client.city && <span>{client.city}</span>}
    </>
  )
  // declared before `badges` and `menuItems`, which read them
  const archivedClient = !!client?.archived_at
  const protectedClient = isProtectedAccount(client?.email)
  const badges = client && (
    <>
      {archivedClient && <Badge tone="amber">{t('lc_archived_badge')}</Badge>}
      {mainPack ? <Badge tone="emerald">{mainPack.name}</Badge> : <Badge>{t('cl_no_plan')}</Badge>}
      {client.billing_missing && <Badge tone="amber">{t('bl_missing')}</Badge>}
      {client.must_change_password && <Badge tone="amber">{t('fx_temp_badge')}</Badge>}
    </>
  )
  const chips = client && (
    <>
      <StatChip label={t('cl_sessions')} value={`${done}/${active.length}`} tone="emerald" />
      <StatChip label={t('fx_next_session')} value={nextSession ? `${fmtDate(nextSession.date, { day: 'numeric', month: 'short' })} · ${nextSession.time}` : t('cl_no_next')} />
      <StatChip label={t('fx_active_pack')} value={mainPack ? `${mainPack.remaining} ${t('pk_left')}` : t('fx_none')} />
      <StatChip label={t('fx_last_session')} value={lastSession ? fmtDate(lastSession.date, { day: 'numeric', month: 'short' }) : t('fx_none')} />
    </>
  )
  const restore = async () => {
    setRestoring(true)
    try {
      await adminRequest('POST', `/admin/clients/${clientId}/unarchive`)
      toast.push(t('lc_unarchived_ok'))
      detail.reload()
      onChanged()
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setRestoring(false)
    }
  }
  const menuItems = client ? [
    { label: t('fx_edit_data'), icon: 'clients', onClick: () => goTab('datos') },
    { label: t('cc_resend'), icon: 'refresh', onClick: resend, disabled: resending, hidden: !client.must_change_password },
    { label: syncing ? t('cs_syncing') : t('cs_button'), icon: 'calendar', onClick: syncCalendar, disabled: syncing },
    { label: t('cal_copy'), icon: 'copy', onClick: copyCalendarLink, disabled: copyingLink },
    { label: t('lc_archive_menu'), icon: 'archive', onClick: () => setLifecycle('archive'), hidden: archivedClient || protectedClient },
    { label: t('lc_unarchive'), icon: 'refresh', onClick: restore, disabled: restoring, hidden: !archivedClient || protectedClient },
    { label: t('lc_delete_menu'), icon: 'alert', onClick: () => setLifecycle('delete'), danger: true, hidden: protectedClient },
  ] : []
  const actions = client && (
    <>
      <Button variant={shownPacks.length === 0 || shownPacks.every(pack => pack.status === 'expired' || pack.status === 'expiring') ? 'primary' : 'secondary'} onClick={() => setRenewing(true)}>
        {t('fx_renew')}
      </Button>
      <MoreMenu items={menuItems} label={t('fx_more')} />
    </>
  )

  const sessionList = (
    sessions.length === 0 ? (
      <EmptyState icon="calendar" title={t('cl_no_sessions')} />
    ) : (
      <div className="space-y-5">
        {groups.map(group => (
          <div key={group.key}>
            <p className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm font-medium text-gray-300">
              <span>{group.title}</span>
              <span className="text-xs font-normal text-gray-500">{group.subtitle}</span>
            </p>
            <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.08] bg-white/[0.02]">
              {group.sessions.map(session => {
                const cancelled = session.status === 'Cancelled'
                const past = session.date < today
                return (
                  <li key={session.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5 sm:py-4 ${cancelled || past ? 'opacity-60' : ''}`}>
                    <span className="w-10 text-sm tabular-nums text-gray-500 sm:w-14">{session.number || ''}</span>
                    <span className="min-w-0 flex-1 basis-40">
                      <span className="block text-base font-medium">{parseDateKey(session.date).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      <span className="block text-sm text-gray-500">{session.time} · {session.trainer || '—'}</span>
                    </span>
                    {session.calendar_sync_status === 'failed' && (
                      <span className="flex items-center gap-1 text-amber-300" title={`${t('cs_session_warning')}: ${session.calendar_sync_error || ''}`} aria-label={t('cs_session_warning')}>
                        <Icon name="alert" className="h-4 w-4" />
                      </span>
                    )}
                    <Badge tone={cancelled ? 'red' : past ? 'neutral' : 'emerald'}>{cancelled ? t('st_cancelled') : t('st_booked')}</Badge>
                    {!cancelled && !past && (
                      <button type="button" onClick={() => setCancelTarget(session)} className="min-h-[44px] rounded-lg px-3 py-1.5 text-sm text-red-300 transition hover:bg-red-500/15">{t('cl_cancel_session')}</button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    )
  )

  const documentText = client?.tax_id
    ? (showDocument ? `${client.tax_id_type ? `${client.tax_id_type} ` : ''}${client.tax_id}` : `••••${String(client.tax_id).slice(-4)}`)
    : ''

  return (
    <>
      <Drawer open onClose={requestClose} size="lg" headerless title={client?.name || '…'}>
        {detail.error ? (
          <div className="p-6 sm:p-10">
            <ErrorState message={`${t('cl_detail_error')} (${detail.error})`} retryLabel={t('retry')} onRetry={detail.reload} />
          </div>
        ) : !client ? (
          <div className="space-y-4 p-6 sm:p-10"><Skeleton className="h-20" /><Skeleton className="h-12" /><Skeleton className="h-40" /></div>
        ) : (
          <>
            <div className="sticky top-0 z-10">
              <DetailHeader
                avatar={<Avatar client={client} size="h-12 w-12 text-base sm:h-16 sm:w-16 sm:text-xl" />}
                title={client.name} meta={meta} badges={badges} chips={chips} actions={actions}
                onClose={requestClose} closeLabel={t('fx_close')}
              />
              <Tabs tabs={tabs} value={activeTab} onChange={goTab} label={t('fx_tabs')} idPrefix={TAB_PREFIX}
                className="border-b border-white/10 bg-[#0b0e0d] px-2 sm:px-6" />
            </div>

            <div className="px-4 py-6 sm:px-8 sm:py-8">
              <TabPanel id="resumen" idPrefix={TAB_PREFIX} active={activeTab === 'resumen'}>
                <div className="grid gap-5 lg:grid-cols-2">
                  <SectionCard title={t('fx_next_session')}>
                    {nextSession ? (
                      <>
                        <p className="text-2xl font-semibold">{fmtDate(nextSession.date, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                        <p className="mt-1 text-gray-400">{nextSession.time} · {nextSession.trainer || '—'}</p>
                      </>
                    ) : <p className="text-gray-400">{t('cl_no_next')}</p>}
                  </SectionCard>
                  <SectionCard title={t('cl_progress')}>
                    <div className="mb-3 flex items-end justify-between">
                      <p className="text-5xl font-semibold tabular-nums">{done}<span className="text-2xl text-gray-500">/{active.length}</span></p>
                      <p className="text-sm text-gray-500">{done} {t('cl_completed')} · {active.length - done} {t('cl_upcoming')}</p>
                    </div>
                    <ProgressBar done={done} total={active.length} />
                  </SectionCard>

                  {client.must_change_password && (
                    <SectionCard title={t('cc_temp_title')} tone="amber" className="lg:col-span-2">
                      <p className="mb-3 text-sm text-gray-300">{t('cc_temp_text')}</p>
                      <Button variant="secondary" onClick={resend} loading={resending}>{resending ? t('cc_resending') : t('cc_resend')}</Button>
                    </SectionCard>
                  )}
                  {client.billing_missing && (
                    <SectionCard title={t('bl_missing')} tone="amber" className="lg:col-span-2">
                      <p className="mb-3 text-sm text-gray-300">{t('bl_missing_text')}</p>
                      <Button variant="secondary" onClick={() => goTab('facturacion')}>{t('fx_go_billing')}</Button>
                    </SectionCard>
                  )}

                  <SectionCard title={t('cl_contact')} className="sm:hidden">
                    <dl className="grid gap-4">
                      <Detail label={t('fx_email')}><a href={`mailto:${client.email}`} className="hover:text-emerald-300">{client.email}</a></Detail>
                      <Detail label={t('cl_phone')}>{phoneText && <a href={`tel:${toE164(client.phone, client.country_code)}`} className="hover:text-emerald-300">{phoneText}</a>}</Detail>
                      <Detail label={t('fx_city')}>{client.city}</Detail>
                    </dl>
                  </SectionCard>

                  <SectionCard title={t('fx_shortcuts')} className="lg:col-span-2">
                    <div className="flex flex-wrap gap-3">
                      <Button variant="secondary" onClick={() => goTab('sesiones')}><Icon name="calendar" className="h-4 w-4" />{t('fx_go_sessions')}</Button>
                      <Button variant="secondary" onClick={() => goTab('packs')}><Icon name="bolt" className="h-4 w-4" />{t('fx_go_packs')}</Button>
                      <Button variant="secondary" onClick={() => goTab('facturacion')}><Icon name="doc" className="h-4 w-4" />{t('fx_go_billing')}</Button>
                    </div>
                  </SectionCard>
                </div>
              </TabPanel>

              <TabPanel id="sesiones" idPrefix={TAB_PREFIX} active={activeTab === 'sesiones'}>
                <div className="grid gap-6 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                  <div><TrainingCalendar sessions={sessions} /></div>
                  <section>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-sm font-medium uppercase tracking-wider text-gray-400">{t('cl_sessions_title')} ({sessions.length})</h3>
                      <Button variant="secondary" onClick={syncCalendar} loading={syncing} title={t('cs_hint')}>
                        <Icon name="refresh" className="h-4 w-4" />{syncing ? t('cs_syncing') : t('cs_button')}
                      </Button>
                    </div>
                    {sessionList}
                  </section>
                </div>
              </TabPanel>

              <TabPanel id="packs" idPrefix={TAB_PREFIX} active={activeTab === 'packs'}>
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-6">
                    <PackSummary packs={shownPacks} onRenew={() => setRenewing(true)} />
                    {oldPacks.length > 0 && (
                      <SectionCard title={`${t('fx_history')} (${oldPacks.length})`} collapsible defaultOpen={false}>
                        <ul className="space-y-2">
                          {oldPacks.map(pack => (
                            <li key={pack.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] px-4 py-3">
                              <span>
                                <span className="block font-medium">{pack.name}</span>
                                <span className="block text-sm text-gray-500">{fmtDate(pack.start_date)} → {fmtDate(pack.end_date)}</span>
                              </span>
                              <span className="text-sm text-gray-400">{pack.done} {t('pk_done')}</span>
                            </li>
                          ))}
                        </ul>
                      </SectionCard>
                    )}
                  </div>
                  <SectionCard title={t('cl_assign')}>
                    <div className="flex gap-3">
                      <SelectInput value={planChoice} onChange={event => setPlanChoice(event.target.value)} disabled={saving} aria-label={t('cl_assign')}>
                        <option value="">{t('cl_assign_ph')}</option>
                        {plans.map(plan => <option key={plan[0]} value={plan[0]}>{plan[1]}</option>)}
                      </SelectInput>
                      <Button variant="primary" onClick={assign} disabled={!planChoice} loading={saving} className="shrink-0">{t('cl_assign_save')}</Button>
                    </div>
                  </SectionCard>
                </div>
              </TabPanel>

              <TabPanel id="datos" idPrefix={TAB_PREFIX} active={activeTab === 'datos'}>
                <SectionCard title={t('fx_tab_personal')}
                  actions={<Button variant="secondary" onClick={() => { setEditingBilling(true); goTab('facturacion') }}>{t('fx_edit_address')}</Button>}>
                  <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                    <Detail label={t('cc_name')}>{client.name}</Detail>
                    <Detail label={t('fx_email')}><a href={`mailto:${client.email}`} className="hover:text-emerald-300">{client.email}</a></Detail>
                    <Detail label={t('cl_phone')}>{phoneText && <a href={`tel:${toE164(client.phone, client.country_code)}`} className="hover:text-emerald-300">{phoneText}</a>}</Detail>
                    <Detail label={t('fx_city')}>{client.city}</Detail>
                    <Detail label={t('fx_address')} wide>{client.address}</Detail>
                    <Detail label={t('fx_postal')}>{client.postal_code}</Detail>
                    <Detail label={t('fx_country')}>{client.country}</Detail>
                  </dl>
                  <p className="mt-5 text-sm text-gray-500">{t('fx_personal_hint')}</p>
                </SectionCard>
              </TabPanel>

              <TabPanel id="facturacion" idPrefix={TAB_PREFIX} active={activeTab === 'facturacion'}>
                <div className="space-y-5">
                  <SectionCard title={t('bl_title')}
                    actions={<div className="flex items-center gap-2">
                      {client.billing_missing && <Badge tone="amber">{t('bl_missing')}</Badge>}
                      {!editing && <Button variant="secondary" onClick={() => setEditingBilling(true)}>{t('fx_edit')}</Button>}
                    </div>}>
                    {editing ? (
                      <BillingSection
                        key={`${client.id}-${client.tax_id || ''}-${client.address || ''}-${client.country || ''}`}
                        client={client} bare onDirtyChange={setBillingDirty}
                        onSaved={() => { setEditingBilling(false); detail.reload(); onChanged() }}
                      />
                    ) : (
                      <>
                        {client.billing_missing && <p className="mb-4 text-sm text-amber-200">{t('bl_missing_text')}</p>}
                        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                          <Detail label={t('fx_billing_doc')} wide>
                            {documentText && (
                              <span className="inline-flex flex-wrap items-center gap-3">
                                <span className="tabular-nums">{documentText}</span>
                                <button type="button" onClick={() => setShowDocument(value => !value)} aria-pressed={showDocument}
                                  className="min-h-[32px] rounded-lg px-2 text-sm text-emerald-300 transition hover:bg-white/10">
                                  {showDocument ? t('fx_hide') : t('fx_show')}
                                </button>
                              </span>
                            )}
                          </Detail>
                          <Detail label={t('fx_address')} wide>{client.address}</Detail>
                          <Detail label={t('fx_postal')}>{client.postal_code}</Detail>
                          <Detail label={t('fx_city')}>{client.city}</Detail>
                          <Detail label={t('fx_country')}>{client.country}</Detail>
                        </dl>
                      </>
                    )}
                  </SectionCard>
                </div>
              </TabPanel>

              <TabPanel id="actividad" idPrefix={TAB_PREFIX} active={activeTab === 'actividad'}>
                <SectionCard title={t('fx_tab_activity')}>
                  <ul className="space-y-3 text-base">
                    <li className="flex items-center gap-3"><Icon name="calendar" className="h-4 w-4 text-gray-500" />{client.calendar_feed_generated ? t('fx_act_calendar_on') : t('fx_act_calendar_off')}</li>
                    {okSync > 0 && <li className="flex items-center gap-3 text-emerald-300"><Icon name="check" className="h-4 w-4" />{okSync} {t('fx_act_synced')}</li>}
                    {pendingSync > 0 && <li className="flex items-center gap-3 text-gray-300"><Icon name="clock" className="h-4 w-4" />{pendingSync} {t('fx_act_pending')}</li>}
                    {failedSync > 0 && <li className="flex items-center gap-3 text-amber-300"><Icon name="alert" className="h-4 w-4" />{failedSync} {t('fx_act_failed')}</li>}
                    {client.must_change_password && <li className="flex items-center gap-3 text-amber-200"><Icon name="alert" className="h-4 w-4" />{t('fx_act_temp')}</li>}
                  </ul>
                </SectionCard>
              </TabPanel>
            </div>
          </>
        )}
      </Drawer>
      {renewing && client && (
        <RenewDrawer
          client={client} pack={client.pack} plans={plans} trainers={trainers}
          onClose={() => setRenewing(false)}
          onDone={() => { setRenewing(false); detail.reload(); onChanged() }}
        />
      )}
      <ConfirmDialog
        open={!!cancelTarget} busy={cancelling}
        title={t('cl_cancel_title')} text={t('cl_cancel_text')}
        confirmLabel={t('cl_cancel_do')} cancelLabel={t('cl_cancel_keep')}
        onConfirm={cancelSession} onCancel={() => setCancelTarget(null)}
      />
      {lifecycle === 'archive' && client && (
        <ArchiveDialog
          client={client} futureSessions={upcoming.length}
          onClose={() => setLifecycle(null)}
          onDone={() => { setLifecycle(null); onChanged(); onClose() }}
        />
      )}
      {lifecycle === 'delete' && client && (
        <DeleteDialog
          client={client}
          onClose={() => setLifecycle(null)}
          onDone={() => { setLifecycle(null); onChanged(); onClose() }}
        />
      )}
      <ConfirmDialog
        open={!!pendingLeave} tone="neutral"
        title={t('fx_unsaved_title')} text={t('fx_unsaved')}
        confirmLabel={t('fx_unsaved_leave')} cancelLabel={t('fx_unsaved_stay')}
        onConfirm={confirmLeave} onCancel={() => setPendingLeave(null)}
      />
    </>
  )
}

export default function Clients() {
  const { t, language } = useAdminText()
  const clientsResource = useAdminResource('/admin/clients')
  // Archived clients are left out of the normal list; this one has only them.
  const archivedResource = useAdminResource('/admin/clients?archived=only')
  const plansResource = useAdminResource('/plans')
  const trainersResource = useAdminResource('/admin/trainer-availability')
  const [query, setQuery] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const [filter, setFilter] = useState(() => (['with_plan', 'no_plan', 'pending', 'renew', 'archived'].includes(searchParams.get('filter')) ? searchParams.get('filter') : 'all'))
  const toast = useToast()
  const [lifecycle, setLifecycle] = useState(null)             // the client being archived
  const reloadAll = () => { clientsResource.reload(); archivedResource.reload() }
  const restoreClient = async (client) => {
    try {
      await adminRequest('POST', `/admin/clients/${client.id}/unarchive`)
      toast.push(t('lc_unarchived_ok'))
      reloadAll()
    } catch (error) {
      toast.push(error.message, 'error')
    }
  }
  // the open file lives in the URL (?client=ID&tab=sesiones): reload and back keep it
  const selectedId = Number(searchParams.get('client')) || null
  const setSelectedId = (id) => setSearchParams(previous => {
    const next = new URLSearchParams(previous)
    next.delete('tab')                      // another client always opens on Resumen
    if (id) next.set('client', String(id))
    else next.delete('client')
    return next
  })
  const [adding, setAdding] = useState(false)

  const activeClients = useMemo(() => clientsResource.data || [], [clientsResource.data])
  const archivedClients = useMemo(() => archivedResource.data || [], [archivedResource.data])
  const clients = filter === 'archived' ? archivedClients : activeClients
  const plans = useMemo(() => plansResource.data || [], [plansResource.data])
  const trainers = useMemo(() => (Array.isArray(trainersResource.data) ? trainersResource.data : []), [trainersResource.data])
  const locale = language === 'es' ? 'es-ES' : 'en-GB'

  const counts = useMemo(() => ({
    all: activeClients.length,
    with_plan: activeClients.filter(client => client.plan).length,
    no_plan: activeClients.filter(client => !client.plan).length,
    pending: activeClients.filter(client => client.has_pending_request).length,
    renew: activeClients.filter(client => client.pack_status === 'expired' || client.pack_status === 'expiring').length,
    archived: archivedClients.length
  }), [activeClients, archivedClients])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return clients.filter(client => {
      if (filter === 'with_plan' && !client.plan) return false
      if (filter === 'no_plan' && client.plan) return false
      if (filter === 'pending' && !client.has_pending_request) return false
      if (filter === 'renew' && client.pack_status !== 'expired' && client.pack_status !== 'expiring') return false
      return !needle || `${client.name} ${client.email}`.toLowerCase().includes(needle)
    })
  }, [clients, filter, query])

  const filters = [['all', t('cl_all')], ['with_plan', t('cl_with_plan')], ['no_plan', t('cl_no_plan_filter')], ['pending', t('cl_pending')], ['renew', t('biz_to_renew')], ['archived', t('lc_archived_filter')]]

  return (
    <div className="admin-fade">
      <PageHeader
        title={t('clients_title')} subtitle={t('clients_sub')}
        actions={<>
          <Button variant="secondary" onClick={reloadAll}><Icon name="refresh" className="h-4 w-4" />{t('refresh')}</Button>
          <Button variant="primary" onClick={() => setAdding(true)}><Icon name="plus" className="h-4 w-4" />{t('cc_add')}</Button>
        </>}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist">
          {filters.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${
                filter === key ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-gray-400 hover:border-white/25 hover:text-white'
              }`}>
              {label}
              <span className={`rounded-full px-1.5 text-xs tabular-nums ${filter === key ? 'bg-emerald-400/20' : 'bg-white/10'}`}>{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <TextInput value={query} onChange={event => setQuery(event.target.value)} placeholder={t('cl_search')} aria-label={t('cl_search')} className="!pl-10" />
        </div>
      </div>

      {clientsResource.error ? (
        <Card><ErrorState message={`${t('load_error')} (${clientsResource.error})`} retryLabel={t('retry')} onRetry={clientsResource.reload} /></Card>
      ) : clientsResource.loading && !clientsResource.data ? (
        <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
      ) : visible.length === 0 ? (
        <Card><EmptyState icon="clients" title={clients.length ? t('cl_empty') : filter === 'archived' ? t('lc_none_archived') : t('cl_none')} /></Card>
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2">
          {visible.map(client => (
            <li key={client.id} className="relative min-w-0">
              <button type="button" onClick={() => setSelectedId(client.id)} className="block w-full rounded-2xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400">
                <Card className="group p-5 pr-16 transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400/30">
                  <div className="flex items-center gap-4">
                    <Avatar client={client} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold">{client.name}</p>
                        {client.has_pending_request && <Badge tone="amber">{t('cl_pending')}</Badge>}
                        {(client.pack_status === 'expired' || client.pack_status === 'expiring') && <PackStatusBadge status={client.pack_status} />}
                      </div>
                      <p className="truncate text-sm text-gray-500">{client.email}{client.tax_id_masked ? ` · ${client.tax_id_masked}` : ''}</p>
                      {client.billing_missing && <p className="mt-1.5"><Badge tone="amber">{t('bl_missing')}</Badge></p>}
                    </div>
                    {client.archived_at ? <Badge tone="amber">{t('lc_archived_badge')}</Badge>
                      : client.plan ? <Badge tone="emerald">{client.plan}</Badge> : <Badge>{t('cl_no_plan')}</Badge>}
                  </div>
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                      <span>{client.completed}/{client.total} {t('cl_sessions')}</span>
                      <span>{t('cl_next')}: <span className="text-gray-300">{client.next_session ? parseDateKey(client.next_session).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : t('cl_no_next')}</span></span>
                    </div>
                    <ProgressBar done={client.completed} total={client.total} />
                  </div>
                </Card>
              </button>
              {!isProtectedAccount(client.email) && (
                <div className="absolute right-3 top-3">
                  <MoreMenu label={t('fx_more')} items={[
                    client.archived_at
                      ? { label: t('lc_unarchive'), icon: 'refresh', onClick: () => restoreClient(client) }
                      : { label: t('lc_archive_menu'), icon: 'archive', onClick: () => setLifecycle(client) }
                  ]} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <AddClientDrawer
          plans={plans} trainers={trainers}
          onClose={() => setAdding(false)} onCreated={() => reloadAll()}
        />
      )}

      {selectedId && (
        <ClientDrawer
          key={selectedId} clientId={selectedId} plans={plans} trainers={trainers}
          onClose={() => setSelectedId(null)} onChanged={reloadAll}
        />
      )}

      {lifecycle && (
        <ArchiveDialog
          client={lifecycle} futureSessions={lifecycle.upcoming || 0}
          onClose={() => setLifecycle(null)}
          onDone={() => { setLifecycle(null); reloadAll() }}
        />
      )}
    </div>
  )
}
