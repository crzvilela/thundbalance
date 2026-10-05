import { useRef } from 'react'
import { useLandingContent } from '../../content/LandingContentContext'
import { navbarLogoLayout, navbarLogoStyle } from '../../utils/navbarLogo'

const HANDLES = ['nw', 'ne', 'sw', 'se']
const LOGO_PATH = 'sections.navbar.logoImage'
const MIN_SIZE = 8

// Wraps the navbar logo in the visual editor so it can be moved by dragging
// and resized from the corner handles, as well as with the numeric fields in
// the properties panel. Both write the same `logoLayout.<device>` values
// (width/height/x/y in px). Dragging only works once the logo is selected, so
// a plain click still just selects it.
export default function NavbarLogoFrame({ section, children }) {
  const { device, selection, updateField } = useLandingContent()
  const selected = selection?.type === 'image' && selection.path === LOGO_PATH
  const layoutPath = `sections.navbar.logoLayout.${device}`
  const drag = useRef(null)

  const apply = (values, commit) => {
    if (commit) {
      updateField(layoutPath, { ...values })
    } else {
      for (const [key, value] of Object.entries(values)) updateField(`${layoutPath}.${key}`, value, { commit: false })
    }
  }

  const begin = (event, mode) => {
    if (event.button !== 0 || !selected) return
    event.preventDefault()
    event.stopPropagation()
    const layout = navbarLogoLayout(section.logoLayout, device)
    drag.current = { mode, startX: event.clientX, startY: event.clientY, layout, next: layout }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const move = event => {
    const d = drag.current
    if (!d) return
    const dx = event.clientX - d.startX
    const dy = event.clientY - d.startY
    const { width, height, x, y } = d.layout
    let next
    if (d.mode === 'move') {
      next = { width, height, x: Math.round(x + dx), y: Math.round(y + dy) }
    } else {
      const sx = d.mode.includes('e') ? 1 : -1
      const newWidth = Math.max(MIN_SIZE, Math.round(width + dx * sx))
      const newHeight = Math.max(MIN_SIZE, Math.round(newWidth * height / width))
      next = {
        width: newWidth,
        height: newHeight,
        x: d.mode.includes('w') ? Math.round(x + width - newWidth) : x,
        y: d.mode.includes('n') ? Math.round(y + height - newHeight) : y
      }
    }
    d.next = next
    apply(next, false)
  }

  const finish = event => {
    const d = drag.current
    if (!d) return
    drag.current = null
    // One undoable edit for the whole gesture.
    apply(d.next, true)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      data-navbar-logo
      className="navbar-logo shrink-0 mix-blend-screen"
      style={{ ...navbarLogoStyle(section.logoLayout, device), cursor: selected ? 'move' : undefined, touchAction: selected ? 'none' : undefined }}
      onPointerDown={event => begin(event, 'move')}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      {children}
      {selected && HANDLES.map(handle => (
        <button
          key={handle}
          type="button"
          aria-label={`Resize logo ${handle}`}
          className={`viewer360-handle viewer360-handle-${handle}`}
          style={{ touchAction: 'none' }}
          onPointerDown={event => begin(event, handle)}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
          onClick={event => event.stopPropagation()}
        />
      ))}
    </div>
  )
}
