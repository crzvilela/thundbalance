import { LIMIT, MIN_SIZE } from '../../utils/layout'

// One drag or resize of one element.
//
// While the pointer moves the element is changed directly in the DOM (its
// --mx / --my / --mw / --mh variables), so the page never re-renders per frame
// and the movement stays smooth. The numbers are measured back from the
// element itself, so the result is right whatever the surrounding layout does
// (centered text, grid columns, flex rows...). Nothing is saved until the
// pointer is released: then onCommit receives the final numbers once, which
// becomes a single undo step.

const THRESHOLD = 3 // px of movement before a press turns into a drag
const SNAP = 8 // px from a section's center line that snaps

const round = (value) => Math.round(value)
const limit = (value) => Math.max(-LIMIT, Math.min(LIMIT, value))

export function startGesture({ event, el, mode, base, onTick, onCommit, onEnd }) {
  const rect0 = el.getBoundingClientRect()
  const scopeEl = el.closest('section, footer, header, nav')
  const scope = scopeEl ? scopeEl.getBoundingClientRect() : null
  const original = { x: base.x, y: base.y, width: base.width, height: base.height }
  const state = { ...original }
  const startX = event.clientX
  const startY = event.clientY
  let moved = false
  let guides = { v: null, h: null }

  // Elements often carry a CSS transition (hover effects). It would make the
  // element glide to each new position and report stale measurements, so it is
  // switched off while the gesture runs.
  el.style.setProperty('transition', 'none')
  const restoreTransition = () => el.style.removeProperty('transition')

  const setVar = (name, value) => {
    if (value === null || value === undefined) el.style.removeProperty(name)
    else el.style.setProperty(name, `${round(value)}px`)
  }
  const apply = () => {
    setVar('--mx', state.x)
    setVar('--my', state.y)
    setVar('--mw', state.width)
    setVar('--mh', state.height)
  }

  const west = mode.includes('w')
  const east = mode.includes('e')
  const north = mode.includes('n')
  const south = mode.includes('s')

  const update = (move) => {
    const dx = move.clientX - startX
    const dy = move.clientY - startY
    if (!moved && Math.abs(dx) + Math.abs(dy) < THRESHOLD) return
    moved = true
    guides = { v: null, h: null }

    if (mode === 'move') {
      state.x = limit(round(original.x + dx))
      state.y = limit(round(original.y + dy))
      apply()
      if (scope && !move.altKey) {
        const a = el.getBoundingClientRect()
        const cx = (a.left + a.right) / 2
        const cy = (a.top + a.bottom) / 2
        const scx = (scope.left + scope.right) / 2
        const scy = (scope.top + scope.bottom) / 2
        if (Math.abs(cx - scx) <= SNAP) { state.x = limit(round(state.x + (scx - cx))); guides.v = scx }
        if (Math.abs(cy - scy) <= SNAP) { state.y = limit(round(state.y + (scy - cy))); guides.h = scy }
        apply()
      }
    } else {
      let left = rect0.left
      let right = rect0.right
      let top = rect0.top
      let bottom = rect0.bottom
      if (west) left += dx
      if (east) right += dx
      if (north) top += dy
      if (south) bottom += dy
      let width = Math.max(MIN_SIZE, right - left)
      let height = Math.max(MIN_SIZE, bottom - top)

      // Shift on a corner keeps the proportions.
      if (move.shiftKey && (west || east) && (north || south)) {
        const ratio = rect0.width / rect0.height
        if (Math.abs(width / rect0.width - 1) > Math.abs(height / rect0.height - 1)) height = width / ratio
        else width = height * ratio
      }

      if (west || east) state.width = Math.min(LIMIT, round(width))
      if (north || south) state.height = Math.min(LIMIT, round(height))
      apply()

      // Measure what the page really did, then slide the element so the edge
      // opposite to the handle stays exactly where it was.
      const a = el.getBoundingClientRect()
      if (west || east) {
        if (Math.abs(a.width - width) > 1) state.width = round(a.width) // capped by max-width
        state.x = limit(round(state.x + (east ? rect0.left - a.left : rect0.right - a.right)))
      }
      if (north || south) {
        if (Math.abs(a.height - height) > 1) state.height = round(a.height)
        state.y = limit(round(state.y + (south ? rect0.top - a.top : rect0.bottom - a.bottom)))
      }
      apply()
    }
    onTick?.({ rect: el.getBoundingClientRect(), guides, state: { ...state } })
  }

  const cleanup = () => {
    window.removeEventListener('pointermove', update)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', onKey, true)
  }
  function finish() {
    cleanup()
    restoreTransition()
    if (moved) {
      onCommit({ ...state })
      // The browser sends a click to wherever the pointer was released, which
      // would select the section behind and drop this selection. Swallow it.
      const swallow = (clickEvent) => { clickEvent.stopPropagation(); clickEvent.preventDefault() }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, true), 50)
    }
    onEnd?.(moved)
  }
  function cancel() {
    cleanup()
    restoreTransition()
    Object.assign(state, original)
    apply()
    onEnd?.(false)
  }
  function onKey(key) {
    if (key.key === 'Escape') { key.stopPropagation(); cancel() }
  }

  window.addEventListener('pointermove', update)
  window.addEventListener('pointerup', finish)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('keydown', onKey, true)
  return { cancel }
}
