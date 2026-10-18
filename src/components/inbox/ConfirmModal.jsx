import { useModalFocus } from '../../hooks/useModalFocus'

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400'

// A small question before something that can not be taken back (declining a session, deleting a message).
// Focus is trapped inside, Esc and the outside click close it (not while the answer is being sent).
export default function ConfirmModal({ title, text, confirmLabel, cancelLabel, busy = false, danger = false, onConfirm, onCancel }) {
  const close = () => { if (!busy) onCancel() }
  const ref = useModalFocus(true, close)
  return (
    <div onClick={close} className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="inbox-confirm-title" aria-describedby="inbox-confirm-text" tabIndex={-1}
        onClick={event => event.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl border border-white/10 bg-[#0b0e0d] p-6 shadow-2xl outline-none sm:rounded-3xl sm:p-8"
      >
        <h2 id="inbox-confirm-title" style={{ fontFamily: 'Bebas Neue' }} className="text-4xl">{title}</h2>
        <p id="inbox-confirm-text" className="mt-3 text-sm text-gray-300">{text}</p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={close} disabled={busy}
            className={`min-h-[44px] w-full rounded-xl border border-white/20 px-5 py-2.5 text-sm font-semibold transition hover:bg-white/10 disabled:opacity-50 sm:w-auto ${FOCUS}`}>
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className={`inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60 sm:w-auto ${FOCUS} ${danger ? 'bg-red-500 text-white hover:bg-red-400' : 'bg-emerald-400 text-black hover:bg-emerald-300'}`}>
            {busy && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
