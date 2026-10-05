import { useEffect, useRef, useState } from 'react'
import { useLandingContent } from '../../content/LandingContentContext'
import { getPath } from '../../utils/objectPath'
import { resolveImageUrl } from '../../api/landingPage'
import { resolveText, setTextForLanguage } from '../../utils/multilingual'
import { useLayoutEditor } from './layoutEditorContext'
import { useI18n } from '../../i18n/I18nContext'
import { SECTION_LABELS, SECTION_TYPE_INFO } from '../../content/defaultContent'
import { actualFontFamily, loadFont } from '../../utils/fonts'
import { cssFontSizeVariables, getEffectiveTypography } from '../../utils/typography'
import './Typography.css'
import { useLayoutItem } from './useLayoutItem'

function buildInlineStyle(styleObj) {
  if (!styleObj) return undefined
  const style = {}
  for (const [key, value] of Object.entries(styleObj)) {
    if (value !== undefined && value !== null && value !== '') style[key] = value
  }
  return style
}

function buildTextStyle(baseStyle, legacyStyle, content, path, tagName) {
  const typography = getEffectiveTypography(content, path, tagName)
  const inlineStyle = {
    ...(baseStyle || {}),
    ...buildInlineStyle(legacyStyle),
    ...cssFontSizeVariables(typography.fontSize),
    ...(typography.fontFamily ? { fontFamily: `'${actualFontFamily(typography.fontFamily)}', sans-serif` } : {}),
    ...(typography.fontWeight ? { fontWeight: typography.fontWeight } : {}),
    ...(typography.letterSpacing ? { letterSpacing: typography.letterSpacing } : {}),
    ...(typography.lineHeight ? { lineHeight: typography.lineHeight } : {}),
    ...(typography.textTransform ? { textTransform: typography.textTransform } : {}),
    ...(typography.textAlign ? { textAlign: typography.textAlign } : {}),
    ...(typography.color ? { color: typography.color } : {}),
    ...(typography.opacity !== undefined && typography.opacity !== 1 ? { opacity: typography.opacity } : {})
  }
  return { typography, inlineStyle }
}

// --- Section-level selection (click empty section background) ------------

// `sectionKey` is either a fixed key (navbar/hero/footer) or a dynamic
// section instance ID. `label` lets the caller pin an explicit label (every
// section component does, e.g. "Services") so it stays stable and readable
// even for a duplicated instance; falls back to SECTION_LABELS (fixed) or
// SECTION_TYPE_INFO based on the section's `type` (dynamic) otherwise.
// This module intentionally centralizes editor primitives, including hooks
// consumed alongside the components below.
// eslint-disable-next-line react-refresh/only-export-components
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

  return { section, isEditMode, isSelected, onSectionClick, visible: section.visible !== false, theme: content.theme }
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
  const { content, isEditMode, select, selection, updateField } = useLandingContent()
  const { language } = useI18n()
  const editor = useLayoutEditor()
  const raw = getPath(content, path, '')
  const value = resolveText(raw, language)
  const isSelected = isEditMode && selection?.type === 'text' && selection.path === path
  const elementRef = useRef(null)
  const [editing, setEditing] = useState(false)
  const [editVersion, setEditVersion] = useState(0)
  // Buttons keep their own click behavior, so only text tags can be typed into.
  const canType = typeof Tag === 'string' && Tag !== 'button'
  const { typography, inlineStyle } = buildTextStyle(style, styleObj ? getPath(content, styleObj, {}) : null, content, path, typeof Tag === 'string' ? Tag : '')
  useEffect(() => { loadFont(typography.fontFamily) }, [typography.fontFamily])
  const typographyClass = `editable-typography${Object.values(typography.fontSize).some(Boolean) ? ' has-responsive-size' : ''}`
  const item = useLayoutItem({
    path, kind: 'text', tag: typeof Tag === 'string' ? Tag : '',
    onSelect: () => select({ type: 'text', path, styleObj, label: label || path })
  })
  const textStyle = { ...(Object.keys(inlineStyle).length ? inlineStyle : style), ...item.style }

  // Double-click turns the text into an editable field right on the page.
  useEffect(() => {
    const element = elementRef.current
    if (!editing || !element) return
    element.focus()
    const range = document.createRange()
    range.selectNodeContents(element)
    const selected = window.getSelection()
    selected.removeAllRanges()
    selected.addRange(range)
  }, [editing])

  const startTyping = () => {
    if (!canType || editing) return
    select({ type: 'text', path, styleObj, label: label || path })
    setEditing(true)
    editor.setEditing(path)
  }
  const stopTyping = (save) => {
    const element = elementRef.current
    if (save && element) {
      const typed = element.innerText.replace(/\n+$/, '')
      if (typed !== value) updateField(path, setTextForLanguage(raw, language, typed))
    }
    setEditing(false)
    setEditVersion((version) => version + 1) // re-create the element so React and the browser agree on its text
    editor.setEditing(null)
  }

  if (!isEditMode) {
    return (
      <Tag className={`${className} ${typographyClass} ${item.className}`} style={textStyle} {...rest}>
        {value}
      </Tag>
    )
  }

  return (
    <Tag
      key={editVersion}
      ref={elementRef}
      {...item.attrs}
      contentEditable={editing ? 'true' : undefined}
      suppressContentEditableWarning
      className={`${className} ${typographyClass} ${item.className} rounded-sm outline outline-2 outline-offset-4 transition ${
        editing ? 'outline-emerald-400' : isSelected ? 'outline-transparent' : 'outline-transparent hover:outline-emerald-400/40'
      }`}
      style={editing ? { ...textStyle, cursor: 'text', userSelect: 'text' } : textStyle}
      onDoubleClick={startTyping}
      onBlur={editing ? () => stopTyping(true) : undefined}
      onKeyDown={editing ? (event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); stopTyping(true) }
        else if (event.key === 'Escape') { event.preventDefault(); stopTyping(false) }
      } : undefined}
      onPaste={editing ? (event) => {
        event.preventDefault()
        document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
      } : undefined}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        select({ type: 'text', path, styleObj, label: label || path })
        if (onClick) onClick(e)
      }}
      {...rest}
    >
      {value}
    </Tag>
  )
}

// Editable placeholder fields use the same content path, selection, typography
// controls, and history as regular editable text while keeping the current form layout.
export function EditableFormField({ path, as: Tag = 'input', className = '', label, ...props }) {
  const { content, isEditMode, select } = useLandingContent()
  const { language } = useI18n()
  const value = resolveText(getPath(content, path, ''), language)
  const { typography, inlineStyle } = buildTextStyle(null, null, content, path, 'input')
  useEffect(() => { loadFont(typography.fontFamily) }, [typography.fontFamily])
  return <Tag
    {...props}
    aria-label={props['aria-label'] || value || label || path}
    placeholder={value}
    className={`${className} editable-typography${Object.values(typography.fontSize).some(Boolean) ? ' has-responsive-size' : ''} editable-form-field${isEditMode ? ' cursor-text' : ''}`}
    style={inlineStyle}
    onClick={event => {
      if (!isEditMode) return props.onClick?.(event)
      event.preventDefault()
      event.stopPropagation()
      select({ type: 'text', path, label: label || path })
    }}
  />
}

// --- Editable image ----------------------------------------------------------

export function EditableImage({
  path,
  defaultSrc,
  alt = '',
  containerClassName = '',
  imageClassName = '',
  styleObj,
  label,
  movable = true
}) {
  const { content, isEditMode, select, selection } = useLandingContent()
  const stored = getPath(content, path, null)
  const src = resolveImageUrl(stored) || defaultSrc
  const handleImageError = (event) => {
    // Keep the bundled image visible if an old uploaded file is unavailable.
    const img = event.currentTarget
    if (defaultSrc && img.getAttribute('src') !== defaultSrc) {
      img.src = defaultSrc
    }
  }
  const isSelected = isEditMode && selection?.type === 'image' && selection.path === path
  const inlineStyle = buildInlineStyle(styleObj ? getPath(content, styleObj, {}) : null)
  const item = useLayoutItem({
    path, kind: 'image',
    onSelect: () => select({ type: 'image', path, styleObj, label: label || path })
  })
  // The navbar logo has its own drag frame, so it opts out of the generic one.
  const layout = movable ? item : { attrs: {}, className: '', style: undefined }

  if (!isEditMode) {
    return <img src={src} onError={handleImageError} alt={alt} style={{ ...inlineStyle, ...layout.style }} className={`${containerClassName} ${imageClassName} ${layout.className}`} />
  }

  return (
    <div
      {...layout.attrs}
      className={`relative group/img ${containerClassName} ${layout.className}`}
      style={{ ...inlineStyle, ...layout.style }}
      onClick={(e) => {
        e.stopPropagation()
        select({ type: 'image', path, styleObj, label: label || path })
      }}
    >
      <img
        src={src}
        draggable={false}
        onError={handleImageError}
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

export function EditableCtaButton({ path, className = '', fallbackClassName = '', onNavigate, style: styleProp }) {
  const { content, isEditMode, select, selection } = useLandingContent()
  const { language } = useI18n()
  const btn = getPath(content, path, {})
  const buttonText = resolveText(btn.text, language)
  const textPath = `${path}.text`
  const { typography, inlineStyle: textStyle } = buildTextStyle(styleProp, null, content, textPath, 'button')
  useEffect(() => { loadFont(typography.fontFamily) }, [typography.fontFamily])
  const isSelected = isEditMode && selection?.type === 'button' && selection.path === path
  const item = useLayoutItem({
    path, kind: 'button',
    onSelect: () => select({ type: 'button', path, label: 'Button' })
  })

  const style = {
    ...textStyle,
    backgroundColor: btn.bgColor || 'transparent',
    color: typography.color || btn.textColor || '#ffffff',
    borderColor: btn.borderColor || '#ffffff',
    borderRadius: btn.radius || '0px',
    ...item.style
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
      {...item.attrs}
      onClick={handleClick}
      style={style}
      className={`${className} ${fallbackClassName} ${item.className} editable-typography${Object.values(typography.fontSize).some(Boolean) ? ' has-responsive-size' : ''} border transition-all duration-300 cursor-pointer ${
        isEditMode && !isSelected ? 'hover:ring-1 hover:ring-emerald-400/60' : ''
      }`}
    >
      {buttonText}
    </button>
  )
}
