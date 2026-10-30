import { useId } from 'react'
import { SESSION_TYPES } from '../../utils/pricing'

// Individual | Dual, as a segmented control (two native radio buttons: keyboard, screen readers and forms work
// without extra code). Used by the public site and by the admin; `labels` brings the texts of each.
//   labels: { legend, individual, dual }      tone: 'dark' (the forms) | 'light' (the white pricing section)
const TONES = {
  dark: {
    legend: 'text-gray-400', box: 'border-white/15 bg-black/30',
    option: 'text-gray-300 hover:text-white peer-checked:bg-emerald-400 peer-checked:text-black',
  },
  light: {
    legend: 'text-gray-500', box: 'border-black/15 bg-black/5',
    option: 'text-gray-600 hover:text-black peer-checked:bg-black peer-checked:text-white',
  },
}

export default function SegmentedType({ value, onChange, labels, disabled = false, className = '', tone = 'dark' }) {
  const look = TONES[tone] || TONES.dark
  const name = useId()
  return (
    <fieldset disabled={disabled} className={`min-w-0 ${className}`}>
      <legend className={`mb-2 block text-xs font-medium uppercase tracking-wider ${look.legend}`}>{labels.legend}</legend>
      <div className={`grid w-full grid-cols-2 gap-1 rounded-xl border p-1 sm:inline-grid sm:w-auto sm:min-w-[18rem] ${look.box}`}>
        {SESSION_TYPES.map(type => (
          <label key={type} className="relative">
            <input
              type="radio" name={name} value={type} checked={value === type}
              onChange={() => onChange(type)}
              className="peer sr-only"
            />
            <span className={`flex min-h-[44px] cursor-pointer items-center justify-center rounded-lg px-5 text-sm font-semibold transition peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-400 peer-disabled:cursor-not-allowed peer-disabled:opacity-60 ${look.option}`}>
              {labels[type]}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
