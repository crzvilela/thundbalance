import '../Movable.css'
import { useLandingContent } from '../../content/LandingContentContext'
import { deviceLayout, getElementLayout, hasLayout, hasSize, layoutVars, resizesHeight, resizesWidth } from '../../utils/layout'
import { useLayoutEditor } from './layoutEditorContext'

// Gives an element its movable behavior.
//
// Visitors: the saved position / size becomes CSS (class + variables), and an
// element nobody moved gets nothing at all, so it renders exactly as before.
// Editor: the element can be pressed to select it and dragged right away; the
// selection box with the resize handles is drawn by SelectionOverlay.
//
//   const item = useLayoutItem({ path, kind: 'text', tag: 'h1', onSelect })
//   <Tag {...item.attrs} className={`${className} ${item.className}`} style={{ ...style, ...item.style }}>
//
// kind: text | button | image | video | box | icon
const FREE_KINDS = ['image', 'video', 'box']

export function useLayoutItem({ path, kind, tag, onSelect }) {
  const { content, device, isEditMode } = useLandingContent()
  const editor = useLayoutEditor()
  const entry = getElementLayout(content, path)
  const inline = tag === 'span'

  if (!isEditMode) {
    if (!hasLayout(entry)) return { attrs: {}, className: '', style: undefined, layout: null }
    const classes = ['movable']
    if (hasSize(entry, 'width')) classes.push('movable-w')
    if (hasSize(entry, 'height')) classes.push('movable-h')
    if (inline) classes.push('movable-inline')
    if (FREE_KINDS.includes(kind)) classes.push('movable-free')
    return { attrs: {}, className: classes.join(' '), style: layoutVars(entry), layout: entry }
  }

  const classes = ['movable']
  if (resizesWidth(kind)) classes.push('movable-w')
  if (resizesHeight(kind)) classes.push('movable-h')
  if (inline) classes.push('movable-inline')
  if (FREE_KINDS.includes(kind)) classes.push('movable-free')

  return {
    attrs: {
      'data-movable-path': path,
      'data-movable-kind': kind,
      onPointerDown: (event) => {
        if (event.button !== 0) return
        // Do not hijack form controls or links that are being used.
        if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return
        onSelect?.()
        editor.begin(event, { path, kind, mode: 'move', el: event.currentTarget })
      }
    },
    className: classes.join(' '),
    style: layoutVars(entry, device),
    layout: deviceLayout(entry, device)
  }
}
