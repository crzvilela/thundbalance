import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { BsCalendar3, BsEnvelope, BsHouse, BsPerson } from 'react-icons/bs'
import { useI18n } from '../i18n/I18nContext'
import { useUnreadCount } from '../hooks/useUnreadCount'
import { useBottomNavVisible } from '../utils/clientArea'

// The bottom navigation of the client area on a phone (below 768 px): the four places a client goes to, one thumb away. Home, Sessions, Messages (with the
// number of unread ones) and Profile. It sits above the home bar of the phone (safe area), shows which place is open and leaves room for itself at the
// bottom of the page (body.has-bottom-nav). From a tablet up nothing changes: the top menu has all of it.
const ITEMS = [
  { to: '/dashboard', labelKey: 'bn_home', Icon: BsHouse },
  { to: '/my-sessions', labelKey: 'bn_sessions', Icon: BsCalendar3 },
  { to: '/messages', labelKey: 'bn_messages', Icon: BsEnvelope, unread: true },
  { to: '/profile', labelKey: 'bn_profile', Icon: BsPerson },
]

export default function BottomNav() {
  const { t } = useI18n()
  const visible = useBottomNavVisible()
  const unread = useUnreadCount()

  useEffect(() => {
    if (!visible) return undefined
    document.body.classList.add('has-bottom-nav')
    return () => document.body.classList.remove('has-bottom-nav')
  }, [visible])

  if (!visible) return null
  return (
    <nav aria-label={t('bn_label')} className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {ITEMS.map(({ to, labelKey, Icon, unread: showUnread }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) => `relative flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-400 ${isActive ? 'text-emerald-300' : 'text-gray-400 active:text-white'}`}
              aria-label={showUnread && unread > 0 ? `${t(labelKey)}, ${t('in_aria_bell', { n: unread })}` : undefined}
            >
              {({ isActive }) => (
                <>
                  {isActive && <span aria-hidden="true" className="absolute inset-x-6 top-0 h-0.5 rounded-b bg-emerald-400" />}
                  <span className="relative">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                    {showUnread && unread > 0 && (
                      <span aria-hidden="true" className="absolute -right-3 -top-2 min-w-[18px] rounded-full bg-emerald-400 px-1 py-0.5 text-center text-[10px] font-bold leading-none text-black">{unread > 99 ? '99+' : unread}</span>
                    )}
                  </span>
                  <span className="max-w-full truncate">{t(labelKey)}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
