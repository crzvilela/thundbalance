// A small label for a state: a session, a pack, a request. Tones come from the tokens; `size` md is the bigger pill of a result.
//   <Badge tone="success">Booked</Badge>      <Badge tone="warn" size="sm">Pending</Badge>
const TONES = {
  success: 'border-accent-line bg-accent-soft text-accent-text',
  warn: 'border-warn-line bg-warn-soft text-warn-text',
  danger: 'border-danger-line bg-danger-soft text-danger-text',
  info: 'border-info-line bg-info-soft text-info-text',
  neutral: 'border-line-strong bg-white/5 text-gray-300',
}
const SIZES = {
  sm: 'gap-1.5 px-2.5 py-0.5 text-[11px] uppercase tracking-wider',
  md: 'gap-2 px-3.5 py-1.5 text-sm',
}

export default function Badge({ tone = 'neutral', size = 'sm', as: Component = 'span', className = '', children, ...rest }) {
  return (
    <Component {...rest} className={`inline-flex items-center rounded-pill border font-semibold ${SIZES[size]} ${TONES[tone]} ${className}`.trim()}>
      {children}
    </Component>
  )
}
