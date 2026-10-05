import { useRef } from 'react'
import { useLandingContent } from '../../content/LandingContentContext'
import { heroTitleLayout, heroTitleStyle } from '../../utils/heroTitle'
import '../HeroTitle.css'

const TITLE_PATH = 'sections.hero.title'
const MIN_WIDTH = 80
const DRAG_THRESHOLD = 3

// Wraps the hero title in the visual editor so it can be moved by dragging and
// its width changed from the side handles, as well as from the numeric fields
// in the properties panel. Both write the same titleLayout.<device> values.
// Like the navbar logo, dragging only works once the title is selected, so a
// plain click still just selects it.
export default function HeroTitleFrame({ section, children }) {
  const { device, selection, updateField } = useLandingContent()
  const selected = selection?.type === 'text' && selection.path === TITLE_PATH
  const layoutPath = `sections.hero.titleLayout.${device}`
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
    const layout = heroTitleLayout(section.titleLayout, device)
    const width = layout.width ?? Math.round(event.currentTarget.closest('[data-hero-title]').getBoundingClientRect().width)
    drag.current = { mode, startX: event.clientX, startY: event.clientY, layout, width, next: { ...layout, width: layout.width }, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const move = event => {
    const d = drag.current
    if (!d) return
    const dx = event.clientX - d.startX
    const dy = event.clientY - d.startY
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
    d.moved = true
    let next
    if (d.mode === 'move') {
      next = { ...d.next, x: Math.round(d.layout.x + dx), y: Math.round(d.layout.y + dy) }
    } else {
      // The title stays centered, so each side moves half of the width change:
      // doubling the pointer distance keeps the handle under the cursor.
      const direction = d.mode === 'e' ? 1 : -1
      next = { ...d.next, width: Math.max(MIN_WIDTH, Math.round(d.width + dx * 2 * direction)) }
    }
    d.next = next
    apply({ x: next.x, y: next.y, ...(next.width !== null ? { width: next.width } : {}) }, false)
  }

  const finish = event => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    // A click without movement changes nothing and adds no undo entry.
    if (!d.moved) return
    // One undoable edit for the whole gesture.
    apply({ x: d.next.x, y: d.next.y, ...(d.next.width !== null ? { width: d.next.width } : {}) }, true)
  }

  return (
    <div
      data-hero-title
      className={`hero-title-frame${selected ? ' is-selected' : ''}`}
      style={heroTitleStyle(section.titleLayout, device)}
      onPointerDown={event => begin(event, 'move')}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      // After a drag the browser sends the click to this frame; keep it from
      // reaching the section (which would deselect the title).
      onClick={event => event.stopPropagation()}
    >
      {children}
      {selected && <span className="hero-title-hint">Drag to move · side handles for width</span>}
      {selected && (
        <>
          <button
            type="button"
            aria-label="Change title width (left handle)"
            className="hero-title-handle hero-title-handle-w"
            onPointerDown={event => begin(event, 'w')}
            onPointerMove={move}
            onPointerUp={finish}
            onPointerCancel={finish}
            onClick={event => event.stopPropagation()}
          />
          <button
            type="button"
            aria-label="Change title width (right handle)"
            className="hero-title-handle hero-title-handle-e"
            onPointerDown={event => begin(event, 'e')}
            onPointerMove={move}
            onPointerUp={finish}
            onPointerCancel={finish}
            onClick={event => event.stopPropagation()}
          />
        </>
      )}
    </div>
  )
}
