// THE button of the site. Variants say what it is for, sizes how big it is; both are the classes the pages used before, so moving a button
// here does not change how it looks. Loading shows a spinner, sets aria-busy and ignores clicks; disabled looks disabled.
//   <Button variant="primary" size="lg" loading={busy} onClick={...}>Save</Button>
//   <Button as={Link} to="/profile" variant="secondary">Profile</Button>         (a link that looks like a button)
//   <Button fullOnMobile>…</Button>   the main action of a screen: the whole width on a phone (the thumb), its own size from 640 px;  block: always the whole width
// `plain` + size `none` draws nothing but the behaviour (focus ring, busy, disabled): for tabs and toggles that have their own look.
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const VARIANTS = {
  primary: 'bg-accent text-black hover:bg-accent-hover',
  light: 'bg-white text-black hover:bg-gray-300',
  secondary: 'border border-line-strong text-white hover:bg-white/10',
  outline: 'border border-line-strong text-white hover:bg-white hover:text-black',      // fills white on hover: the second button of a form
  ghost: 'text-gray-300 hover:bg-white/10 hover:text-white disabled:hover:bg-transparent disabled:hover:text-gray-300',
  danger: 'bg-danger text-white hover:bg-danger-hover',
  plain: '',
}

const SIZES = {
  sm: 'min-h-[44px] gap-2 rounded-lg px-3 text-sm transition',
  md: 'min-h-[44px] gap-2 rounded-control px-5 py-2.5 text-sm font-semibold transition',
  lg: 'min-h-[44px] gap-2 rounded-control px-6 py-2.5 text-sm font-semibold transition',
  form: 'gap-3 py-4 uppercase tracking-[3px] transition duration-300',        // the wide uppercase button of the login / registration forms
  none: '',
}

export default function Button({
  as: Component = 'button', variant = 'secondary', size = 'md', radius, loading = false, disabled = false, block = false, fullOnMobile = false, className = '',
  children, onClick, type, ...rest
}) {
  const link = Component !== 'button'
  const blocked = disabled || loading
  const classes = [
    size === 'none' ? '' : 'inline-flex items-center justify-center',
    SIZES[size], radius === 'none' ? 'rounded-none' : radius === 'lg' ? 'rounded-lg' : '', VARIANTS[variant], FOCUS,
    block ? 'w-full' : '', fullOnMobile ? 'w-full sm:w-auto' : '',
    loading ? 'cursor-wait opacity-60' : 'disabled:cursor-not-allowed disabled:opacity-50', blocked && link ? 'cursor-not-allowed opacity-50' : '', className,
  ].filter(Boolean).join(' ')
  const handle = (event) => {
    if (blocked) { event.preventDefault(); return }
    onClick?.(event)
  }
  return (
    <Component
      {...rest}
      {...(link ? { 'aria-disabled': blocked || undefined } : { type: type || 'button', disabled: blocked })}
      aria-busy={loading || undefined}
      onClick={handle}
      className={classes}
    >
      {loading && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />}
      {children}
    </Component>
  )
}
