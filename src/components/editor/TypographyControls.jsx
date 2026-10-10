import { ColorField, FieldGroup, SmallButton } from './fields'
import FontFamilyPicker from './FontFamilyPicker'
import { useTypography } from './useTypography'

const WEIGHTS = ['100', '200', '300', '400', '500', '600', '700', '800', '900']
const ALIGNMENTS = ['left', 'center', 'right', 'justify']
const TRANSFORMS = [
  { value: '', label: 'Inherit' }, { value: 'none', label: 'Normal' },
  { value: 'uppercase', label: 'Uppercase' }, { value: 'lowercase', label: 'Lowercase' },
  { value: 'capitalize', label: 'Capitalize' }
]

function toHex(red, green, blue) {
  return `#${[red, green, blue].map(part => Math.max(0, Math.min(255, Number(part) || 0)).toString(16).padStart(2, '0')).join('')}`
}
function rgbFromHex(value) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value || '')
  if (!match) return [0, 0, 0]
  const hex = match[1].length === 3 ? [...match[1]].map(char => char + char).join('') : match[1]
  return [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16))
}

export default function TypographyControls({ path }) {
  const { entry, device, update, clear } = useTypography(path)
  const fontSize = entry.fontSize?.[device] || ''
  const sizeNumber = Number.parseFloat(fontSize) || 16
  const color = entry.color || '#ffffff'
  const rgb = rgbFromHex(color)
  const setRGB = (index, value) => update('color', toHex(...rgb.map((part, i) => i === index ? value : part)))

  return <section className="mt-6 border-t border-white/10 pt-5">
    <h4 className="text-xs uppercase tracking-wider text-emerald-400 mb-4">Typography</h4>
    <FontFamilyPicker value={entry.fontFamily || ''} onChange={value => update('fontFamily', value)} />

    <FieldGroup label={`Font Size · ${device} (px)`}>
      <div className="flex items-center gap-3">
        <input aria-label={`Font size ${device}`} type="range" min="8" max="128" step="1" value={sizeNumber} onChange={event => update('fontSize', `${event.target.value}px`)} className="min-w-0 flex-1 accent-emerald-500" />
        <input aria-label={`Font size ${device} numeric`} type="number" min="8" max="256" value={fontSize ? sizeNumber : ''} placeholder="inherit" onChange={event => update('fontSize', event.target.value ? `${event.target.value}px` : '')} className="w-20 bg-[#111] border border-white/10 rounded-lg px-2 py-2 text-sm text-white" />
      </div>
      <p className="mt-1 text-[10px] text-gray-500">Use the Desktop / Tablet / Mobile switcher above to edit each size.</p>
    </FieldGroup>

    <FieldGroup label="Font Weight">
      <select aria-label="Font Weight" value={entry.fontWeight || ''} onChange={event => update('fontWeight', event.target.value)} className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white">
        <option value="">Inherit</option>{WEIGHTS.map(weight => <option key={weight} value={weight}>{weight}</option>)}
      </select>
    </FieldGroup>

    <FieldGroup label={`Letter Spacing · ${entry.letterSpacing || 'inherit'}`}>
      <div className="flex gap-2"><input aria-label="Letter spacing slider" type="range" min="-10" max="20" step="0.1" value={Number.parseFloat(entry.letterSpacing) || 0} onChange={event => update('letterSpacing', `${event.target.value}px`)} className="flex-1 accent-emerald-500" /><input aria-label="Letter spacing value" type="number" min="-10" max="20" step="0.1" value={Number.parseFloat(entry.letterSpacing) || ''} placeholder="0" onChange={event => update('letterSpacing', event.target.value ? `${event.target.value}px` : '')} className="w-20 bg-[#111] border border-white/10 rounded-lg px-2 py-2 text-sm text-white" /></div>
    </FieldGroup>

    <FieldGroup label={`Line Height · ${entry.lineHeight || 'inherit'}`}>
      <div className="flex gap-2"><input aria-label="Line height slider" type="range" min="0.8" max="2.4" step="0.05" value={Number(entry.lineHeight) || 1.2} onChange={event => update('lineHeight', Number(event.target.value))} className="flex-1 accent-emerald-500" /><input aria-label="Line height value" type="number" min="0.8" max="3" step="0.05" value={entry.lineHeight || ''} placeholder="inherit" onChange={event => update('lineHeight', event.target.value ? Number(event.target.value) : '')} className="w-20 bg-[#111] border border-white/10 rounded-lg px-2 py-2 text-sm text-white" /></div>
    </FieldGroup>

    <FieldGroup label="Text Transform">
      <select aria-label="Text Transform" value={entry.textTransform || ''} onChange={event => update('textTransform', event.target.value)} className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white">{TRANSFORMS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
    </FieldGroup>

    <FieldGroup label="Text Alignment">
      <div className="grid grid-cols-4 gap-1">{ALIGNMENTS.map(alignment => <SmallButton key={alignment} variant={entry.textAlign === alignment ? 'primary' : 'default'} onClick={() => update('textAlign', entry.textAlign === alignment ? '' : alignment)}>{alignment}</SmallButton>)}</div>
    </FieldGroup>

    <ColorField label="Text Color" value={color} onChange={value => update('color', value)} />
    <FieldGroup label="RGB Color">
      <div className="grid grid-cols-3 gap-2">{rgb.map((value, index) => <input key={index} aria-label={['Red', 'Green', 'Blue'][index]} type="number" min="0" max="255" value={value} onChange={event => setRGB(index, event.target.value)} className="w-full bg-[#111] border border-white/10 rounded-lg px-2 py-2 text-sm text-white" />)}</div>
    </FieldGroup>
    <FieldGroup label={`Opacity · ${Math.round((entry.opacity ?? 1) * 100)}%`}>
      <div className="flex gap-2"><input aria-label="Text opacity slider" type="range" min="0" max="1" step="0.01" value={entry.opacity ?? 1} onChange={event => update('opacity', Number(event.target.value))} className="flex-1 accent-emerald-500" /><input aria-label="Text opacity percent" type="number" min="0" max="100" value={Math.round((entry.opacity ?? 1) * 100)} onChange={event => update('opacity', Math.max(0, Math.min(100, Number(event.target.value))) / 100)} className="w-20 bg-[#111] border border-white/10 rounded-lg px-2 py-2 text-sm text-white" /></div>
    </FieldGroup>
    <button type="button" onClick={clear} className="w-full mt-1 rounded-lg border border-white/15 px-3 py-2 text-xs uppercase tracking-wider text-gray-300 hover:bg-white/10">Reset typography</button>
  </section>
}
