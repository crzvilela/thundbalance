import { useState } from 'react'

// Splits a long properties panel into a few tabs (Content / Style / Position)
// so only a short part of it is on screen at a time.
// tabs: [{ key, label, node }]
export default function PanelTabs({ tabs }) {
  const [active, setActive] = useState(tabs[0].key)
  const current = tabs.find((tab) => tab.key === active) || tabs[0]

  return (
    <div>
      <div role="tablist" className="mb-5 flex rounded-lg bg-white/[0.05] p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key} type="button" role="tab" aria-selected={current.key === tab.key} onClick={() => setActive(tab.key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition ${current.key === tab.key ? 'bg-emerald-400 text-black' : 'text-gray-400 hover:text-white'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{current.node}</div>
    </div>
  )
}
