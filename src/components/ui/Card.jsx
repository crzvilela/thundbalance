// A card: the border, background and radius every client card shares. `radius` 'lg' is --radius-card (the big cards), 'sm' --radius-card-sm.
// `plain` draws no tint (a frame around a form). `highlight` is the border of a card that asks for attention (an unread message). Padding is left to the page (className).
//   <Card highlight={!item.read} className="p-5 sm:p-6">…</Card>
const RADIUS = { lg: 'rounded-card', sm: 'rounded-card-sm' }

export default function Card({ as: Component = 'div', radius = 'lg', highlight = false, plain = false, className = '', children, ...rest }) {
  return (
    <Component {...rest} className={`${RADIUS[radius]} border ${plain ? '' : 'bg-white/[0.025]'} ${highlight ? 'border-accent-line' : 'border-line'} ${className}`.trim()}>
      {children}
    </Component>
  )
}
