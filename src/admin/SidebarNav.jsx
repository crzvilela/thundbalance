import { useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAdminText } from './useAdminText'
import { useEditMode } from './editModeContext'
import Editable, { InlineTextField } from './Editable'
import { Icon } from './ui'
import { CUSTOMIZE_KEY, CUSTOMIZE_LABEL_KEY, LABEL_MAX, PROTECTED_MENU_KEYS } from './uiRegistry'

const TOOL = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 text-gray-300 transition hover:border-white/40 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30'

// The menu of the side panel (and of the phone drawer). Normally it is exactly the original menu: the items in the studio's order, the hidden ones
// left out, plus the "Personalizar panel" button for the main admin. While the panel is being edited every item also shows a drag handle, up / down,
// the pencil to rename it and the eye to hide it (hidden items stay, dimmed); a click on the item itself still navigates, so the draft is not lost.
export default function SidebarNav({ items, badges, linkClass, guarded, customizeLabel, onStart }) {
  const { t } = useAdminText()
  const edit = useEditMode()
  const [renaming, setRenaming] = useState('')
  const dragging = useRef('')

  if (!edit?.isEditing) {
    return (
      <nav className="flex-1 space-y-1 px-3" aria-label="Admin">
        {items.filter(item => !item.hidden).map(item => (
          <NavLink key={item.key} to={item.to} end={item.end} className={linkClass} onClick={guarded(item.to)}>
            <Icon name={item.icon} className="h-[18px] w-[18px]" />
            <Editable as="span" className="flex-1" keyPath={`menu:${item.key}`} defaultText={t(item.labelKey)} />
            {item.badge && badges[item.badge] > 0 && (
              <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold leading-none text-black">{badges[item.badge]}</span>
            )}
            {item.arrow && <Icon name="arrow" className="h-4 w-4 opacity-0 transition group-hover:opacity-60" />}
          </NavLink>
        ))}
        {edit?.canEdit && (
          <button type="button" onClick={() => { if (onStart) onStart(); edit.start() }}
            className="group mt-3 flex w-full items-center gap-3 rounded-xl border border-dashed border-white/15 px-3.5 py-2.5 text-left text-sm font-medium text-gray-400 transition hover:border-emerald-400/40 hover:bg-white/5 hover:text-white">
            <Icon name="pencil" className="h-[18px] w-[18px]" />
            <span className="flex-1">{customizeLabel || t(CUSTOMIZE_LABEL_KEY)}</span>
          </button>
        )}
      </nav>
    )
  }

  const rename = (key, text) => { setRenaming(''); edit.setText(`menu:${key}`, text) }
  const areas = edit.draft.menu.filter(item => item.key !== CUSTOMIZE_KEY)

  return (
    <nav className="flex-1 space-y-2 overflow-y-auto px-3 pb-24" aria-label="Admin">
      {items.map((item, index) => {
        const original = t(item.labelKey)
        const name = item.custom || original
        const locked = PROTECTED_MENU_KEYS.includes(item.key)
        const path = `menu:${item.key}`
        return (
          <div
            key={item.key}
            className={`rounded-xl border border-dashed border-emerald-400/30 p-1.5 ${item.hidden ? 'opacity-50' : ''}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); if (dragging.current && dragging.current !== item.key) edit.moveMenuTo(dragging.current, item.key); dragging.current = '' }}
          >
            {renaming === item.key ? (
              <div className="flex items-start gap-3 px-2 py-2 text-sm">
                <Icon name={item.icon} className="mt-1 h-[18px] w-[18px] shrink-0 text-gray-400" />
                <InlineTextField
                  value={edit.draftTextOf(path)} placeholder={original} maxLength={LABEL_MAX} label={`${t('ui_rename')}: ${original}`}
                  onCommit={(text) => rename(item.key, text)} onCancel={() => setRenaming('')}
                />
              </div>
            ) : (
              <NavLink to={item.to} end={item.end} className={linkClass} onClick={guarded(item.to)}>
                <Icon name={item.icon} className="h-[18px] w-[18px]" />
                <span className={`flex-1 ${item.hidden ? 'line-through' : ''}`}>{name}</span>
                {locked && <Icon name="lock" className="h-4 w-4 text-gray-500" />}
              </NavLink>
            )}
            {edit.invalid.get(path) && <p role="alert" className="px-2 text-xs text-red-300">{t(`ui_err_${edit.invalid.get(path)}`)}</p>}
            <div className="mt-1 flex items-center gap-1 px-1">
              <span draggable className={`${TOOL} cursor-grab`} title={t('ui_drag')} aria-hidden="true"
                onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; dragging.current = item.key }}><Icon name="grip" className="h-5 w-5" /></span>
              <button type="button" className={TOOL} onClick={() => edit.moveMenu(item.key, -1)} disabled={index === 0} aria-label={`${t('ui_up')}: ${name}`} title={t('ui_up')}><Icon name="up" className="h-5 w-5" /></button>
              <button type="button" className={TOOL} onClick={() => edit.moveMenu(item.key, 1)} disabled={index === areas.length - 1} aria-label={`${t('ui_down')}: ${name}`} title={t('ui_down')}><Icon name="down" className="h-5 w-5" /></button>
              <button type="button" className={TOOL} onClick={() => setRenaming(item.key)} aria-label={`${t('ui_rename')}: ${name}`} title={t('ui_rename')}><Icon name="pencil" className="h-5 w-5" /></button>
              {locked
                ? <span className={`${TOOL} opacity-60`} title={t('ui_locked')} aria-label={t('ui_locked')} role="img"><Icon name="lock" className="h-5 w-5" /></span>
                : <button type="button" className={TOOL} onClick={() => edit.toggleMenu(item.key)} aria-pressed={item.hidden} aria-label={`${item.hidden ? t('ui_show') : t('ui_hide')}: ${name}`} title={item.hidden ? t('ui_show') : t('ui_hide')}><Icon name={item.hidden ? 'eyeoff' : 'eye'} className="h-5 w-5" /></button>}
              {item.custom && <button type="button" className="ml-auto rounded-md border border-white/15 px-2 py-1 text-xs text-gray-300 hover:text-white" onClick={() => edit.resetMenu(item.key)}>{t('ui_reset_item')}</button>}
            </div>
          </div>
        )
      })}

      <div className="rounded-xl border border-dashed border-white/15 p-1.5">
        {renaming === CUSTOMIZE_KEY ? (
          <div className="flex items-start gap-3 px-2 py-2 text-sm">
            <Icon name="pencil" className="mt-1 h-[18px] w-[18px] shrink-0 text-gray-400" />
            <InlineTextField
              value={edit.draftTextOf(`menu:${CUSTOMIZE_KEY}`)} placeholder={t(CUSTOMIZE_LABEL_KEY)} maxLength={LABEL_MAX} label={`${t('ui_rename')}: ${t(CUSTOMIZE_LABEL_KEY)}`}
              onCommit={(text) => rename(CUSTOMIZE_KEY, text)} onCancel={() => setRenaming('')}
            />
          </div>
        ) : (
          <div className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-gray-300">
            <Icon name="pencil" className="h-[18px] w-[18px]" />
            <span className="flex-1">{customizeLabel || t(CUSTOMIZE_LABEL_KEY)}</span>
            <Icon name="lock" className="h-4 w-4 text-gray-500" />
          </div>
        )}
        <div className="mt-1 flex items-center gap-1 px-1">
          <button type="button" className={TOOL} onClick={() => setRenaming(CUSTOMIZE_KEY)} aria-label={`${t('ui_rename')}: ${t(CUSTOMIZE_LABEL_KEY)}`} title={t('ui_rename')}><Icon name="pencil" className="h-5 w-5" /></button>
          <span className="px-2 text-xs text-gray-500">{t('ui_fixed')}</span>
        </div>
      </div>
    </nav>
  )
}
