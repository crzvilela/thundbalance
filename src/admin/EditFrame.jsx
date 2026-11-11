import { useRef } from 'react'
import { useAdminText } from './useAdminText'
import { useEditMode } from './editModeContext'
import { Icon } from './ui'

const TOOL = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-black/60 text-gray-200 transition hover:border-white/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30'

// Around an Overview card WHILE the panel is being edited (never drawn otherwise): a dashed outline, a drag handle, up / down and the eye to hide
// or show it. A hidden card stays here, dimmed, so it can be shown again; outside edit mode it is not drawn at all.
export default function CardFrame({ card, label, index, count, className = '', children }) {
  const { t } = useAdminText()
  const edit = useEditMode()
  const dragging = useRef('')
  if (!edit?.isEditing) return children
  return (
    <div
      className={`flex h-full flex-col rounded-2xl outline-dashed outline-1 outline-offset-2 outline-emerald-400/40 ${card.hidden ? 'opacity-40' : ''} ${className}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); if (dragging.current && dragging.current !== card.key) edit.moveCardTo(dragging.current, card.key); dragging.current = '' }}
    >
      <div className="mb-1 flex items-center justify-end gap-1 p-1">
        <span
          draggable className={`${TOOL} cursor-grab`} title={t('ui_drag')} aria-hidden="true"
          onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; dragging.current = card.key }}
        ><Icon name="grip" className="h-5 w-5" /></span>
        <button type="button" className={TOOL} onClick={() => edit.moveCard(card.key, -1)} disabled={index === 0} aria-label={`${t('ui_up')}: ${label}`} title={t('ui_up')}><Icon name="up" className="h-5 w-5" /></button>
        <button type="button" className={TOOL} onClick={() => edit.moveCard(card.key, 1)} disabled={index === count - 1} aria-label={`${t('ui_down')}: ${label}`} title={t('ui_down')}><Icon name="down" className="h-5 w-5" /></button>
        <button type="button" className={TOOL} onClick={() => edit.toggleCard(card.key)} aria-pressed={card.hidden} aria-label={`${card.hidden ? t('ui_show') : t('ui_hide')}: ${label}`} title={card.hidden ? t('ui_show') : t('ui_hide')}>
          <Icon name={card.hidden ? 'eyeoff' : 'eye'} className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
