import { useRef } from 'react'
import { useLandingContent } from '../../content/LandingContentContext'
import { getPath } from '../../utils/objectPath'
import { get360Layout } from '../../utils/responsiveLayout'
import './Resizable360Viewer.css'

const handles = ['nw', 'ne', 'sw', 'se']

export default function Resizable360Viewer({ sectionId, src }) {
  const { content, device, isEditMode, selection, select, updateField } = useLandingContent()
  const path = `sections.${sectionId}.embed360Layout`
  const saved = getPath(content, path, {})
  const layout = get360Layout(saved, device)
  const drag = useRef(null)
  const frame = useRef(0)
  const pendingSize = useRef(null)
  const selected = selection?.type === 'section' && selection.path === sectionId
  const setField = (key, value, commit = true) => updateField(`${path}.${device}.${key}`, value, { commit })
  const begin = (event, handle) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    const rect = event.currentTarget.parentElement.getBoundingClientRect()
    drag.current = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, handle }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = event => {
    if (!drag.current) return
    const d = drag.current
    const sx = d.handle.includes('e') ? 1 : -1
    const sy = d.handle.includes('s') ? 1 : -1
    const width = Math.max(120, Math.round(d.width + (event.clientX - d.x) * sx))
    const height = Math.max(120, Math.min(2000, Math.round(d.height + (event.clientY - d.y) * sy)))
    pendingSize.current = { width, height }
    if (!frame.current) frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const size = pendingSize.current
      if (size) {
        setField('width', `${size.width}px`, false)
        setField('height', `${size.height}px`, false)
      }
    })
  }
  const finish = event => {
    if (!drag.current) return
    move(event)
    drag.current = null
    if (frame.current) cancelAnimationFrame(frame.current)
    frame.current = 0
    const size = pendingSize.current
    pendingSize.current = null
    if (size) {
      setField('width', `${size.width}px`, false)
      setField('height', `${size.height}px`, false)
    }
    // Commit the final values as one undoable edit after live preview updates.
    updateField(path, { ...saved, [device]: { ...layout, ...(size ? { width: `${size.width}px`, height: `${size.height}px` } : {}) } })
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const containerStyle = {
    width: layout.containerWidth, height: layout.containerHeight,
    maxWidth: layout.containerMaxWidth,
    minHeight: layout.containerHeight === 'auto' ? undefined : layout.containerHeight,
    display: 'flex', justifyContent: layout.align === 'left' ? 'flex-start' : layout.align === 'right' ? 'flex-end' : 'center',
    alignItems: layout.verticalAlign === 'top' ? 'flex-start' : layout.verticalAlign === 'bottom' ? 'flex-end' : 'center',
    padding: layout.padding, marginTop: layout.marginTop, marginBottom: layout.marginBottom,
    marginLeft: layout.marginLeft, marginRight: layout.marginRight,
    position: 'relative', left: layout.offsetX, top: layout.offsetY,
    boxSizing: 'border-box'
  }
  const frameStyle = {
    width: layout.width, height: layout.height, minWidth: layout.minWidth, maxWidth: layout.maxWidth,
    minHeight: layout.minHeight, maxHeight: layout.maxHeight, borderRadius: layout.borderRadius,
    overflow: 'hidden', border: '1px solid rgba(255,255,255,.1)', boxShadow: '0 10px 25px rgba(0,0,0,.18)',
    boxSizing: 'border-box', flex: '0 1 auto'
  }
  const responsiveStyle = {}
  for (const target of ['mobile', 'tablet', 'desktop']) {
    const values = get360Layout(saved, target)
    const justify = values.align === 'left' ? 'flex-start' : values.align === 'right' ? 'flex-end' : 'center'
    const alignItems = values.verticalAlign === 'top' ? 'flex-start' : values.verticalAlign === 'bottom' ? 'flex-end' : 'center'
    for (const key of ['width', 'height', 'containerWidth', 'containerHeight', 'containerMaxWidth', 'maxWidth', 'minWidth', 'maxHeight', 'minHeight', 'padding', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'offsetX', 'offsetY', 'borderRadius']) {
      responsiveStyle[`--viewer-${target}-${key}`] = values[key]
    }
    responsiveStyle[`--viewer-${target}-justify`] = justify
    responsiveStyle[`--viewer-${target}-align`] = alignItems
  }

  return <div className={`viewer360-container ${isEditMode ? 'viewer360-editor' : 'viewer360-published'}`} data-editor-device={isEditMode ? device : undefined} style={isEditMode ? containerStyle : responsiveStyle} onClick={e => { if (isEditMode) { e.stopPropagation(); select({ type: 'section', path: sectionId, label: 'About' }) } }}>
    <div className={`viewer360-frame ${selected && isEditMode ? 'is-selected' : ''}`} style={isEditMode ? frameStyle : undefined}>
      <iframe src={src} title="360° view" loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen style={{ display: 'block', width: '100%', height: '100%', border: 0 }} />
      {selected && isEditMode && handles.map(handle => <button key={handle} type="button" aria-label={`Resize 360° viewer ${handle}`} className={`viewer360-handle viewer360-handle-${handle}`} onPointerDown={e => begin(e, handle)} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onClick={e => e.stopPropagation()} />)}
    </div>
  </div>
}
