import { useId, useState } from 'react'
import { Icon } from '../../admin/ui'

// Rounded card with a small uppercase title. `collapsible` turns the title
// into a button that folds the body (open by default).
export default function SectionCard({ title, actions, collapsible = false, defaultOpen = true, tone = 'neutral', children, className = '' }) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  const border = tone === 'amber' ? 'border-amber-400/25 bg-amber-400/5' : 'border-white/[0.08] bg-white/[0.03]'
  const heading = `text-sm font-medium uppercase tracking-wider ${tone === 'amber' ? 'text-amber-200' : 'text-gray-400'}`
  return (
    <section className={`rounded-2xl border p-5 ${border} ${className}`}>
      {(title || actions) && (
        <div className={`flex flex-wrap items-center justify-between gap-3 ${open ? 'mb-4' : ''}`}>
          {collapsible ? (
            <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(value => !value)}
              className={`flex min-h-[32px] items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${heading}`}>
              <Icon name="arrow" className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
              {title}
            </button>
          ) : <h3 className={heading}>{title}</h3>}
          {open && actions}
        </div>
      )}
      <div id={bodyId} hidden={!open}>{children}</div>
    </section>
  )
}
