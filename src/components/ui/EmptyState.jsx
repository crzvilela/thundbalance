import Card from './Card'

// Nothing to show (or something went wrong): a card with a short text, an optional title, an icon and an action. `role="alert"` for an error.
//   <EmptyState text={t('in_empty')} />       <EmptyState role="alert" text={t('in_error')} action={<Button …>Retry</Button>} />
export default function EmptyState({ icon, title, text, action, role, className = '', children }) {
  return (
    <Card role={role} className={`relative p-10 text-center text-gray-300 ${className}`.trim()}>
      {icon && <span aria-hidden="true" className="mb-4 flex justify-center text-gray-400">{icon}</span>}
      {title && <p className="mb-2 font-semibold text-white">{title}</p>}
      {text && <p className={role === 'alert' ? 'mb-5 text-gray-200' : undefined}>{text}</p>}
      {children}
      {action}
    </Card>
  )
}
