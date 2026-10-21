import { useModalFocus } from '../hooks/useModalFocus'
import { CARD, FOCUS, HEADING_FONT, formatDay } from './trainerStyle'

export function Skeleton({ className = '' }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-2xl bg-white/[0.06] ${className}`} />
}

// A failed load: our own sentence and a "Reintentar" button. Never the server's technical message.
export function ErrorBox({ message, onRetry, retryLabel }) {
  return (
    <div role="alert" className={`${CARD} flex flex-col items-center gap-4 p-8 text-center`}>
      <p className="max-w-md text-sm text-gray-200">{message}</p>
      <button type="button" onClick={onRetry}
        className={`min-h-[44px] rounded-xl border border-white/25 px-6 text-sm font-semibold uppercase tracking-wider text-white transition hover:bg-white hover:text-black ${FOCUS}`}>
        {retryLabel}
      </button>
    </div>
  )
}

const BADGE = {
  booked: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  completed: 'border-white/15 bg-white/5 text-gray-300',
  cancelled: 'border-red-400/30 bg-red-400/10 text-red-300'
}

export function StatusBadge({ status, label }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${BADGE[status] || BADGE.completed}`}>{label}</span>
}

export function TrialTag({ label }) {
  return <span className="inline-flex items-center rounded-md border border-dashed border-sky-300/50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-sky-200">{label}</span>
}

// The details of one session, READ ONLY: name of the client, session x/y, pack, date, hour and status.
// There is no button besides "Cerrar": nothing here can change a session. No contact data exists in `session`.
export function SessionModal({ session, text, onClose }) {
  const { t, locale } = text
  const ref = useModalFocus(true, onClose)
  const rows = [
    [t('tr_modal_client'), session.client_display_name],
    [t('tr_modal_session'), session.is_trial ? t('tr_trial') : (session.session_number || '—')],
    [t('tr_modal_pack'), session.pack_name || '—'],
    [t('tr_modal_date'), formatDay(session.date, locale)],
    [t('tr_modal_time'), session.time],
  ]
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-3 sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t('tr_modal_title')} tabIndex={-1}
        className="relative max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-[#0b0e0d] p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 className="text-3xl text-white" style={HEADING_FONT}>{t('tr_modal_title')}</h2>
          {session.is_trial && <TrialTag label={t('tr_trial')} />}
        </div>
        <dl className="space-y-4">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wider text-gray-500">{label}</dt>
              <dd className="mt-0.5 break-words text-base text-white">{value}</dd>
            </div>
          ))}
          <div>
            <dt className="text-xs uppercase tracking-wider text-gray-500">{t('tr_modal_status')}</dt>
            <dd className="mt-1"><StatusBadge status={session.status} label={t(`tr_status_${session.status}`)} /></dd>
          </div>
        </dl>
        <p className="mt-6 text-sm text-gray-500">{t('tr_modal_note')}</p>
        <button type="button" onClick={onClose}
          className={`mt-5 min-h-[44px] w-full rounded-xl border border-white/25 px-5 text-sm font-semibold uppercase tracking-wider text-white transition hover:bg-white hover:text-black ${FOCUS}`}>
          {t('tr_close')}
        </button>
      </div>
    </div>
  )
}
