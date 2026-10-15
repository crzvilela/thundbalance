import { useRef } from 'react'
import { Icon } from '../../admin/ui'

// Accessible tab strip (ARIA tablist). Arrow keys / Home / End move between
// tabs; on narrow screens the strip scrolls sideways instead of wrapping.
export function Tabs({ tabs, value, onChange, label, idPrefix = 'tabs', className = '' }) {
  const refs = useRef({})

  const move = (event, index) => {
    const targets = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }
    if (!(event.key in targets)) return
    event.preventDefault()
    const next = tabs[(targets[event.key] + tabs.length) % tabs.length]
    onChange(next.id)
    refs.current[next.id]?.focus()
  }

  return (
    <div role="tablist" aria-label={label} className={`flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}>
      {tabs.map((tab, index) => {
        const selected = tab.id === value
        return (
          <button
            key={tab.id} ref={node => { refs.current[tab.id] = node }}
            type="button" role="tab" id={`${idPrefix}-tab-${tab.id}`} aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.id}`} tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)} onKeyDown={event => move(event, index)}
            className={`flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 text-sm font-medium outline-none transition focus-visible:bg-white/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400 ${
              selected ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            {tab.icon && <Icon name={tab.icon} className="h-4 w-4" />}
            {tab.label}
            {tab.alert && <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}

// Only the active panel is rendered, so nothing hidden is built or fetched.
export function TabPanel({ id, idPrefix = 'tabs', active, children }) {
  if (!active) return null
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${id}`} aria-labelledby={`${idPrefix}-tab-${id}`} tabIndex={0} className="admin-fade outline-none">
      {children}
    </div>
  )
}
