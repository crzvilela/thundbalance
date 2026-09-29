import { useEffect, useRef, useState } from 'react'
import { useLandingContent } from '../../content/LandingContentContext'
import { getPath } from '../../utils/objectPath'
import { layoutStyle, responsiveLayoutVariables, MAX_EMBED_HEIGHT } from '../../utils/responsiveLayout'
import './ResizableBlock.css'

export default function ResizableBlock({ path, label, children }) {
  const { content, device, isEditMode, select, updateField } = useLandingContent()
  const layout = getPath(content, path, {}) || {}
  // Changing device remounts the drag surface, cancelling any in-flight drag.
  return <ResizeSurface key={device} {...{ path, label, children, layout, device, isEditMode, select, updateField }} />
}

function ResizeSurface({ path, label, children, layout, device, isEditMode, select, updateField }) {
  const blockRef = useRef(null)
  const dragRef = useRef(null)
  const frameRef = useRef(null)
  const [preview, setPreview] = useState(null)

  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  const selectFooter = event => {
    event.stopPropagation()
    select({ type: 'section', path: 'footer', label: 'Footer' })
  }
  const start = event => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    selectFooter(event)
    const rect = blockRef.current.getBoundingClientRect()
    const parent = blockRef.current.parentElement.getBoundingClientRect()
    const align = layout?.align?.[device] || 'left'
    dragRef.current = {
      x: event.clientX, y: event.clientY, width: rect.width, height: rect.height,
      maxWidth: parent.width, factor: align === 'center' ? 2 : align === 'right' ? -1 : 1,
      next: { width: Math.round(rect.width), height: Math.round(rect.height) }, moved: false
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setPreview(dragRef.current.next)
  }
  const move = event => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    drag.moved ||= Math.abs(dx) + Math.abs(dy) > 2
    drag.next = {
      width: Math.round(Math.min(drag.maxWidth, Math.max(Math.min(120, drag.maxWidth), drag.width + dx * drag.factor))),
      height: Math.round(Math.min(MAX_EMBED_HEIGHT, Math.max(80, drag.height + dy)))
    }
    if (frameRef.current == null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        if (dragRef.current) setPreview(dragRef.current.next)
      })
    }
  }
  const finish = (event, cancelled = false) => {
    const drag = dragRef.current
    if (!drag) return
    if (!cancelled) move(event)
    dragRef.current = null
    cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    setPreview(null)
    if (event.pointerId !== undefined && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancelled && drag.moved) {
      // Width + height are one atomic history entry. Other devices stay intact.
      updateField(path, {
        ...layout,
        width: { ...layout.width, [device]: `${drag.next.width}px` },
        height: { ...layout.height, [device]: `${drag.next.height}px` }
      })
    }
  }
  const handleKeyDown = event => {
    if (event.key === 'Escape') { finish(event, true); return }
    const changes = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }
    if (!changes[event.key]) return
    event.preventDefault()
    const rect = blockRef.current.getBoundingClientRect()
    const step = event.shiftKey ? 10 : 1
    const [x, y] = changes[event.key]
    const maxWidth = blockRef.current.parentElement.clientWidth
    updateField(path, {
      ...layout,
      width: { ...layout.width, [device]: `${Math.round(Math.min(maxWidth, Math.max(Math.min(120, maxWidth), rect.width + x * step)))}px` },
      height: { ...layout.height, [device]: `${Math.round(Math.min(MAX_EMBED_HEIGHT, Math.max(80, rect.height + y * step)))}px` }
    })
  }
  const style = isEditMode ? layoutStyle(layout, device) : responsiveLayoutVariables(layout)
  const align = layout?.align?.[device] || 'left'
  return (
    <div className="footer-embed-slot">
      <div ref={blockRef} data-layout-path={path} data-editor-device={isEditMode ? device : undefined}
        className="responsive-embed" style={{ ...style, ...(preview ? { width: `${preview.width}px`, height: `${preview.height}px` } : {}) }}>
        <div className="footer-embed-frame rounded-xl overflow-hidden border border-white/10 shadow-lg">{children}</div>
        {isEditMode && <>
          <button type="button" className="embed-select" aria-label={`Edit ${label} layout`} onClick={selectFooter} />
          {preview && <output className="embed-dimensions" aria-live="polite">{preview.width} &times; {preview.height} px</output>}
          <button type="button" className={`embed-resize-handle ${align === 'right' ? 'embed-resize-left' : ''}`}
            aria-label={`Resize ${label}`} title="Drag to resize. Arrow keys: 1px; Shift: 10px. Escape: cancel."
            onClick={event => event.stopPropagation()} onPointerDown={start} onPointerMove={move}
            onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
            onLostPointerCapture={event => finish(event, true)} onKeyDown={handleKeyDown}>&#8600;</button>
        </>}
      </div>
    </div>
  )
}
