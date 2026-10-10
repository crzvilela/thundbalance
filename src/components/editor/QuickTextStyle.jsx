import { useTypography } from './useTypography'

const ALIGN = [
  { value: 'left', label: 'Align left', icon: <path d="M4 6h16M4 10h10M4 14h16M4 18h10" /> },
  { value: 'center', label: 'Align center', icon: <path d="M4 6h16M7 10h10M4 14h16M7 18h10" /> },
  { value: 'right', label: 'Align right', icon: <path d="M4 6h16M10 10h10M4 14h16M10 18h10" /> }
]

function hexFromRgb(value) {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value || '')
  if (!match) return '#ffffff'
  return `#${match.slice(1, 4).map(part => Number(part).toString(16).padStart(2, '0')).join('')}`
}

// The real, rendered text element, to start from what is actually on screen
// when nothing has been customised yet.
function measure(path) {
  if (typeof document === 'undefined') return null
  const element = document.querySelector(`[data-movable-path="${path}"]`)
  if (!element) return null
  const style = getComputedStyle(element)
  return { size: Number.parseFloat(style.fontSize) || 16, weight: Number(style.fontWeight) || 400, color: hexFromRgb(style.color) }
}

const stepFor = (size) => (size < 20 ? 1 : size < 48 ? 2 : 4)

// Quick controls shown as soon as a text is selected: smaller / bigger letters,
// bold, alignment and colour. The Style tab keeps every other option.
export default function QuickTextStyle({ path }) {
  const { entry, device, update } = useTypography(path)
  const rendered = measure(path)
  const stored = Number.parseFloat(entry.fontSize?.[device])
  const size = Math.round(stored || rendered?.size || 16)
  const weight = Number(entry.fontWeight) || rendered?.weight || 400
  const bold = weight >= 600
  const color = entry.color || rendered?.color || '#ffffff'

  const setSize = (next) => update('fontSize', `${Math.max(8, Math.min(256, Math.round(next)))}px`)
  const button = 'flex h-10 min-w-10 items-center justify-center rounded-lg border px-2 text-sm transition'
  const idle = 'border-white/10 bg-white/[0.04] text-gray-200 hover:bg-white/10'
  const active = 'border-emerald-400/60 bg-emerald-400/15 text-emerald-200'

  return (
    <section className="mb-5 rounded-xl border border-white/10 bg-white/[0.03] p-3" aria-label="Quick text style">
      <p className="mb-2 text-[10px] uppercase tracking-wider text-gray-500">Letter size · {device}</p>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Smaller letters" title="Smaller letters" onClick={() => setSize(size - stepFor(size - 1))} className={`${button} ${idle} text-base font-semibold`}>A−</button>
        <input
          aria-label={`Font size ${device} in pixels`} type="number" min="8" max="256" value={size}
          onChange={(event) => event.target.value && setSize(Number(event.target.value))}
          className="h-10 w-16 rounded-lg border border-white/10 bg-[#111] px-2 text-center text-sm text-white"
        />
        <button type="button" aria-label="Bigger letters" title="Bigger letters" onClick={() => setSize(size + stepFor(size))} className={`${button} ${idle} text-lg font-semibold`}>A+</button>
        <button type="button" aria-label="Bold" aria-pressed={bold} title="Bold" onClick={() => update('fontWeight', bold ? '400' : '700')} className={`${button} ${bold ? active : idle} font-bold`}>B</button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {ALIGN.map(item => (
          <button
            key={item.value} type="button" aria-label={item.label} title={item.label} aria-pressed={entry.textAlign === item.value}
            onClick={() => update('textAlign', entry.textAlign === item.value ? '' : item.value)}
            className={`${button} ${entry.textAlign === item.value ? active : idle}`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">{item.icon}</svg>
          </button>
        ))}
        <label className={`${button} ${idle} ml-auto gap-2`} title="Text color">
          <span className="text-xs">Color</span>
          <input aria-label="Text color" type="color" value={color} onChange={(event) => update('color', event.target.value)} className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0" />
        </label>
      </div>
    </section>
  )
}
