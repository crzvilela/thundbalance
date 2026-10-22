import { useAdminText } from './useAdminText'
import { NEUTRAL_COLOR } from './calendar/calendarConfig'
import { OPEN, STATUS_TONE, formatSlot, timeUntil } from './scheduleRequests'
import { Badge, Button, Card, Icon } from './ui'

// "2 Oct 2026, 10:15" from an ISO timestamp (server time, shown in Madrid)
function formatStamp(iso, locale) {
  if (!iso) return ''
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(`${iso}Z`))
}

function Slot({ label, value, tone }) {
  const styles = {
    plain: 'border-white/10 bg-white/[0.03]',
    request: 'border-emerald-400/30 bg-emerald-400/[0.06]',
    proposal: 'border-sky-400/30 bg-sky-400/[0.06]'
  }
  return (
    <div className={`rounded-2xl border p-3.5 ${styles[tone]}`}>
      <dt className="text-xs uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="mt-1 text-base font-medium first-letter:uppercase">{value}</dd>
    </div>
  )
}

function Notice({ tone, children, role = 'status' }) {
  const styles = tone === 'red' ? 'border-red-400/30 bg-red-400/10 text-red-100' : 'border-amber-400/30 bg-amber-400/10 text-amber-100'
  return (
    <div role={role} className={`mt-4 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${styles}`}>
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

// One reschedule request. All decisions go up to the page (`on…`), which owns the requests and the busy state.
export default function ScheduleCard({ item, now, busy, locked, highlight, error, emailFailed, syncing, onApprove, onReject, onCounter, onResend, onSync }) {
  const { t, language } = useAdminText()
  const locale = language === 'es' ? 'es-ES' : 'en-GB'
  const open = OPEN.includes(item.status)
  const isCounter = item.status === 'counter_proposed'
  const left = open ? timeUntil(item.session_date, item.session_time, now) : null
  const leftText = !left ? '' : left.past ? t('sch_started') : t(`sch_in_${left.unit}_${left.n === 1 ? 'one' : 'other'}`).replace('{n}', left.n)
  const color = item.color || NEUTRAL_COLOR
  const moved = item.status === 'approved' || item.status === 'accepted'
  const syncFailed = moved && item.sync_status === 'failed'
  const disabled = busy || locked      // one action at a time: no double clicks
  const decided = !open && item.decided_by
  const urgent = !!left && (left.past || left.unit !== 'day')      // under 48 hours

  return (
    <li id={`request-${item.id}`} className="scroll-mt-24" aria-current={highlight ? 'true' : undefined}>
      <Card className={`p-5 transition ${highlight ? '!border-emerald-400/60 ring-2 ring-emerald-400/30' : 'hover:border-white/20'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-60">
            <div className="flex flex-wrap items-center gap-2">
              <a href={`mailto:${item.client_email}`} className="truncate text-base font-semibold text-white underline-offset-4 hover:underline">{item.client_email}</a>
              <Badge tone={STATUS_TONE[item.status] || 'neutral'}>{t(`sch_st_${item.status}`)}</Badge>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-400">
              {item.client_name && <span>{item.client_name}</span>}
              <span>{t('sch_session')} {item.number || `#${item.session_id}`}</span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                {item.trainer || t('ac_unassigned')}
              </span>
            </p>
          </div>
          {leftText && (
            <p className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${urgent ? 'border-amber-400/30 text-amber-300' : 'border-white/10 text-gray-300'}`}>
              <Icon name="clock" className="h-3.5 w-3.5" />{leftText}
            </p>
          )}
        </div>

        <dl className={`mt-4 grid gap-3 ${isCounter ? 'md:grid-cols-3' : 'sm:grid-cols-2'}`}>
          <Slot label={t('sch_original')} value={formatSlot(item.original_date, item.original_time, locale)} tone="plain" />
          <Slot label={t('sch_requested')} value={formatSlot(item.requested_date, item.requested_time, locale)} tone="request" />
          {isCounter && item.counter_date && <Slot label={t('sch_proposed')} value={formatSlot(item.counter_date, item.counter_time, locale)} tone="proposal" />}
        </dl>

        {item.client_note && (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
            <p className="text-xs uppercase tracking-wider text-gray-400">{t('sch_client_reason')}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-100">{item.client_note}</p>
          </div>
        )}
        {item.admin_note && !open && (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
            <p className="text-xs uppercase tracking-wider text-gray-400">{t('sch_studio_note')}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-100">{item.admin_note}</p>
          </div>
        )}

        <p className="mt-3 text-xs text-gray-500">
          {t('sch_requested_on')} {formatStamp(item.created_at, locale)}
          {decided && <> · {t('sch_decided_by').replace('{who}', item.decided_by).replace('{when}', formatStamp(item.decided_at, locale))}</>}
        </p>

        {open && item.conflict && <Notice>{isCounter ? t('sch_conflict_counter') : t('sch_conflict')}</Notice>}
        {isCounter && (
          <p className="mt-4 text-sm text-sky-200">
            {t('sch_waiting')}
            {item.counter_deadline && <span className="mt-1 block font-semibold">{t('sch_deadline').replace('{when}', formatSlot(item.counter_deadline.slice(0, 10), item.counter_deadline.slice(11, 16), locale))}</span>}
          </p>
        )}
        {error && <Notice tone="red" role="alert">{error}</Notice>}
        {syncFailed && (
          <Notice role="alert">
            <p>{t('sch_google_warn')}{item.sync_error ? ` (${item.sync_error})` : ''}</p>
            <Button variant="secondary" className="mt-2" onClick={() => onSync(item)} loading={syncing} disabled={disabled}><Icon name="refresh" className="h-4 w-4" />{syncing ? t('ac_syncing') : t('ac_sync_google')}</Button>
          </Notice>
        )}
        {emailFailed && (
          <Notice role="alert">
            <p>{t('sch_email_failed')}</p>
            <Button variant="secondary" className="mt-2" onClick={() => onResend(item)} disabled={disabled}>{t('sch_resend')}</Button>
          </Notice>
        )}

        {item.status === 'pending' && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => onApprove(item)} loading={busy} disabled={disabled}><Icon name="check" className="h-4 w-4" />{t('sch_approve')}</Button>
            <Button variant="secondary" onClick={() => onCounter(item)} disabled={disabled}>{t('sch_counter')}</Button>
            <Button variant="danger" onClick={() => onReject(item)} disabled={disabled}>{t('sch_reject')}</Button>
          </div>
        )}
      </Card>
    </li>
  )
}
