import { useEffect } from 'react'
import { Link } from 'react-router-dom'

// Small shared kit so every admin screen looks and behaves the same.

const ICONS = {
  overview: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  requests: <><path d="M9 11l3 3 8-8" /><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></>,
  clients: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.4 3.4-5.5 6.5-5.5s5.9 2.1 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.5 5.2" /></>,
  video: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor" stroke="none" /></>,
  landing: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 9v11" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" /></>,
  logout: <><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" /><path d="M16 8l4 4-4 4M20 12H9" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  whistle: <><circle cx="12" cy="8" r="4" /><path d="M5 21c.5-4 3.2-6 7-6s6.5 2 7 6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.3-4.5L4 8" /><path d="M4 4v4h4M4 13a8 8 0 0 0 14.3 4.5L20 16" /><path d="M20 20v-4h-4" /></>,
  inbox: <><path d="M3 13l2.5-8h13L21 13" /><path d="M3 13v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6h-5a3 3 0 0 1-6 0z" /></>,
  check: <path d="m5 12 5 5 9-10" />,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v5M12 18v.01" /></>
}

export function Icon({ name, className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

export function Card({ className = '', children, ...rest }) {
  return (
    <div {...rest} className={`rounded-2xl border border-white/[0.08] bg-white/[0.03] backdrop-blur-sm ${className}`}>
      {children}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-4xl tracking-wide text-white md:text-5xl" style={{ fontFamily: 'Bebas Neue, Inter, sans-serif' }}>{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-sm text-gray-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </header>
  )
}

const TONES = {
  emerald: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
  amber: 'border-amber-400/25 bg-amber-400/10 text-amber-300',
  red: 'border-red-400/25 bg-red-400/10 text-red-300',
  sky: 'border-sky-400/25 bg-sky-400/10 text-sky-300',
  neutral: 'border-white/10 bg-white/5 text-gray-300'
}

export function Badge({ tone = 'neutral', children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  )
}

const BUTTONS = {
  primary: 'bg-emerald-400 text-black hover:bg-emerald-300 hover:shadow-lg hover:shadow-emerald-400/25 active:bg-emerald-500',
  secondary: 'border border-white/15 text-gray-100 hover:border-white/30 hover:bg-white/10 active:bg-white/15',
  danger: 'border border-red-400/40 text-red-300 hover:bg-red-500/15 hover:border-red-300 active:bg-red-500/25',
  ghost: 'text-gray-300 hover:bg-white/10 active:bg-white/15'
}

export function Button({ variant = 'secondary', loading = false, className = '', children, disabled, ...rest }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 disabled:hover:shadow-none ${BUTTONS[variant]} ${className}`}
    >
      {loading && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />}
      {children}
    </button>
  )
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-lg bg-white/[0.06] ${className}`} />
}

export function EmptyState({ icon = 'inbox', title, text, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-gray-400">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <p className="font-medium text-gray-200">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-gray-500">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, retryLabel, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-10 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-red-400/25 bg-red-400/10 text-red-300">
        <Icon name="alert" className="h-5 w-5" />
      </span>
      <p className="text-sm text-gray-300">{message}</p>
      {onRetry && <Button variant="secondary" className="mt-4" onClick={onRetry}>{retryLabel}</Button>}
    </div>
  )
}

export function StatCard({ label, value, icon, tone = 'emerald', hint, to, loading }) {
  const accent = { emerald: 'text-emerald-300 bg-emerald-400/10', amber: 'text-amber-300 bg-amber-400/10', sky: 'text-sky-300 bg-sky-400/10' }[tone]
  const body = (
    <Card className="group relative h-full overflow-hidden p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20">
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-emerald-400/5 blur-2xl transition-opacity group-hover:opacity-100" />
      <div className="flex items-start justify-between">
        <p className="min-w-0 pr-2 text-sm text-gray-400">{label}</p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${accent}`}><Icon name={icon} className="h-[18px] w-[18px]" /></span>
      </div>
      {loading ? <Skeleton className="mt-4 h-9 w-20" /> : <p className="mt-3 text-4xl font-semibold tabular-nums text-white">{value}</p>}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </Card>
  )
  return to ? <Link to={to} className="block h-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 rounded-2xl">{body}</Link> : body
}

export function Field({ label, children, hint }) {
  return (
    <label className="mb-5 block">
      <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  )
}

const CONTROL = 'w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-400/15 disabled:opacity-50'

export function TextInput(props) {
  return <input {...props} className={`${CONTROL} ${props.className || ''}`} />
}

export function TextArea(props) {
  return <textarea {...props} className={`${CONTROL} ${props.className || ''}`} />
}

export function SelectInput({ children, ...props }) {
  return <select {...props} className={`${CONTROL} ${props.className || ''}`}>{children}</select>
}

// Side panel used for focused tasks (approve / decline). Closes with Esc or a
// click outside, and traps nothing else on the page.
export function Drawer({ open, onClose, title, subtitle, children, footer, busy = false, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, busy])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { if (!busy) onClose() }} />
      <aside role="dialog" aria-modal="true" aria-label={title} className={`admin-drawer relative flex h-full w-full ${size === 'lg' ? 'max-w-xl' : 'max-w-md'} flex-col border-l border-white/10 bg-[#0b0e0d] shadow-2xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-6">
          <div>
            <h2 className="text-2xl text-white" style={{ fontFamily: 'Bebas Neue, Inter, sans-serif' }}>{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-gray-400">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white disabled:opacity-40"><Icon name="close" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
        {footer && <div className="flex gap-3 border-t border-white/10 p-6">{footer}</div>}
      </aside>
    </div>
  )
}

// Small centered confirmation for destructive actions.
export function ConfirmDialog({ open, title, text, confirmLabel, cancelLabel, onConfirm, onCancel, busy = false }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel, busy])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { if (!busy) onCancel() }} />
      <div role="alertdialog" aria-modal="true" aria-label={title} className="admin-toast relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#0d1110] p-6 shadow-2xl">
        <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-red-400/25 bg-red-400/10 text-red-300"><Icon name="alert" /></span>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {text && <p className="mt-2 text-sm text-gray-400">{text}</p>}
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button variant="danger" className="flex-1" onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}
