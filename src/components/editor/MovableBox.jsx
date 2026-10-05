import { useLandingContent } from '../../content/LandingContentContext'
import { useLayoutItem } from './useLayoutItem'

// Makes any block of the page draggable and resizable (a card, the carousel,
// the reviews widget...). On the public site it only applies the saved
// position and size; an untouched box renders exactly as it did before.
//
// `path` is its own layout path, e.g. "sections.services.items.0.card".
export default function MovableBox({ path, label, as: Tag = 'div', className = '', style, children, ...rest }) {
  const { isEditMode, select } = useLandingContent()
  const choose = () => select({ type: 'box', path, label })
  const item = useLayoutItem({ path, kind: 'box', tag: typeof Tag === 'string' ? Tag : '', onSelect: choose })
  const boxStyle = { ...style, ...item.style }

  if (!isEditMode) {
    return <Tag className={`${className} ${item.className}`} style={boxStyle} {...rest}>{children}</Tag>
  }

  return (
    <Tag
      {...item.attrs}
      className={`${className} ${item.className}`}
      style={boxStyle}
      onClick={(event) => { event.stopPropagation(); choose() }}
      {...rest}
    >
      {children}
    </Tag>
  )
}
