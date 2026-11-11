import { useRef, useState } from 'react'
import { useAdminText } from './useAdminText'
import { useEditMode } from './editModeContext'
import { Icon } from './ui'
import { editableView, inlineReduce, limitOfPath } from './uiSettings'

// The text field that replaces a word while it is being renamed on the panel. It lives only while open: Enter or leaving the field keeps the
// text, Esc drops it, typing stops at the limit with a counter, and an empty text puts the original back (the placeholder shows it).
// The decisions are inlineReduce (uiSettings.js).
export function InlineTextField({ value, placeholder, maxLength, label, onCommit, onCancel, className = '', style }) {
  const { t } = useAdminText()
  const [text, setText] = useState(value)
  const finished = useRef(false)

  const finish = (type) => {
    if (finished.current) return
    finished.current = true
    const next = inlineReduce({ open: true, text }, { type }, { max: maxLength, current: value })
    if (next.commit === undefined) onCancel()
    else onCommit(next.commit)
  }

  return (
    <span className="inline-flex max-w-full flex-col align-top" onClick={(event) => { event.preventDefault(); event.stopPropagation() }}>
      <input
        autoFocus
        aria-label={label}
        value={text}
        maxLength={maxLength}
        placeholder={placeholder}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setText(inlineReduce({ open: true, text }, { type: 'change', text: event.target.value }, { max: maxLength, current: value }).text)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); finish('confirm') }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish('cancel') }
        }}
        onBlur={() => finish('confirm')}
        className={`w-[min(100%,28rem)] rounded-lg border border-dashed border-emerald-400/70 bg-black/40 px-2 py-1 text-white outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-400/20 ${className}`}
        style={{ font: 'inherit', letterSpacing: 'inherit', ...style }}
      />
      <span className="mt-1 text-xs tabular-nums text-gray-400" aria-live="polite">{text.length}/{maxLength} · {t('ui_inline_hint')}</span>
    </span>
  )
}

// A text of the panel that the studio can rename. Outside edit mode (and for anyone who cannot edit) it draws the text and NOTHING else: the
// same element a plain text would be. In edit mode it gets a dashed outline and a pencil, clicking it (or Enter) opens the field, and a small
// "Reset" appears when the text is already customised.
//   keyPath      a text of uiRegistry.EDITABLE_TEXTS ('menu:requests', 'overview:week', 'page:trials:title' ...): where the custom text lives
//   defaultText  the original text (what is shown while nothing is customised, and the placeholder of the field)
//   as           the element to draw (span, h1, h2, p ...), className / style / other props go to it
export default function Editable({ keyPath, defaultText, maxLength, as: Tag = 'span', className = '', ...rest }) {
  const { t } = useAdminText()
  const edit = useEditMode()
  const [open, setOpen] = useState(false)
  const view = editableView({ canEdit: !!edit?.canEdit, isEditing: !!edit?.isEditing, custom: edit?.textOf(keyPath) || '', defaultText })

  // as="text": nothing but the text itself (the text of a button, a tab, a label): no element of its own outside edit mode
  if (view.mode === 'plain') return view.text ? (Tag === 'text' ? <>{view.text}</> : <Tag className={className} {...rest}>{view.text}</Tag>) : null
  const Element = Tag === 'text' ? 'span' : Tag

  const limit = maxLength ?? limitOfPath(keyPath)
  const problem = edit.invalid.get(keyPath)
  const label = `${t('ui_rename')}: ${defaultText}`
  const stop = (event) => { event.preventDefault(); event.stopPropagation() }

  if (open) {
    return (
      <InlineTextField
        value={edit.draftTextOf(keyPath)} placeholder={defaultText} maxLength={limit} label={label}
        onCommit={(text) => { setOpen(false); edit.setText(keyPath, text) }} onCancel={() => setOpen(false)}
      />
    )
  }

  return (
    <span className="inline-flex max-w-full flex-col align-top">
      <span className="group/edit inline-flex max-w-full items-center gap-2">
        <Element
          {...rest}
          role="button" tabIndex={0} aria-label={label} title={label}
          onClick={(event) => { stop(event); setOpen(true) }}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { stop(event); setOpen(true) } }}
          className={`${className} cursor-text rounded-md outline-dashed outline-1 outline-offset-4 ${problem ? 'outline-red-400' : 'outline-emerald-400/45 hover:outline-emerald-300 focus-visible:outline-emerald-300'}`}
        >
          {view.text}
        </Element>
        <Icon name="pencil" className="h-4 w-4 shrink-0 text-emerald-300 opacity-100 transition md:opacity-0 md:group-hover/edit:opacity-100" />
        {view.custom && (
          <button type="button" onClick={(event) => { stop(event); edit.resetText(keyPath) }}
            className="shrink-0 rounded-md border border-white/15 px-2 py-0.5 text-xs text-gray-300 transition hover:border-white/40 hover:text-white">
            {t('ui_reset_item')}
          </button>
        )}
      </span>
      {problem && <span role="alert" className="mt-1 text-xs text-red-300">{t(`ui_err_${problem}`)}</span>}
    </span>
  )
}
