import { useEffect } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Dialogs that are open now, the last one is on top: only that one keeps the focus.
const stack = []

const focusable = (node) => [...node.querySelectorAll(FOCUSABLE)].filter(item => item.getClientRects().length > 0)

// Keeps the keyboard focus inside a dialog while it is open: Tab and Shift+Tab go round, the first
// control gets the focus when it opens (unless something inside already has it, such as an
// autofocus field) and the focus goes back to where it was when it closes. Esc is handled by
// each dialog, because only it knows when it is busy.
export function useFocusTrap(ref, active) {
  useEffect(() => {
    const node = ref.current
    if (!active || !node) return undefined
    const previous = document.activeElement
    stack.push(node)
    if (!node.contains(document.activeElement)) {
      const first = focusable(node)[0]
      if (first) first.focus()
      else { node.setAttribute('tabindex', '-1'); node.focus() }
    }
    const onKey = (event) => {
      if (event.key !== 'Tab' || stack[stack.length - 1] !== node) return
      const items = focusable(node)
      if (!items.length) { event.preventDefault(); node.focus(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const outside = !node.contains(document.activeElement)
      if (event.shiftKey && (outside || document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (outside || document.activeElement === last)) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(node), 1)
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus()
    }
  }, [ref, active])
}
