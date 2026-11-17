import { Button, Modal } from '../ui'

// A small question before something that can not be taken back (declining a session, deleting a message).
// The Modal traps the focus, closes with Esc and with the click outside (not while the answer is being sent) and gives the focus back.
export default function ConfirmModal({ title, text, confirmLabel, cancelLabel, busy = false, danger = false, onConfirm, onCancel }) {
  return (
    <Modal
      title={title} description={text} onClose={onCancel} busy={busy}
      actions={(
        <>
          <Button variant="secondary" className="w-full sm:w-auto" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} className="w-full sm:w-auto" onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </>
      )}
    />
  )
}
