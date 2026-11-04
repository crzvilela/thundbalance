import { useState } from 'react'
import { ConfirmDialog } from './ui'
import RecipientsBox, { SendsTo } from './RecipientsBox'

// A confirmation for an action that sends an email and has no form of its own (resend, cancel, approve a change...): the box of
// recipients, "Se enviará a: ..." and the buttons. `onConfirm(extra)` receives the extra addresses; it opens empty every time.
function Body({ clientEmail, onConfirm, ...dialog }) {
  const [extra, setExtra] = useState([])
  return (
    <ConfirmDialog {...dialog} open onConfirm={() => onConfirm(extra)}>
      <SendsTo clientEmail={clientEmail} extra={extra} />
      <RecipientsBox clientEmail={clientEmail} value={extra} onChange={setExtra} disabled={dialog.busy} />
    </ConfirmDialog>
  )
}

export default function SendConfirm({ open, ...props }) {
  return open ? <Body {...props} /> : null
}
