import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLandingContent } from '../../content/LandingContentContext'
import { deviceLayout, getElementLayout, HANDLES_BY_KIND, layoutPath } from '../../utils/layout'
import { LayoutEditorContext } from './layoutEditorContext'
import { startGesture } from './layoutGesture'

const HANDLE_POSITION = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5]
}

const findElement = (root, path) => root?.querySelector(`[data-movable-path="${CSS.escape(path)}"]`) || null

// Only the numbers that are set are saved.
const compact = ({ x, y, width, height }) => ({
  x, y, ...(width !== null && width !== undefined ? { width } : {}), ...(height !== null && height !== undefined ? { height } : {})
})

// The editing layer for the visual editor: any element that uses
// useLayoutItem can be pressed and dragged; the selected one gets a box with
// resize handles, snapping guides and arrow-key nudging.
//
// Place it inside the (position: relative) frame that holds the page; `rootRef`
// points to that frame.
export default function LayoutEditor({ rootRef, children }) {
  const { content, device, selection, updateField } = useLandingContent()
  const [box, setBox] = useState(null)
  const [live, setLive] = useState(null)
  const [editing, setEditing] = useState(null)
  const latest = useRef({ content, device, selection })
  const gesture = useRef(null)
  const frame = useRef(0)

  useEffect(() => { latest.current = { content, device, selection } })

  const measureNow = useCallback(() => {
    const root = rootRef.current
    const current = latest.current.selection
    const element = root && current ? findElement(root, current.path) : null
    if (!element) { setBox(null); return }
    const rect = element.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    setBox({
      left: rect.left - rootRect.left, top: rect.top - rootRect.top, width: rect.width, height: rect.height,
      kind: element.dataset.movableKind, path: current.path, label: current.label,
      rootLeft: rootRect.left, rootTop: rootRect.top
    })
  }, [rootRef])

  const scheduleMeasure = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(measureNow)
  }, [measureNow])

  // Re-measure after anything that can move or resize the selected element.
  useEffect(() => {
    scheduleMeasure()
    return () => cancelAnimationFrame(frame.current)
  }, [selection, content, device, scheduleMeasure])

  useEffect(() => {
    const root = rootRef.current
    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener('scroll', scheduleMeasure, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure)
    if (observer && root) observer.observe(root)
    return () => {
      window.removeEventListener('resize', scheduleMeasure)
      window.removeEventListener('scroll', scheduleMeasure, true)
      observer?.disconnect()
    }
  }, [rootRef, scheduleMeasure])

  const begin = useCallback((event, { path, kind, mode, el }) => {
    const root = rootRef.current
    const element = el || findElement(root, path)
    if (!element || !root) return
    event.preventDefault()
    event.stopPropagation()
    gesture.current?.cancel()

    const { content: currentContent, device: currentDevice } = latest.current
    const base = deviceLayout(getElementLayout(currentContent, path), currentDevice)
    const label = latest.current.selection?.label

    gesture.current = startGesture({
      event, el: element, mode, base,
      onTick: ({ rect, guides, state }) => {
        const rootRect = root.getBoundingClientRect()
        setBox({
          left: rect.left - rootRect.left, top: rect.top - rootRect.top, width: rect.width, height: rect.height,
          kind, path, label, rootLeft: rootRect.left, rootTop: rootRect.top
        })
        setLive({ guides, state })
      },
      onCommit: (final) => updateField(`${layoutPath(path)}.${currentDevice}`, compact(final)),
      onEnd: () => {
        gesture.current = null
        setLive(null)
        scheduleMeasure()
      }
    })
  }, [rootRef, updateField, scheduleMeasure])

  // Arrow keys nudge the selected element (Shift = 10px).
  useEffect(() => {
    if (!selection) return undefined
    const onKey = (event) => {
      if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      const step = event.shiftKey ? 10 : 1
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
      if (!delta || !findElement(rootRef.current, selection.path)) return
      event.preventDefault()
      const current = deviceLayout(getElementLayout(latest.current.content, selection.path), latest.current.device)
      updateField(`${layoutPath(selection.path)}.${latest.current.device}`, compact({ ...current, x: current.x + delta[0], y: current.y + delta[1] }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, updateField, rootRef])

  const value = useMemo(() => ({ enabled: true, begin, setEditing }), [begin])
  const handles = box ? (HANDLES_BY_KIND[box.kind] || []) : []

  return (
    <LayoutEditorContext.Provider value={value}>
      {children}
      {box && !editing && (
        <div className="layout-overlay">
          {live?.guides.v != null && <div className="layout-guide is-v" style={{ left: live.guides.v - box.rootLeft }} />}
          {live?.guides.h != null && <div className="layout-guide is-h" style={{ top: live.guides.h - box.rootTop }} />}
          <div
            className="layout-box"
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            onPointerDown={(event) => { if (event.button === 0) begin(event, { path: box.path, kind: box.kind, mode: 'move' }) }}
            onClick={(event) => event.stopPropagation()}
            // A double-click on the box reaches the element underneath (to type into a text).
            onDoubleClick={() => findElement(rootRef.current, box.path)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))}
          >
            {box.label && <span className="layout-chip">{box.label}</span>}
            {handles.map((handle) => (
              <span
                key={handle}
                className="layout-handle"
                data-handle={handle}
                style={{ left: `${HANDLE_POSITION[handle][0] * 100}%`, top: `${HANDLE_POSITION[handle][1] * 100}%` }}
                onPointerDown={(event) => { if (event.button === 0) begin(event, { path: box.path, kind: box.kind, mode: handle }) }}
              />
            ))}
            {live && (
              <span className="layout-readout">
                X {live.state.x} · Y {live.state.y}{live.state.width !== null || live.state.height !== null ? ` · ${Math.round(box.width)}×${Math.round(box.height)}` : ''}
              </span>
            )}
          </div>
        </div>
      )}
    </LayoutEditorContext.Provider>
  )
}
