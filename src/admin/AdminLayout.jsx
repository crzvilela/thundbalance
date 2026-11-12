import { useCallback, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../firebase/auth'
import { ConfirmDialog, Icon } from './ui'
import { LeaveGuardContext } from './leaveGuard'
import AdminErrorBoundary from './AdminErrorBoundary'
import EmailTest from './EmailTest'
import UiSettingsProvider from './UiSettingsProvider'
import EditModeProvider from './EditModeProvider'
import SidebarNav, { CustomizeButton } from './SidebarNav'
import EditBar from './EditBar'
import CustomizePanel from './CustomizePanel'
import { useEditMode } from './editModeContext'
import { useMenuItems } from './uiSettingsContext'
import { ToastContext } from './toastContext'
import { useAdminText } from './useAdminText'
import { useAdminResource } from './useAdminResource'
import { normalizeRequests } from './requests'
import './admin.css'
import './admin-light.css'

const THEME_KEY = 'tb_admin_theme'

// The saved choice (light | dark). Dark is the default; storage can be unavailable.
function readTheme() {
  try { return window.localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}

const linkClass = ({ isActive }) =>
  `group flex min-h-10 items-center gap-3 rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 ${
    isActive
      ? 'bg-emerald-400/10 text-emerald-300 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.2)]'
      : 'text-gray-400 hover:bg-white/5 hover:text-white'
  }`

function ToastHost({ toasts }) {
  return (
    <div className="pointer-events-none fixed bottom-28 right-5 z-[60] sm:bottom-5 flex flex-col gap-2">
      {toasts.map(toast => (
        <div key={toast.id} role="status" className={`admin-toast pointer-events-auto flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur ${
          toast.tone === 'error' ? 'border-red-400/30 bg-red-950/80 text-red-100' : toast.tone === 'warning' ? 'border-amber-400/40 bg-amber-950/90 text-amber-100' : 'border-emerald-400/30 bg-emerald-950/80 text-emerald-100'
        }`}>
          <Icon name={toast.tone === 'error' || toast.tone === 'warning' ? 'alert' : 'check'} className="h-4 w-4 shrink-0" />
          {toast.message}
        </div>
      ))}
    </div>
  )
}

// The menu (names, order, what is hidden) comes from uiRegistry.js and the studio's saved configuration (UiSettingsProvider): with no
// configuration it is exactly the original menu.
export default function AdminLayout() {
  return (
    <UiSettingsProvider>
      <EditModeProvider>
        <AdminShell />
      </EditModeProvider>
    </UiSettingsProvider>
  )
}

function AdminShell() {
  const { t, language, setLanguage } = useAdminText()
  const { items: menuItems, customizeLabel } = useMenuItems()
  const edit = useEditMode()                       // edit mode of the panel (only for the main admin)
  const [editLeaving, setEditLeaving] = useState(null)       // leaving the admin with unsaved panel changes: where to go ('/' or 'logout')
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [toasts, setToasts] = useState([])
  const [theme, setTheme] = useState(readTheme)
  const chooseTheme = (mode) => {
    setTheme(mode)
    try { window.localStorage.setItem(THEME_KEY, mode) } catch { /* the choice just is not remembered */ }
  }
  const nextToastId = useRef(0)

  // A screen with something unsent registers here; leaving through the menu then asks first.
  const guard = useRef(null)
  const [leaving, setLeaving] = useState(null)                 // where the person wanted to go: a path or 'logout'
  const guardValue = useMemo(() => ({
    register: (isDirty) => { guard.current = isDirty; return () => { if (guard.current === isDirty) guard.current = null } }
  }), [])
  const guarded = (target) => (event) => {
    setMenuOpen(false)
    if (guard.current?.()) { event.preventDefault(); setLeaving(target) }
  }
  // leaving the admin itself (the site, logout) with panel changes that are not saved asks first; moving between admin pages never does
  const leaveAdmin = (target) => (event) => {
    setMenuOpen(false)
    if (edit?.dirty) { event.preventDefault(); setEditLeaving(target) }
    else guarded(target)(event)
  }

  // Requests are loaded once here: the sidebar badge, the overview and the
  // requests screen all read the same data.
  const requestsResource = useAdminResource('/admin/client-requests')
  const requests = useMemo(() => normalizeRequests(requestsResource.data), [requestsResource.data])
  const pendingCount = requests.filter(request => request.status === 'pending').length

  const trialsResource = useAdminResource('/admin/trial-sessions')
  const trials = useMemo(() => (Array.isArray(trialsResource.data) ? trialsResource.data.map(trial => ({ ...trial, status: String(trial.status).toLowerCase() })) : []), [trialsResource.data])
  const pendingTrials = trials.filter(trial => trial.status === 'pending').length
  // contact messages: only the count (unread, not archived) is needed here; the Messages page loads its own list
  const messagesResource = useAdminResource('/admin/contact-messages/count')
  const unreadMessages = messagesResource.data?.unread || 0
  // Date-change requests that need an action (pending + counter-proposals); reloaded after every action on the Schedule page.
  const scheduleResource = useAdminResource('/admin/reschedule-requests/count')
  const scheduleCount = scheduleResource.data?.open || 0
  const badges = { requests: pendingCount, trials: pendingTrials, messages: unreadMessages, schedule: scheduleCount }

  const push = useCallback((message, tone = 'success') => {
    const id = ++nextToastId.current
    setToasts(current => [...current, { id, message, tone }])
    // A warning stays longer: it asks the admin to do something.
    window.setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), tone === 'warning' ? 12000 : 4500)
  }, [])
  const toastValue = useMemo(() => ({ push }), [push])

  const logout = async () => {
    await signOut(auth)
    navigate('/admin/login')
  }
  const confirmLeave = () => {
    const target = leaving
    guard.current = null
    setLeaving(null)
    if (target === 'logout') logout()
    else navigate(target)
  }

  const email = auth.currentUser?.email || ''

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 pb-3 pl-5 pr-12 pt-4 lg:pr-5">
        <p className="text-xl tracking-[0.14em] text-white" style={{ fontFamily: 'Bebas Neue, Inter, sans-serif' }}>THUNDBALANCE</p>
        <p className="mt-0.5 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
          {t('brand_sub')}
        </p>
      </div>

      <SidebarNav items={menuItems} badges={badges} linkClass={linkClass} guarded={guarded} customizeLabel={customizeLabel} />

      {/* the footer never scrolls away: Personalizar panel, theme, language, the site and sign out are always reachable
          (it only scrolls inside itself on a very short screen, so the menu above keeps some room) */}
      <div className="admin-nav-scroll max-h-[50dvh] shrink-0 space-y-2 overflow-y-auto border-t border-white/10 p-3">
        <CustomizeButton customizeLabel={customizeLabel} onStart={() => setMenuOpen(false)} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex rounded-lg border border-white/10 bg-black/30 p-0.5" role="group" aria-label={t('theme')}>
            {[['light', 'sun'], ['dark', 'moon']].map(([mode, icon]) => (
              <button key={mode} type="button" onClick={() => chooseTheme(mode)} aria-pressed={theme === mode} aria-label={t(`theme_${mode}`)} title={t(`theme_${mode}`)}
                className={`flex min-h-9 items-center rounded-md px-3 py-1 transition ${theme === mode ? 'bg-emerald-400 text-black' : 'text-gray-400 hover:text-white'}`}>
                <Icon name={icon} className="h-4 w-4" />
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-white/10 bg-black/30 p-0.5" role="group" aria-label={t('language')}>
            {['en', 'es'].map(code => (
              <button key={code} type="button" onClick={() => setLanguage(code)} aria-pressed={language === code}
                className={`min-h-9 rounded-md px-3 py-1 text-xs font-semibold uppercase transition ${language === code ? 'bg-emerald-400 text-black' : 'text-gray-400 hover:text-white'}`}>
                {code}
              </button>
            ))}
          </div>
        </div>
        <EmailTest defaultTo={email} />
        <div className="flex gap-1">
          <NavLink to="/" onClick={leaveAdmin('/')} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm text-gray-400 transition hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400">
            <Icon name="globe" className="h-[18px] w-[18px] shrink-0" /><span className="truncate">{t('nav_site')}</span>
          </NavLink>
          <button type="button" onClick={() => { if (edit?.dirty) setEditLeaving('logout'); else if (guard.current?.()) setLeaving('logout'); else logout() }} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm text-gray-400 transition hover:bg-red-500/10 hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400">
            <Icon name="logout" className="h-[18px] w-[18px] shrink-0" /><span className="truncate">{t('nav_logout')}</span>
          </button>
        </div>
        {email && <p className="truncate px-2.5 text-xs text-gray-600" title={email}>{email}</p>}
      </div>
    </div>
  )

  return (
    <ToastContext.Provider value={toastValue}>
      <LeaveGuardContext.Provider value={guardValue}>
      <div className={`admin-shell min-h-screen text-white ${theme === 'light' ? 'admin-light' : ''}`}>
        <aside className="fixed left-0 top-0 z-30 hidden h-dvh w-64 border-r border-white/[0.07] bg-[#080b0a]/90 backdrop-blur lg:block">
          {sidebar}
        </aside>

        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[0.07] bg-[#080b0a]/90 px-4 py-3 backdrop-blur lg:hidden">
          <p className="text-xl tracking-[0.18em]" style={{ fontFamily: 'Bebas Neue, Inter, sans-serif' }}>THUNDBALANCE</p>
          <button type="button" onClick={() => setMenuOpen(true)} aria-label={t('nav_menu')} className="rounded-lg p-3 text-gray-300 hover:bg-white/10"><Icon name="menu" /></button>
        </div>

        {menuOpen && (
          <div className="fixed inset-x-0 top-0 z-50 h-dvh lg:hidden">
            <div className="absolute inset-0 bg-black/70" onClick={() => setMenuOpen(false)} />
            <aside className="admin-drawer absolute left-0 top-0 h-dvh w-72 max-w-[85vw] border-r border-white/10 bg-[#080b0a]">
              <button type="button" onClick={() => setMenuOpen(false)} aria-label={t('nav_close')} className="absolute right-3 top-4 rounded-lg p-2 text-gray-400 hover:bg-white/10"><Icon name="close" /></button>
              {sidebar}
            </aside>
          </div>
        )}

        <main className={`px-4 py-8 sm:px-8 lg:ml-64 lg:px-10 lg:py-10 ${edit?.isEditing ? 'pb-32' : ''}`}>
          <div className="mx-auto max-w-6xl">
            <AdminErrorBoundary><Outlet context={{ requests, requestsResource, trials, trialsResource, messagesResource, scheduleResource }} /></AdminErrorBoundary>
          </div>
        </main>
      </div>
      <EditBar />
      {edit?.advancedOpen && <CustomizePanel />}
      <ConfirmDialog
        open={!!editLeaving} tone="neutral" icon="alert"
        title={t('ui_leave_title')} text={t('ui_leave_text')}
        confirmLabel={t('ui_leave_yes')} cancelLabel={t('ui_leave_stay')}
        onConfirm={() => { const target = editLeaving; setEditLeaving(null); edit.cancel(); if (target === 'logout') logout(); else navigate(target) }}
        onCancel={() => setEditLeaving(null)}
      />
      <ToastHost toasts={toasts} />
      <ConfirmDialog
        open={!!leaving} tone="neutral" icon="send"
        title={t('bx_leave_title')} text={t('bx_leave_text')}
        confirmLabel={t('bx_leave_yes')} cancelLabel={t('bx_leave_stay')}
        onConfirm={confirmLeave} onCancel={() => setLeaving(null)}
      />
      </LeaveGuardContext.Provider>
    </ToastContext.Provider>
  )
}
