import Txt from '../Txt'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { adminRequest } from '../api'
import { useAdminText } from '../useAdminText'
import { useFeatures } from '../../api/features'
import { useAdminResource } from '../useAdminResource'
import { useToast } from '../toastContext'
import { dateKey, parseDateKey } from '../requests'
import { formatMoney } from '../../utils/pricing'
import { NewPackDrawer, TrainingCalendar } from '../PackPanel'
import { ClientAvatar, ClientRow } from '../ClientRows'
import { TypeBadge } from '../SessionKind'
import PackHistory from '../PackHistory'
import AddClientDrawer from '../AddClientDrawer'
import BillingSection from '../BillingSection'
import { Tabs, TabPanel } from '../../components/admin/Tabs'
import DetailHeader, { MoreMenu } from '../../components/admin/DetailHeader'
import SectionCard from '../../components/admin/SectionCard'
import { formatPhone, toE164 } from '../../utils/validators'
import { ADMIN_EMAIL } from '../../config'
import { auth } from '../../firebase/auth'
import { ArchiveDialog, DeleteDialog } from '../ClientLifecycleDialogs'
import { downloadClientExport } from '../privacyApi'
import { BulkBar, RowCheck, SelectAllRow } from '../BulkBar'
import RestoreSessionDialog from '../RestoreSessionDialog'
import { useBulkSelection, SELECTING_CLASS, selectableProps } from '../bulk'
import {
  Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Icon,
  PageHeader, Skeleton, TextInput
} from '../ui'

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

const TAB_IDS = ['resumen', 'packs', 'sesiones', 'datos', 'facturacion']
// links and bookmarks from before the tabs were merged: the history lives in Packs, the activity in Resumen
const LEGACY_TABS = { historial: 'packs', actividad: 'resumen' }
const TAB_PREFIX = 'client-file'
const sessionKey = session => session.id

function Detail({ label, children, wide = false }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className="mt-1 break-words text-base text-white">{children || <span className="text-gray-500">—</span>}</dd>
    </div>
  )
}

function ClientDrawer({ clientId, packs, onClose, onChanged }) {
  const { t, language } = useAdminText()
  const toast = useToast()
  const { clientCalendar } = useFeatures()      // CLIENT_CALENDAR_ENABLED: the client's calendar link and state
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const detail = useAdminResource(`/admin/clients/${clientId}`)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState(null)          // a cancelled session being restored
  // a link from the list (the "···" menu of a row) can ask for an action: the dialogs open when the file has loaded
  const [creatingPack, setCreatingPack] = useState(() => searchParams.get('action') === 'newpack')
  const [resending, setResending] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [copyingLink, setCopyingLink] = useState(false)
  const [billingDirty, setBillingDirty] = useState(false)
  const [editingBilling, setEditingBilling] = useState(null)   // null = follow billing_missing
  const [showDocument, setShowDocument] = useState(false)
  const [pendingLeave, setPendingLeave] = useState(null)       // a tab id, or '__close'
  const [lifecycle, setLifecycle] = useState(() => (['archive', 'delete'].includes(searchParams.get('action')) ? searchParams.get('action') : null))   // 'archive' | 'delete'
  const [restoring, setRestoring] = useState(false)

  const client = detail.data
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const today = dateKey(new Date())
  const sessions = useMemo(() => client?.sessions || [], [client])
  const shownPacks = useMemo(() => (client?.packs || []).filter(pack => pack.shown), [client])
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
  const canCancelSession = useCallback(session => session.status !== 'Cancelled' && session.date >= today, [today])     // what the server can still cancel
  const sessionSelection = useBulkSelection(sessions, sessionKey, canCancelSession)
  const nextSession = upcoming[0] || null
  const lastSession = active.filter(session => session.date < today).sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))[0] || null
  const failedSync = sessions.filter(session => session.calendar_sync_status === 'failed').length
  const okSync = sessions.filter(session => session.calendar_sync_status === 'ok').length
  const pendingSync = sessions.filter(session => session.calendar_sync_status === 'pending').length

  // what the invoices still need; the warning lives in the Facturación tab only (and a dot on its name)
  const billingMissing = client ? [!client.tax_id && 'doc', !client.address && 'address', !client.country && 'country'].filter(Boolean) : []

  // ---------------------------------------------------------------- tabs
  // Resumen, Packs (the active ones first, then the history), Sesiones, Datos, Billing. The state of the calendar sync, which
  // used to have a tab of its own, is a card of Resumen.
  const hasActivity = !!client && ((clientCalendar && client.calendar_feed_generated) || failedSync + okSync + pendingSync > 0)
  const tabs = useMemo(() => [
    { id: 'resumen', label: t('fx_tab_summary'), icon: 'overview', alert: failedSync > 0, alertLabel: t('cs_session_warning') },
    { id: 'packs', label: t('fx_tab_packs'), icon: 'bolt' },
    { id: 'sesiones', label: t('fx_tab_sessions'), icon: 'calendar' },
    { id: 'datos', label: t('fx_tab_personal'), icon: 'clients' },
    { id: 'facturacion', label: t('fx_tab_billing'), icon: 'doc', alert: billingMissing.length > 0, alertLabel: t('bl_missing') },
  ], [t, failedSync, billingMissing.length])
  const requested = LEGACY_TABS[searchParams.get('tab')] || searchParams.get('tab')
  const activeTab = TAB_IDS.includes(requested) ? requested : 'resumen'

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
    else if (target === '__message') openMessage()
    else if (target) applyTab(target)
  }
  const editing = editingBilling ?? !!client?.billing_missing

  // ------------------------------------------------------------- actions
  // "Enviar mensaje": the composer of Mensajes enviados with this client already chosen
  const openMessage = () => navigate(`/admin/sent-messages?to=${encodeURIComponent(client.email)}&name=${encodeURIComponent(client.name || '')}`)
  const sendMessage = () => { if (billingDirty) setPendingLeave('__message'); else openMessage() }

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

  // the data of this client as a JSON file (what they ask for by e-mail); the server records the export in the audit log
  const exportData = async (format = 'html') => {
    setExporting(true)
    try {
      await downloadClientExport(clientId, format)
      toast.push(t('pv_export_done'))
    } catch (error) {
      toast.push(error.message, 'error')
    } finally {
      setExporting(false)
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
      {shownPacks.length === 0
        ? <Badge>{t('cl_no_plan')}</Badge>
        : shownPacks.map(pack => <Badge key={pack.id} tone="emerald">{pack.name}{pack.session_type === 'dual' ? ` · ${t('ty_dual')}` : ''}</Badge>)}
      {shownPacks.some(pack => pack.status === 'expiring' || pack.status === 'expired') && (
        <Badge tone={shownPacks.every(pack => pack.status === 'expired') ? 'red' : 'amber'}>{t(`pk_status_${shownPacks.some(pack => pack.status === 'expired') ? 'expired' : 'expiring'}`)}</Badge>
      )}
      {client.must_change_password && <Badge tone="amber">{t('fx_temp_badge')}</Badge>}
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
  // The main actions are visible (New pack, send a message, archive / restore); the rest go in the "···" menu.
  const menuItems = client ? [
    { label: t('cal_copy'), icon: 'copy', onClick: copyCalendarLink, disabled: copyingLink, hidden: !clientCalendar },
    { label: t('pv_export_json'), icon: 'copy', onClick: () => exportData('json'), disabled: exporting },
    { label: t('lc_delete_menu'), icon: 'alert', onClick: () => setLifecycle('delete'), danger: true, hidden: protectedClient },
  ] : []
  const actions = client && (
    <>
      <Button variant="primary" onClick={() => setCreatingPack(true)}><Icon name="plus" className="h-4 w-4" /><Txt id="clients.new_pack" /></Button>
      <Button variant="secondary" onClick={sendMessage}><Icon name="send" className="h-4 w-4" /><Txt id="clients.send_message" /></Button>
      <Button variant="secondary" onClick={() => exportData('html')} loading={exporting}>{t('pv_export')}</Button>
      {!protectedClient && (archivedClient
        ? <Button variant="secondary" onClick={restore} loading={restoring}><Txt id="clients.unarchive" /></Button>
        : <Button variant="secondary" onClick={() => setLifecycle('archive')}><Txt id="clients.archive" /></Button>)}
      <MoreMenu items={menuItems} label={t('fx_more')} />
    </>
  )

  // the wanted action was taken at the start; the address goes back to the plain file
  const wantedAction = searchParams.get('action')
  useEffect(() => {
    if (!wantedAction) return
    setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('action'); return next }, { replace: true })
  }, [wantedAction, setSearchParams])

  const sessionList = (
    sessions.length === 0 ? (
      <EmptyState icon="calendar" title={<Txt id="clients.empty_sessions" />} />
    ) : (
      <div className="space-y-5">
        <SelectAllRow selection={sessionSelection} />
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
                  <li key={session.id} {...selectableProps(sessionSelection, session.id, canCancelSession(session))}
                    className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5 sm:py-4 ${cancelled || past ? 'opacity-60' : ''} ${sessionSelection.chosen.has(session.id) ? 'bg-emerald-400/[0.05]' : ''} ${sessionSelection.active && canCancelSession(session) ? SELECTING_CLASS : ''}`}>
                    {canCancelSession(session)
                      ? <RowCheck selection={sessionSelection} id={session.id} label={t('bk_select_one').replace('{name}', `${session.number || ''} ${session.date} ${session.time}`.trim())} />
                      : (sessionSelection.active ? <span className="w-11 shrink-0" aria-hidden="true" /> : null)}
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
                    {cancelled && (
                      <button type="button" onClick={() => setRestoreTarget(session)} className="min-h-[44px] rounded-lg px-3 py-1.5 text-sm text-emerald-300 transition hover:bg-emerald-400/15">{t('cl_restore')}</button>
                    )}
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
      <Drawer open onClose={requestClose} size="lg" fullOnMobile headerless title={client?.name || '…'}>
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
                avatar={<ClientAvatar client={client} size="h-12 w-12 text-base sm:h-16 sm:w-16 sm:text-xl" />}
                title={client.name} meta={meta} badges={badges} actions={actions}
                onClose={requestClose} closeLabel={t('fx_close')}
              />
              <Tabs tabs={tabs} value={activeTab} onChange={goTab} label={t('fx_tabs')} idPrefix={TAB_PREFIX}
                className="border-b border-white/[0.08] bg-[#0d1110] px-2 sm:px-6" />
            </div>

            <div className="px-4 py-6 sm:px-8 sm:py-8">
              <TabPanel id="resumen" idPrefix={TAB_PREFIX} active={activeTab === 'resumen'}>
                <div className="grid gap-4 lg:grid-cols-2">
                  <SectionCard title={t('fx_next_session')}>
                    {nextSession ? (
                      <>
                        <p className="text-2xl font-semibold">{fmtDate(nextSession.date, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                        <p className="mt-1 text-gray-400">{nextSession.time} · {nextSession.trainer || '—'}</p>
                      </>
                    ) : <p className="text-gray-400">{t('cl_no_next')}</p>}
                    <p className="mt-4 text-sm text-gray-500"><Txt id="clients.last_session" />: {lastSession ? fmtDate(lastSession.date, { day: 'numeric', month: 'short', year: 'numeric' }) : t('fx_none')}</p>
                  </SectionCard>
                  <SectionCard title={<Txt id="clients.progress" />}>
                    <div className="mb-3 flex items-end justify-between gap-3">
                      <p className="text-5xl font-semibold tabular-nums">{done}<span className="text-2xl text-gray-500">/{active.length}</span></p>
                      <p className="text-right text-sm text-gray-500">{done} {t('cl_completed')} · {active.length - done} {t('cl_upcoming')}</p>
                    </div>
                    <ProgressBar done={done} total={active.length} />
                  </SectionCard>

                  {client.must_change_password && (
                    <SectionCard title={t('cc_temp_title')} tone="amber" className="lg:col-span-2">
                      <p className="mb-3 text-sm text-gray-300">{t('cc_temp_text')}</p>
                      <Button variant="secondary" onClick={resend} loading={resending}>{resending ? t('cc_resending') : <Txt id="clients.resend_credentials" />}</Button>
                    </SectionCard>
                  )}

                  {hasActivity && (
                    <SectionCard title={t('fx_calendar_state')} className="lg:col-span-2">
                      <ul className="space-y-2.5 text-sm">
                        {clientCalendar && <li className="flex items-center gap-3 text-gray-300"><Icon name="calendar" className="h-4 w-4 text-gray-500" />{client.calendar_feed_generated ? t('fx_act_calendar_on') : t('fx_act_calendar_off')}</li>}
                        {okSync > 0 && <li className="flex items-center gap-3 text-emerald-300"><Icon name="check" className="h-4 w-4" />{okSync} {t('fx_act_synced')}</li>}
                        {pendingSync > 0 && <li className="flex items-center gap-3 text-gray-300"><Icon name="clock" className="h-4 w-4" />{pendingSync} {t('fx_act_pending')}</li>}
                        {failedSync > 0 && <li className="flex items-center gap-3 text-amber-300"><Icon name="alert" className="h-4 w-4" />{failedSync} {t('fx_act_failed')}</li>}
                      </ul>
                    </SectionCard>
                  )}
                </div>
              </TabPanel>

              <TabPanel id="packs" idPrefix={TAB_PREFIX} active={activeTab === 'packs'}>
                <PackHistory clientId={clientId} version={(client.packs || []).map(pack => pack.id).join('-')} extras={client.packs} />
              </TabPanel>

              <TabPanel id="sesiones" idPrefix={TAB_PREFIX} active={activeTab === 'sesiones'}>
                <div className="grid gap-6 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                  <div><TrainingCalendar sessions={sessions} /></div>
                  <section>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-sm font-medium uppercase tracking-wider text-gray-400"><Txt id="clients.sessions_title" /> ({sessions.length})</h3>
                      <Button variant="secondary" onClick={syncCalendar} loading={syncing} title={t('cs_hint')}>
                        <Icon name="refresh" className="h-4 w-4" />{syncing ? t('cs_syncing') : <Txt id="clients.sync" />}
                      </Button>
                    </div>
                    {sessionList}
                  </section>
                </div>
              </TabPanel>

              <TabPanel id="datos" idPrefix={TAB_PREFIX} active={activeTab === 'datos'}>
                <SectionCard title={t('fx_tab_personal')}
                  actions={<Button variant="secondary" onClick={() => { setEditingBilling(true); goTab('facturacion') }}>{t('fx_edit_address')}</Button>}>
                  <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                    <Detail label={<Txt id="clients.full_name" />}>{client.name}</Detail>
                    <Detail label={t('fx_email')}><a href={`mailto:${client.email}`} className="hover:text-emerald-300">{client.email}</a></Detail>
                    <Detail label={<Txt id="clients.phone" />}>{phoneText && <a href={`tel:${toE164(client.phone, client.country_code)}`} className="hover:text-emerald-300">{phoneText}</a>}</Detail>
                    <Detail label={<Txt id="clients.city" />}>{client.city}</Detail>
                  </dl>
                  <p className="mt-5 text-sm text-gray-500">{t('fx_personal_hint')}</p>
                </SectionCard>
              </TabPanel>

              <TabPanel id="facturacion" idPrefix={TAB_PREFIX} active={activeTab === 'facturacion'}>
                <div className="space-y-5">
                  {billingMissing.length > 0 && (
                    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-5 py-4 text-sm text-amber-100">
                      <p className="flex min-w-0 items-center gap-2.5">
                        <Icon name="alert" className="h-4 w-4 shrink-0" />
                        <span>{t('bl_missing_list').replace('{list}', billingMissing.map(key => t(`bl_miss_${key}`)).join(', '))}</span>
                      </p>
                    </div>
                  )}
                  <SectionCard title={<Txt id="clients.billing_title" />}
                    actions={<div className="flex items-center gap-2">
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
                          <Detail label={<Txt id="clients.address" />} wide>{client.address}</Detail>
                          <Detail label={<Txt id="clients.postal" />}>{client.postal_code}</Detail>
                          <Detail label={<Txt id="clients.city" />}>{client.city}</Detail>
                          <Detail label={<Txt id="clients.country" />}>{client.country}</Detail>
                        </dl>
                      </>
                    )}
                  </SectionCard>

                  {/* every pack is recorded and invoiced on its own: its type, period, price per session and total as sold */}
                  <SectionCard title={<Txt id="clients.billing_packs_title" />}>
                    <p className="mb-4 text-sm text-gray-500">{t('bl_packs_hint')}</p>
                    {(client.packs || []).length === 0 ? <p className="text-gray-400"><Txt id="clients.empty_pack" /></p> : (
                      <ul className="space-y-3">
                        {[...client.packs].reverse().map(pack => (
                          <li key={pack.id} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <p className="break-words font-semibold">{pack.name}</p>
                              <TypeBadge type={pack.session_type} secondName={pack.second_person_name} />
                            </div>
                            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                              <div><dt className="text-gray-500"><Txt id="clients.period" /></dt><dd>{fmtDate(pack.start_date)} → {fmtDate(pack.end_date)}</dd></div>
                              <div><dt className="text-gray-500"><Txt id="clients.price_session" /></dt><dd className="tabular-nums">{pack.price_per_session != null ? formatMoney(pack.price_per_session) : '—'}</dd></div>
                              <div><dt className="text-gray-500"><Txt id="clients.price_total" /></dt><dd className="tabular-nums">{pack.total_price != null ? formatMoney(pack.total_price) : '—'}</dd></div>
                              <div><dt className="text-gray-500">{t('pk_sessions')}</dt><dd className="tabular-nums">{pack.done}/{pack.total}</dd></div>
                            </dl>
                          </li>
                        ))}
                      </ul>
                    )}
                  </SectionCard>
                </div>
              </TabPanel>

            </div>
          </>
        )}
      </Drawer>
      {creatingPack && client && (
        <NewPackDrawer
          client={client} pack={client.pack} packs={packs}
          onClose={() => setCreatingPack(false)}
          onDone={() => { setCreatingPack(false); detail.reload(); onChanged() }}
        />
      )}
      {restoreTarget && (
        <RestoreSessionDialog
          session={restoreTarget} onClose={() => setRestoreTarget(null)}
          onRestored={() => { setRestoreTarget(null); detail.reload(); onChanged() }}
        />
      )}
      <BulkBar
        selection={sessionSelection} onDone={() => { detail.reload(); onChanged() }}
        labelOf={id => { const found = sessions.find(session => session.id === id); return found ? `${found.number || ''} ${found.date} ${found.time}`.trim() : t('bk_deleted_item').replace('{id}', id) }}
        actions={[{
          key: 'cancel', verb: 'cancel', tone: 'danger', label: t('bk_a_cancel'), effects: [t('bk_fx_sessions')],
          run: ids => adminRequest('POST', '/admin/sessions/bulk', { action: 'cancel', ids })
        }]}
      />
      <ConfirmDialog
        open={!!cancelTarget} busy={cancelling}
        title={t('cl_cancel_title')} text={t('cl_cancel_text')}
        confirmLabel={t('cl_cancel_do')} cancelLabel={t('cl_cancel_keep')}
        onConfirm={cancelSession} onCancel={() => setCancelTarget(null)}
      />
      {lifecycle === 'archive' && client && !archivedClient && !protectedClient && (
        <ArchiveDialog
          client={client} futureSessions={upcoming.length}
          onClose={() => setLifecycle(null)}
          onDone={() => { setLifecycle(null); onChanged(); onClose() }}
        />
      )}
      {lifecycle === 'delete' && client && !protectedClient && (
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

const PAGE_SIZE = 50
const clientKey = client => client.id
const canSelectClient = client => !isProtectedAccount(client.email)     // the admin and whoever is signed in are never touched

export default function Clients() {
  const { t } = useAdminText()
  const clientsResource = useAdminResource('/admin/clients')
  // Archived clients are left out of the normal list; this one has only them.
  const archivedResource = useAdminResource('/admin/clients?archived=only')
  const packsResource = useAdminResource('/pricing')          // the catalogue: only the packs on sale (and the trial prices)
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE_SIZE)                 // how many rows are drawn (50 more each time)
  const [searchParams, setSearchParams] = useSearchParams()
  const [filter, setFilter] = useState(() => (['pending', 'ending', 'archived'].includes(searchParams.get('filter')) ? searchParams.get('filter') : 'all'))
  const reloadAll = () => { clientsResource.reload(); archivedResource.reload() }
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
  const navigate = useNavigate()
  const toast = useToast()
  // open the file of a client, on a tab, or asking for an action (new pack, archive, delete) once it has loaded
  const openClient = (id, { tab = '', action = '' } = {}) => setSearchParams(previous => {
    const next = new URLSearchParams(previous)
    next.set('client', String(id))
    if (tab && tab !== 'resumen') next.set('tab', tab)
    else next.delete('tab')
    if (action) next.set('action', action)
    else next.delete('action')
    return next
  })
  const restoreClient = async (client) => {
    try {
      await adminRequest('POST', `/admin/clients/${client.id}/unarchive`)
      toast.push(t('lc_unarchived_ok'))
      reloadAll()
    } catch (error) {
      toast.push(error.message, 'error')
    }
  }
  // the secondary actions of a row (the "···" menu): everything the file offers, one click from the list
  const rowMenu = (client) => [
    { label: t('cl_open_file'), icon: 'clients', onClick: () => openClient(client.id) },
    { label: t('fx_new_pack'), icon: 'bolt', onClick: () => openClient(client.id, { action: 'newpack' }) },
    { label: t('fx_tab_packs'), icon: 'doc', onClick: () => openClient(client.id, { tab: 'packs' }) },
    { label: t('fx_tab_sessions'), icon: 'calendar', onClick: () => openClient(client.id, { tab: 'sesiones' }) },
    { label: t('fx_tab_billing'), icon: 'doc', onClick: () => openClient(client.id, { tab: 'facturacion' }) },
    { label: t('fx_send_message'), icon: 'send', onClick: () => navigate(`/admin/sent-messages?to=${encodeURIComponent(client.email)}&name=${encodeURIComponent(client.name || '')}`) },
    { label: t('lc_archive_menu'), icon: 'archive', onClick: () => openClient(client.id, { action: 'archive' }), hidden: !!client.archived_at || !canSelectClient(client) },
    { label: t('lc_unarchive'), icon: 'refresh', onClick: () => restoreClient(client), hidden: !client.archived_at || !canSelectClient(client) },
    { label: t('lc_delete_menu'), icon: 'alert', onClick: () => openClient(client.id, { action: 'delete' }), danger: true, hidden: !canSelectClient(client) },
  ]

  const activeClients = useMemo(() => clientsResource.data || [], [clientsResource.data])
  const archivedClients = useMemo(() => archivedResource.data || [], [archivedResource.data])
  const clients = filter === 'archived' ? archivedClients : activeClients
  const packs = useMemo(() => packsResource.data?.packs || [], [packsResource.data])

  const counts = useMemo(() => ({
    all: activeClients.length,
    pending: activeClients.filter(client => client.has_pending_request).length,
    ending: activeClients.filter(client => client.pack_status === 'expired' || client.pack_status === 'expiring').length,
    archived: archivedClients.length
  }), [activeClients, archivedClients])

  // same filters and the same order as before; the search looks at the email, the only thing a row shows
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return clients.filter(client => {
      if (filter === 'pending' && !client.has_pending_request) return false
      if (filter === 'ending' && client.pack_status !== 'expired' && client.pack_status !== 'expiring') return false
      return !needle || String(client.email || '').toLowerCase().includes(needle)
    })
  }, [clients, filter, query])
  const rows = visible.slice(0, shown)
  const selection = useBulkSelection(rows, clientKey, canSelectClient)

  const changeQuery = (value) => { setQuery(value); setShown(PAGE_SIZE) }
  const changeFilter = (key) => { setFilter(key); setShown(PAGE_SIZE) }

  const filters = [['all', <Txt id="clients.filter_all" />], ['pending', t('cl_pending')], ['ending', <Txt id="clients.filter_ending" />], ['archived', <Txt id="clients.filter_archived" />]]

  return (
    <div className="admin-fade">
      <PageHeader pageKey="clients"
        title={t('clients_title')} subtitle={t('clients_sub')}
        actions={<>
          <Button variant="secondary" onClick={reloadAll}><Icon name="refresh" className="h-4 w-4" /><Txt id="clients.refresh" /></Button>
          <Button variant="primary" onClick={() => setAdding(true)}><Icon name="plus" className="h-4 w-4" /><Txt id="clients.add_client" /></Button>
        </>}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist">
          {filters.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => changeFilter(key)}
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${
                filter === key ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-gray-400 hover:border-white/25 hover:text-white'
              }`}>
              {label}
              <span className={`rounded-full px-1.5 text-xs tabular-nums ${filter === key ? 'bg-emerald-400/20' : 'bg-white/10'}`}>{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-80">
          <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <TextInput
            type="text" inputMode="email" value={query} onChange={event => changeQuery(event.target.value)}
            placeholder={t('cl_search')} aria-label={t('cl_search')} className="!pl-10 !pr-11"
          />
          {query && (
            <button type="button" onClick={() => changeQuery('')} aria-label={t('cl_clear')} title={t('cl_clear')}
              className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 transition hover:bg-white/10 hover:text-white">
              <Icon name="close" className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {clientsResource.error ? (
        <Card><ErrorState message={`${t('load_error')} (${clientsResource.error})`} retryLabel={t('retry')} onRetry={clientsResource.reload} /></Card>
      ) : clientsResource.loading && !clientsResource.data ? (
        <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]" role="status" aria-label="…">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex h-16 items-center gap-4 border-b border-white/[0.06] px-5 last:border-b-0">
              <Skeleton className="!h-10 !w-10 shrink-0 !rounded-full" /><Skeleton className="!h-4 w-64 max-w-[60%]" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card><EmptyState icon="clients" title={clients.length ? <Txt id="clients.empty_search" /> : filter === 'archived' ? <Txt id="clients.empty_archived" /> : <Txt id="clients.empty_none" />} /></Card>
      ) : (
        <>
          <p role="status" className="mb-2 px-1 text-xs text-gray-500">{t(visible.length === 1 ? 'cl_count_one' : 'cl_count_other').replace('{n}', visible.length)}</p>
          <SelectAllRow selection={selection} />
          <ul className="divide-y divide-white/[0.06] rounded-2xl bg-white/[0.025]">
            {rows.map(client => (
              <ClientRow key={client.id} client={client}
                onOpen={id => (selection.active ? (canSelectClient(client) && selection.toggle(id)) : setSelectedId(id))}
                label={selection.active ? t('bk_select_one').replace('{name}', client.email) : t('cl_open').replace('{email}', client.email)}
                selected={selection.chosen.has(client.id)}
                menu={selection.active ? null : <MoreMenu quiet items={rowMenu(client)} label={t('cl_row_menu').replace('{email}', client.email)} />}
                check={selection.active && canSelectClient(client) ? <RowCheck selection={selection} id={client.id} label={t('bk_select_one').replace('{name}', client.email)} /> : null} />
            ))}
          </ul>
          {visible.length > rows.length && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm text-gray-500">
              <span>{t('cl_showing').replace('{shown}', rows.length).replace('{total}', visible.length)}</span>
              <Button variant="secondary" onClick={() => setShown(count => count + PAGE_SIZE)}><Txt id="clients.show_more" /></Button>
            </div>
          )}
        </>
      )}

      <BulkBar
        selection={selection} onDone={reloadAll}
        labelOf={id => clients.find(client => client.id === id)?.email || t('bk_deleted_item').replace('{id}', id)}
        actions={[
          filter === 'archived'
            ? { key: 'unarchive', verb: 'unarchive', tone: 'neutral', label: t('bk_a_unarchive'), effects: [],
                run: ids => adminRequest('POST', '/admin/clients/bulk', { action: 'unarchive', ids }) }
            : { key: 'archive', verb: 'archive', tone: 'neutral', label: t('bk_a_archive'), effects: [t('bk_fx_client_archive')],
                extraInitial: { cancel: false },
                renderExtra: (extra, setExtra, busy) => (
                  <label className="flex min-h-[44px] cursor-pointer items-start gap-3 text-sm text-gray-300">
                    <input type="checkbox" checked={extra.cancel} disabled={busy} onChange={event => setExtra({ ...extra, cancel: event.target.checked })} className="mt-1 h-5 w-5 shrink-0 accent-emerald-400" />
                    {t('bk_fx_client_cancel')}
                  </label>),
                run: (ids, extra) => adminRequest('POST', '/admin/clients/bulk', { action: 'archive', ids, cancel_future_sessions: !!extra.cancel, confirm_cancel: !!extra.cancel }) },
          { key: 'delete', verb: 'delete', tone: 'danger', label: t('bk_a_delete'), word: 'ELIMINAR', effects: [t('bk_fx_calendar'), t('bk_fx_client_delete')],
            run: (ids, extra) => adminRequest('POST', '/admin/clients/bulk', { action: 'delete', ids, confirm_word: extra.word })
          }
        ]}
      />

      {adding && (
        <AddClientDrawer
          packs={packs}
          onClose={() => setAdding(false)} onCreated={() => reloadAll()}
        />
      )}

      {selectedId && (
        <ClientDrawer
          key={selectedId} clientId={selectedId} packs={packs}
          onClose={() => setSelectedId(null)} onChanged={reloadAll}
        />
      )}
    </div>
  )
}
