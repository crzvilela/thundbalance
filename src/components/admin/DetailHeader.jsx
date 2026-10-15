import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../admin/ui'

// "···" menu: items are { label, icon, onClick, disabled, hidden, danger }.
// A `danger` item is drawn in red, separated from the rest.
export function MoreMenu({ items, label }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = event => { if (box.current && !box.current.contains(event.target)) setOpen(false) }
    const onKey = event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true) }
  }, [open])
  const visible = items.filter(item => !item.hidden)
  if (!visible.length) return null
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(value => !value)}
        className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 text-gray-100 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-2 w-64 overflow-hidden rounded-xl border border-white/10 bg-[#101413] py-1 shadow-2xl shadow-black/60">
          {visible.map((item, index) => (
            <button key={item.label} type="button" role="menuitem" disabled={item.disabled}
              onClick={() => { setOpen(false); item.onClick() }}
              className={`flex min-h-[44px] w-full items-center gap-3 px-4 text-left text-sm transition disabled:opacity-50 ${
                item.danger
                  ? `text-red-300 hover:bg-red-500/15 ${index > 0 ? 'border-t border-white/10' : ''}`
                  : 'text-gray-100 hover:bg-white/10'
              }`}>
              {item.icon && <Icon name={item.icon} className={`h-4 w-4 ${item.danger ? 'text-red-300' : 'text-gray-400'}`} />}{item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Fixed header of a record: avatar, name, contact line, badges, indicators and
// the main actions. `meta` and `chips` are hidden on phones (the first tab
// repeats them there), so the header stays short.
export default function DetailHeader({ avatar, title, meta, badges, chips, actions, onClose, closeLabel = 'Close' }) {
  return (
    <div className="border-b border-white/10 bg-[#0d1110] px-4 py-4 sm:px-8 sm:py-5">
      <div className="flex items-start gap-3 sm:gap-4">
        {avatar}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold text-white sm:text-2xl">{title}</h2>
          {meta && <div className="mt-1 hidden flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-400 sm:flex">{meta}</div>}
          {badges && <div className="mt-2 flex flex-wrap items-center gap-2">{badges}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-2 sm:flex">{actions}</div>
          <button type="button" onClick={onClose} aria-label={closeLabel}
            className="rounded-xl p-2.5 text-gray-400 transition hover:bg-white/10 hover:text-white"><Icon name="close" className="h-6 w-6" /></button>
        </div>
      </div>
      {chips && <div className="mt-4 hidden grid-cols-2 gap-2 sm:grid lg:grid-cols-4">{chips}</div>}
      {actions && <div className="mt-3 flex items-center gap-2 sm:hidden">{actions}</div>}
    </div>
  )
}
