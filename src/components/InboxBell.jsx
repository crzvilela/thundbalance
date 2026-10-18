import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BsEnvelope, BsEnvelopeFill } from 'react-icons/bs'
import { loadInbox } from '../api/inbox'
import { setUnread } from '../hooks/useUnreadCount'
import { useI18n } from '../i18n/I18nContext'
import { badgeText, fullDate, preview, relativeTime } from '../utils/inboxFormat'

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'

// The number on the envelope. Hidden when it is zero; "9+" from ten. The screen readers get the number from the
// button's own label, so the badge itself is not read twice.
export function UnreadBadge({ count, className = '' }) {
  const text = badgeText(count)
  if (!text) return null
  return (
    <span aria-hidden="true" className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-emerald-400 px-1 text-[11px] font-bold leading-none text-black ${className}`}>
      {text}
    </span>
  )
}

// Desktop: the envelope with its number and a panel with the last 5 messages (opens on click, closes with Esc or a
// click outside). The mobile menu has its own entry that goes straight to the page.
export default function InboxBell({ unread }) {
  const { t, language, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState({ status: 'idle', items: [], at: null })    // idle | loading | ready | error
  const [seen, setSeen] = useState(unread)
  const [announce, setAnnounce] = useState('')
  const box = useRef(null)
  const button = useRef(null)

  // a quiet announcement for screen readers when the number changes (not when the page first shows it)
  if (seen !== unread) {
    setSeen(unread)
    setAnnounce(unread > 0 ? t('in_aria_unread', { n: unread }) : t('in_aria_none'))
  }

  const load = useCallback(() => {
    setPanel(current => ({ ...current, status: 'loading' }))
    loadInbox({ lang: language, page: 1, size: 5 })
      .then(data => { setUnread(data.unread); setPanel({ status: 'ready', items: data.items, at: new Date() }) })
      .catch(() => setPanel(current => ({ ...current, status: 'error' })))
  }, [language])

  const toggle = () => {
    if (!open) load()                       // the list is fetched only when the panel opens
    setOpen(value => !value)
  }

  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => { if (box.current && !box.current.contains(event.target)) setOpen(false) }
    const onKey = (event) => {
      if (event.key === 'Escape') { setOpen(false); button.current?.focus() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const label = unread > 0 ? t('in_aria_bell', { n: unread }) : t('in_aria_bell_zero')
  const Icon = unread > 0 ? BsEnvelopeFill : BsEnvelope

  return (
    <div ref={box} className="relative">
      <button
        ref={button} type="button" onClick={toggle} aria-label={label} aria-haspopup="dialog" aria-expanded={open}
        className={`relative flex h-11 w-11 items-center justify-center rounded-full border border-white/15 text-white transition hover:bg-white/10 ${FOCUS}`}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
        <UnreadBadge count={unread} className="absolute -right-1 -top-1" />
      </button>
      <span role="status" aria-live="polite" className="sr-only">{announce}</span>

      {open && (
        <div role="dialog" aria-label={t('in_panel_title')} className="absolute right-0 z-50 mt-4 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-white/10 bg-black text-left normal-case tracking-normal shadow-2xl shadow-black/60">
          <p className="border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.25em] text-emerald-300">{t('in_panel_title')}</p>

          {panel.status === 'error' ? (
            <div role="alert" className="px-4 py-6 text-center text-sm text-gray-300">
              <p className="mb-3">{t('in_error')}</p>
              <button type="button" onClick={load} className={`min-h-[44px] rounded-xl bg-white px-5 text-sm font-semibold text-black hover:bg-gray-200 ${FOCUS}`}>{t('in_retry')}</button>
            </div>
          ) : panel.status !== 'ready' ? (
            <div role="status" aria-label={t('in_loading')} className="space-y-3 px-4 py-4">
              {[0, 1, 2].map(row => <div key={row} className="h-12 animate-pulse rounded-lg bg-white/[0.06]" />)}
            </div>
          ) : panel.items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-400">{t('in_empty')}</p>
          ) : (
            <ul className="max-h-[22rem] divide-y divide-white/10 overflow-y-auto">
              {panel.items.map(item => (
                <li key={item.id}>
                  <Link to="/messages" onClick={() => setOpen(false)} className={`block px-4 py-3 transition hover:bg-white/[0.06] ${FOCUS}`}>
                    <span className="flex items-start gap-2">
                      {!item.read && <span className="mt-1.5 inline-flex shrink-0"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden="true" /><span className="sr-only">{t('in_new')}</span></span>}
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm ${item.read ? 'text-gray-200' : 'font-semibold text-white'}`}>{item.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-gray-400">{preview(item.body, 80)}</span>
                        <time dateTime={item.date} title={fullDate(item.date, locale)} className="mt-1 block text-[11px] text-gray-500">{relativeTime(item.date, panel.at, locale)}</time>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <Link to="/messages" onClick={() => setOpen(false)} className={`flex min-h-[48px] items-center justify-center border-t border-white/10 text-sm font-semibold text-emerald-300 transition hover:bg-white/[0.06] ${FOCUS}`}>
            {t('in_view_all')}
          </Link>
        </div>
      )}
    </div>
  )
}
