import { useI18n } from '../../i18n/I18nContext'
import { formatDayTime } from '../../utils/sessionDates'

// Small pieces of the My Sessions page: status badge, list row (the "next session" card is NextSessionCard.jsx).

const BADGE = {
  upcoming: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  completed: 'border-white/20 bg-white/5 text-gray-300',
  cancelled: 'border-red-400/40 bg-red-400/10 text-red-300',
  rescheduled: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  change_pending: 'border-amber-400/40 bg-amber-400/10 text-amber-300'
}

export function StatusBadge({ status, className = '' }) {
  const { t } = useI18n()
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold ${BADGE[status]} ${className}`}>
      {t(`ms_status_${status}`)}
    </span>
  )
}

export function Spinner() {
  return <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
}

export const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'

// The name of the pack a session belongs to, as a small label (a client can have several packs at once).
export function PackLabel({ name, className = '' }) {
  if (!name) return null
  return <span className={`inline-block max-w-full truncate rounded-full border border-sky-400/30 bg-sky-400/10 px-2.5 py-0.5 align-middle text-xs font-medium text-sky-200 ${className}`}>{name}</span>
}

export function SessionRow({ session, status, onOpen }) {
  const { locale } = useI18n()
  return (
    <button
      type="button" onClick={() => onOpen(session)}
      className={`group flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-black/30 p-3.5 text-left transition hover:border-emerald-400/40 hover:bg-emerald-400/[0.04] sm:gap-4 sm:p-4 ${FOCUS} ${status === 'completed' || status === 'cancelled' ? 'opacity-70' : ''}`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-medium capitalize ${status === 'cancelled' ? 'line-through decoration-red-300/60' : ''}`}>
          {formatDayTime(session.date, session.time, locale)}
        </span>
        <span className="block truncate text-sm text-gray-400">
          {session.trainer || '—'}{session.number ? ` · ${session.number}` : ''}
        </span>
        <PackLabel name={session.packName} className="mt-1" />
      </span>
      <StatusBadge status={status} className="shrink-0" />
      <span aria-hidden="true" className="text-hint transition group-hover:translate-x-0.5 group-hover:text-emerald-300">→</span>
    </button>
  )
}

// The message after an action (cancelled, change requested...): the same one My Sessions shows.
export function SessionToast({ toast, onClose }) {
  const { t } = useI18n()
  if (!toast) return null
  return (
    <div role={toast.tone === 'error' ? 'alert' : 'status'}
      className={`relative mb-6 flex items-start justify-between gap-4 rounded-2xl border px-5 py-4 text-sm ${toast.tone === 'error' ? 'border-red-400/40 bg-red-400/10 text-red-100' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'}`}>
      <span>{toast.text}</span>
      <button type="button" onClick={onClose} aria-label={t('ms_dismiss')} className={`min-h-[32px] min-w-[32px] rounded ${FOCUS}`}>✕</button>
    </div>
  )
}
