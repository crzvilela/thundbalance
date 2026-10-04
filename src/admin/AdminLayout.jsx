import { useCallback, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase/auth'
import { Icon } from './ui'
import { ToastContext } from './toastContext'
import { useAdminText } from './useAdminText'
import { useAdminResource } from './useAdminResource'
import { normalizeRequests } from './requests'
import './admin.css'

const NAV = [
  { to: '/admin', end: true, icon: 'overview', label: 'nav_overview' },
  { to: '/admin/requests', icon: 'requests', label: 'nav_requests', badge: 'requests' },
  { to: '/admin/trials', icon: 'whistle', label: 'nav_trials', badge: 'trials' },
  { to: '/admin/clients', icon: 'clients', label: 'nav_clients' },
  { to: '/admin/calendar', icon: 'calendar', label: 'nav_sessions' },
  { to: '/admin/plans', icon: 'bolt', label: 'nav_plans' },
  { to: '/admin/videos', icon: 'video', label: 'nav_videos' }
]

const linkClass = ({ isActive }) =>
  `group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-150 ${
    isActive
      ? 'bg-emerald-400/10 text-emerald-300 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.2)]'
      : 'text-gray-400 hover:bg-white/5 hover:text-white'
  }`

function ToastHost({ toasts }) {
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex flex-col gap-2">
      {toasts.map(toast => (
        <div key={toast.id} role="status" className={`admin-toast pointer-events-auto flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur ${
          toast.tone === 'error' ? 'border-red-400/30 bg-red-950/80 text-red-100' : 'border-emerald-400/30 bg-emerald-950/80 text-emerald-100'
        }`}>
          <Icon name={toast.tone === 'error' ? 'alert' : 'check'} className="h-4 w-4 shrink-0" />
          {toast.message}
        </div>
      ))}
    </div>
  )
}

export default function AdminLayout() {
  const { t, language, setLanguage } = useAdminText()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [toasts, setToasts] = useState([])
  const nextToastId = useRef(0)

  // Requests are loaded once here: the sidebar badge, the overview and the
  // requests screen all read the same data.
  const requestsResource = useAdminResource('/admin/client-requests')
  const requests = useMemo(() => normalizeRequests(requestsResource.data), [requestsResource.data])
  const pendingCount = requests.filter(request => request.status === 'pending').length

  const trialsResource = useAdminResource('/admin/trial-sessions')
  const trials = useMemo(() => (Array.isArray(trialsResource.data) ? trialsResource.data.map(trial => ({ ...trial, status: String(trial.status).toLowerCase() })) : []), [trialsResource.data])
  const pendingTrials = trials.filter(trial => trial.status === 'pending').length
  const badges = { requests: pendingCount, trials: pendingTrials }

  const push = useCallback((message, tone = 'success') => {
    const id = ++nextToastId.current
    setToasts(current => [...current, { id, message, tone }])
    window.setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), 4500)
  }, [])
  const toastValue = useMemo(() => ({ push }), [push])

  const logout = async () => {
    await signOut(auth)
    navigate('/admin/login')
  }

  const email = auth.currentUser?.email || ''

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-6 pt-6">
        <p className="text-2xl tracking-[0.18em] text-white" style={{ fontFamily: 'Bebas Neue, Inter, sans-serif' }}>THUNDBALANCE</p>
        <p className="mt-0.5 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
          {t('brand_sub')}
        </p>
      </div>

      <nav className="flex-1 space-y-1 px-3" aria-label="Admin">
        {NAV.map(item => (
          <NavLink key={item.to} to={item.to} end={item.end} className={linkClass} onClick={() => setMenuOpen(false)}>
            <Icon name={item.icon} className="h-[18px] w-[18px]" />
            <span className="flex-1">{t(item.label)}</span>
            {item.badge && badges[item.badge] > 0 && (
              <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold leading-none text-black">{badges[item.badge]}</span>
            )}
          </NavLink>
        ))}
        <NavLink to="/admin/landing-editor" className={linkClass}>
          <Icon name="landing" className="h-[18px] w-[18px]" />
          <span className="flex-1">{t('nav_landing')}</span>
          <Icon name="arrow" className="h-4 w-4 opacity-0 transition group-hover:opacity-60" />
        </NavLink>
      </nav>

      <div className="space-y-3 border-t border-white/10 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-gray-500">{t('language')}</span>
          <div className="flex rounded-lg border border-white/10 bg-black/30 p-0.5" role="group" aria-label={t('language')}>
            {['en', 'es'].map(code => (
              <button key={code} type="button" onClick={() => setLanguage(code)} aria-pressed={language === code}
                className={`rounded-md px-3 py-1 text-xs font-semibold uppercase transition ${language === code ? 'bg-emerald-400 text-black' : 'text-gray-400 hover:text-white'}`}>
                {code}
              </button>
            ))}
          </div>
        </div>
        <NavLink to="/" className="flex items-center gap-3 rounded-xl px-3.5 py-2 text-sm text-gray-400 transition hover:bg-white/5 hover:text-white">
          <Icon name="globe" className="h-[18px] w-[18px]" />{t('nav_site')}
        </NavLink>
        <button type="button" onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2 text-sm text-gray-400 transition hover:bg-red-500/10 hover:text-red-300">
          <Icon name="logout" className="h-[18px] w-[18px]" />{t('nav_logout')}
        </button>
        {email && <p className="truncate px-3.5 text-xs text-gray-600" title={email}>{email}</p>}
      </div>
    </div>
  )

  return (
    <ToastContext.Provider value={toastValue}>
      <div className="admin-shell min-h-screen text-white">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-white/[0.07] bg-[#080b0a]/90 backdrop-blur lg:block">
          {sidebar}
        </aside>

        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.07] bg-[#080b0a]/90 px-4 py-3 backdrop-blur lg:hidden">
          <p className="text-xl tracking-[0.18em]" style={{ fontFamily: 'Bebas Neue, Inter, sans-serif' }}>THUNDBALANCE</p>
          <button type="button" onClick={() => setMenuOpen(true)} aria-label={t('nav_menu')} className="rounded-lg p-2 text-gray-300 hover:bg-white/10"><Icon name="menu" /></button>
        </div>

        {menuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/70" onClick={() => setMenuOpen(false)} />
            <aside className="admin-drawer absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-white/10 bg-[#080b0a]">
              <button type="button" onClick={() => setMenuOpen(false)} aria-label={t('nav_close')} className="absolute right-3 top-4 rounded-lg p-2 text-gray-400 hover:bg-white/10"><Icon name="close" /></button>
              {sidebar}
            </aside>
          </div>
        )}

        <main className="px-4 py-8 sm:px-8 lg:ml-64 lg:px-10 lg:py-10">
          <div className="mx-auto max-w-6xl">
            <Outlet context={{ requests, requestsResource, trials, trialsResource }} />
          </div>
        </main>
      </div>
      <ToastHost toasts={toasts} />
    </ToastContext.Provider>
  )
}
