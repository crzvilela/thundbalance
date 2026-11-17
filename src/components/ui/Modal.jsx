import { useId } from 'react'
import { useModalFocus } from '../../hooks/useModalFocus'

// A dialog over the page. useModalFocus does the accessibility: the focus goes in, Tab stays inside, Esc closes it and the focus goes back
// to what opened it. The click outside closes it too (not while `busy`).
//   <Modal title="…" description="…" onClose={close} actions={<>…buttons…</>} />
// role="alertdialog" for a question that must be answered (default); "dialog" for anything else.
const SIZES = { md: 'max-w-md', lg: 'max-w-lg' }

export default function Modal({ title, description, actions, children, onClose, busy = false, size = 'md', role = 'alertdialog' }) {
  const id = useId()
  const close = () => { if (!busy) onClose() }
  const ref = useModalFocus(true, close)
  return (
    <div onClick={close} className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        ref={ref} role={role} aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-text` : undefined} tabIndex={-1}
        onClick={event => event.stopPropagation()}
        className={`w-full ${SIZES[size]} rounded-t-card border border-line bg-[#0b0e0d] p-6 shadow-2xl outline-none sm:rounded-card sm:p-8`}
      >
        <h2 id={`${id}-title`} style={{ fontFamily: 'Bebas Neue' }} className="text-h1">{title}</h2>
        {description && <p id={`${id}-text`} className="mt-3 text-sm text-gray-300">{description}</p>}
        {children}
        {actions && <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">{actions}</div>}
      </div>
    </div>
  )
}
