import { useLandingContent } from '../../content/LandingContentContext'
import { getPath } from '../../utils/objectPath'
import { resolveImageUrl } from '../../api/landingPage'
import { SECTION_LABELS, SECTION_TYPE_INFO } from '../../content/defaultContent'

function buildInlineStyle(styleObj) {
  if (!styleObj) return undefined
  const style = {}
  for (const [key, value] of Object.entries(styleObj)) {
    if (value !== undefined && value !== null && value !== '') style[key] = value
  }
  return style
}

// --- Section-level selection (click empty section background) ------------

// `sectionKey` is either a fixed key (navbar/hero/footer) or a dynamic
// section instance ID. `label` lets the caller pin an explicit label (every
// section component does, e.g. "Services") so it stays stable and readable
// even for a duplicated instance; falls back to SECTION_LABELS (fixed) or
// SECTION_TYPE_INFO based on the section's `type` (dynamic) otherwise.
export function useSectionSelection(sectionKey, label) {
  const { content, isEditMode, select, selection } = useLandingContent()
  const section = content.sections[sectionKey] || {}
  const isSelected = isEditMode && selection?.type === 'section' && selection.path === sectionKey
  const resolvedLabel = label || SECTION_LABELS[sectionKey] || SECTION_TYPE_INFO[section.type]?.label || sectionKey

  const onSectionClick = (e) => {
    if (!isEditMode) return
    if (e) e.stopPropagation()
    select({ type: 'section', path: sectionKey, label: resolvedLabel })
  }

  return { section, isEditMode, isSelected, onSectionClick, visible: section.visible !== false }
}

// Absolutely-positioned overlay a section renders as its first child.
// The parent <section> must have `position: relative`.
export function SectionEditOverlay({ isEditMode, isSelected, hidden, label }) {
  if (!isEditMode) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div
        className={`absolute inset-0 border-2 border-dashed transition-colors ${
          isSelected ? 'border-emerald-400' : 'border-transparent'
        }`}
      />
      {isSelected && (
        <span className="absolute -top-px left-3 -translate-y-full bg-emerald-500 text-black text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-t">
          {label}
        </span>
      )}
      {hidden && (
        <div className="absolute top-3 right-3 bg-yellow-400 text-black text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded shadow">
          Hidden from visitors
        </div>
      )}
    </div>
  )
}

// --- Editable text ---------------------------------------------------------

export function EditableText({
  path,
  as: Tag = 'span',
  className = '',
  style,
  styleObj,
  label,
  onClick,
  ...rest
}) {
  const { content, isEditMode, select, selection } = useLandingContent()
  const value = getPath(content, path, '')
  const isSelected = isEditMode && selection?.type === 'text' && selection.path === path
  const inlineStyle = { ...(style || {}), ...buildInlineStyle(styleObj ? getPath(content, styleObj, {}) : null) }

  if (!isEditMode) {
    return (
      <Tag className={className} style={Object.keys(inlineStyle).length ? inlineStyle : style} {...rest}>
        {value}
      </Tag>
    )
  }

  return (
    <Tag
      className={`${className} cursor-pointer rounded-sm outline outline-2 outline-offset-4 transition ${
        isSelected ? 'outline-emerald-400' : 'outline-transparent hover:outline-emerald-400/40'
      }`}
      style={Object.keys(inlineStyle).length ? inlineStyle : style}
      onClick={(e) => {
        e.stopPropagation()
        select({ type: 'text', path, styleObj, label: label || path })
        if (onClick) onClick(e)
      }}
      {...rest}
    >
      {value}
    </Tag>
  )
}

// --- Editable image ----------------------------------------------------------

export function EditableImage({
  path,
  defaultSrc,
  alt = '',
  containerClassName = '',
  imageClassName = '',
  styleObj,
  label
}) {
  const { content, isEditMode, select, selection } = useLandingContent()
  const stored = getPath(content, path, null)
  const src = resolveImageUrl(stored) || defaultSrc
  const isSelected = isEditMode && selection?.type === 'image' && selection.path === path
  const inlineStyle = buildInlineStyle(styleObj ? getPath(content, styleObj, {}) : null)

  if (!isEditMode) {
    return <img src={src} alt={alt} style={inlineStyle} className={`${containerClassName} ${imageClassName}`} />
  }

  return (
    <div
      className={`relative group/img cursor-pointer ${containerClassName}`}
      style={inlineStyle}
      onClick={(e) => {
        e.stopPropagation()
        select({ type: 'image', path, styleObj, label: label || path })
      }}
    >
      <img
        src={src}
        alt={alt}
        className={`${imageClassName} transition ${
          isSelected ? 'ring-2 ring-emerald-400 ring-inset' : 'group-hover/img:ring-2 group-hover/img:ring-emerald-400/60 group-hover/img:ring-inset'
        }`}
      />
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/img:bg-black/40 transition pointer-events-none">
        <span className="opacity-0 group-hover/img:opacity-100 text-white text-[11px] uppercase tracking-wider bg-black/70 px-3 py-1 rounded transition">
          Click to edit image
        </span>
      </div>
    </div>
  )
}

// --- Editable CTA button (text + link + full styling) ----------------------

export function EditableCtaButton({ path, className = '', fallbackClassName = '', onNavigate }) {
  const { content, isEditMode, select, selection } = useLandingContent()
  const btn = getPath(content, path, {})
  const isSelected = isEditMode && selection?.type === 'button' && selection.path === path

  const style = {
    backgroundColor: btn.bgColor || 'transparent',
    color: btn.textColor || '#ffffff',
    borderColor: btn.borderColor || '#ffffff',
    borderRadius: btn.radius || '0px'
  }

  const handleClick = (e) => {
    if (isEditMode) {
      e.preventDefault()
      e.stopPropagation()
      select({ type: 'button', path, label: 'Button' })
      return
    }
    if (onNavigate) onNavigate(btn.link)
  }

  return (
    <button
      onClick={handleClick}
      style={style}
      className={`${className} ${fallbackClassName} border transition-all duration-300 cursor-pointer ${
        isEditMode
          ? isSelected
            ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-black'
            : 'hover:ring-1 hover:ring-emerald-400/60'
          : ''
      }`}
    >
      {btn.text}
    </button>
  )
}
