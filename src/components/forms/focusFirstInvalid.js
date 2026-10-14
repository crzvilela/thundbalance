// After a submit with errors: bring the first invalid field into view and put
// the cursor in it. Runs once React has rendered the error states (a timer, not
// requestAnimationFrame, which pauses when the tab is not visible).
export function focusFirstInvalid(container) {
  window.setTimeout(() => {
    const root = container || document
    const field = root.querySelector('[aria-invalid="true"]')
    if (!field) return
    field.scrollIntoView({ behavior: 'smooth', block: 'center' })
    field.focus({ preventScroll: true })
  }, 0)
}
