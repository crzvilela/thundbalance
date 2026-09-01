export function FieldGroup({ label, children, hint }) {
  return (
    <div className="mb-5">
      {label && (
        <label className="block text-xs uppercase tracking-wider text-gray-400 mb-2">
          {label}
        </label>
      )}
      {children}
      {hint && <p className="text-[11px] text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

export function TextField({ value, onChange, placeholder, label }) {
  return (
    <FieldGroup label={label}>
      <input
        type="text"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 transition"
      />
    </FieldGroup>
  )
}

export function TextAreaField({ value, onChange, label, rows = 4 }) {
  return (
    <FieldGroup label={label}>
      <textarea
        value={value ?? ''}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 transition resize-none"
      />
    </FieldGroup>
  )
}

export function NumberField({ value, onChange, label, unit = 'px', placeholder = '0' }) {
  // Stored value is a CSS string like '12px' (or '' for unset). We only show
  // the bare number in the input and re-append the unit on change, so the
  // stored format stays consistent with the rest of the styleObj fields
  // (inline style values), which are plain CSS strings.
  const numericValue = value === '' || value === undefined || value === null
    ? ''
    : String(value).replace(unit, '')

  const handleChange = (raw) => {
    if (raw === '') {
      onChange('')
      return
    }
    onChange(`${raw}${unit}`)
  }

  return (
    <FieldGroup label={label}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={numericValue}
          placeholder={placeholder}
          onChange={(e) => handleChange(e.target.value)}
          className="flex-1 bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 transition"
        />
        <span className="text-xs text-gray-500 uppercase tracking-wider w-6">{unit}</span>
      </div>
    </FieldGroup>
  )
}

export function ColorField({ value, onChange, label }) {
  const safeValue = /^#([0-9a-f]{3}){1,2}$/i.test(value) ? value : '#000000'

  return (
    <FieldGroup label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={safeValue}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 rounded-lg border border-white/10 bg-transparent cursor-pointer p-0"
        />
        <input
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#ffffff or transparent"
          className="flex-1 bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 transition"
        />
      </div>
    </FieldGroup>
  )
}

export function SelectField({ value, onChange, options, label }) {
  return (
    <FieldGroup label={label}>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 transition"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </FieldGroup>
  )
}

export function SliderField({ value, onChange, label, min = 0, max = 1, step = 0.05 }) {
  return (
    <FieldGroup label={`${label} (${Math.round((value ?? 0) * 100)}%)`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value ?? 0}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-emerald-500"
      />
    </FieldGroup>
  )
}

export function ToggleField({ value, onChange, label }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <span className="text-xs uppercase tracking-wider text-gray-400">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`w-11 h-6 rounded-full transition relative ${value ? 'bg-emerald-500' : 'bg-white/10'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
            value ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}

export function ButtonRow({ children }) {
  return <div className="flex gap-2 mb-5">{children}</div>
}

export function SmallButton({ children, onClick, variant = 'default', disabled }) {
  const base = 'flex-1 text-xs uppercase tracking-wider py-2 rounded-lg transition border'
  const variants = {
    default: 'border-white/15 text-white hover:bg-white/10',
    danger: 'border-red-500/40 text-red-400 hover:bg-red-500/10',
    primary: 'border-emerald-500 bg-emerald-500 text-black hover:bg-emerald-400'
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  )
}
