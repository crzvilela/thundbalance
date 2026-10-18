import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Accessible modal behaviour: focus moves into the dialog when it opens and is trapped there
// (Tab / Shift+Tab loop), Escape closes it, and focus goes back to the element that opened it.
// Returns the ref to put on the dialog container.
export function useModalFocus(open, onClose) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)

  useEffect(() => { closeRef.current = onClose })

  useEffect(() => {
    if (!open) return undefined
    const opener = document.activeElement
    const container = ref.current
    const items = () => (container ? [...container.querySelectorAll(FOCUSABLE)].filter(item => item.offsetParent !== null) : [])

    // first control (or the dialog itself) gets the focus
    const first = items()[0]
    if (first) first.focus()
    else if (container) container.focus()

    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current?.()
        return
      }
      if (event.key !== 'Tab' || !container) return
      const list = items()
      if (list.length === 0) { event.preventDefault(); container.focus(); return }
      const firstItem = list[0]
      const lastItem = list[list.length - 1]
      if (event.shiftKey && (document.activeElement === firstItem || document.activeElement === container)) {
        event.preventDefault(); lastItem.focus()
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault(); firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'                // the page behind does not scroll
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
    }
  }, [open])

  return ref
}
