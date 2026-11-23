// On a phone the on-screen keyboard can cover the field that is being typed in. When a text field gets the focus the page scrolls it to the middle of the
// visible area (after the keyboard has had time to open). Only for touch screens; whoever asks for less motion gets no smooth scrolling.
const FIELD = 'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"]'

export function installKeyboardScroll(target = typeof document === 'undefined' ? null : document) {
  if (!target || typeof window === 'undefined' || typeof window.matchMedia !== 'function' || !window.matchMedia('(pointer: coarse)').matches) return () => {}
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const onFocus = (event) => {
    const field = event.target
    if (!(field instanceof HTMLElement) || !field.matches(FIELD)) return
    window.setTimeout(() => {
      if (document.activeElement !== field) return
      try { field.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' }) } catch { /* an old browser: the browser's own scroll is enough */ }
    }, 300)
  }
  target.addEventListener('focusin', onFocus)
  return () => target.removeEventListener('focusin', onFocus)
}
