import { useEffect, useRef, useState } from 'react'
import { useAdminText } from './useAdminText'
import { useToast } from './toastContext'
import { useUiSettings } from './uiSettingsContext'
import { Button, ConfirmDialog, Drawer, Icon } from './ui'
import {
  CUSTOMIZE_KEY, CUSTOMIZE_LABEL_KEY, LABEL_MAX, MENU_ITEMS, OVERVIEW_CARDS, PAGES, PROTECTED_MENU_KEYS, SUBTITLE_MAX
} from './uiRegistry'
import { moveItem, moveToItem, resetItem, setItemText, setPageText, toggleHidden } from './uiSettings'

const TABS = ['menu', 'overview', 'pages']
const CONTROL = 'w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-base text-white outline-none transition focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-400/15'
const ICON_BUTTON = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-gray-300 transition hover:border-white/30 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent'

// One row of the menu / Overview lists: drag handle, name, and the buttons that do the same without dragging
// (up, down, rename, hide / show, reset). Everything is reachable with the keyboard and works with touch.
function Row({ item, original, field, fixed, locked, isFirst, isLast, editing, onEdit, onMove, onText, onToggle, onReset, onDragStart, onDrop, dragging, t }) {
  const name = item[field] || original
  const input = useRef(null)
  useEffect(() => { if (editing) input.current?.focus() }, [editing])
  const changed = !!item[field] || item.hidden
  return (
    <li
      className={`rounded-2xl border bg-white/[0.02] p-3 transition ${dragging ? 'border-emerald-400/50 opacity-60' : 'border-white/10'} ${item.hidden ? 'opacity-60' : ''}`}
      draggable={!fixed}
      onDragStart={fixed ? undefined : (event) => { event.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragOver={fixed ? undefined : (event) => event.preventDefault()}
      onDrop={fixed ? undefined : (event) => { event.preventDefault(); onDrop() }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`flex h-11 w-7 shrink-0 items-center justify-center ${fixed ? 'text-gray-600' : 'cursor-grab text-gray-500'}`} title={fixed ? t('ui_fixed') : t('ui_drag')} aria-hidden="true">
          <Icon name={fixed ? 'lock' : 'grip'} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <p className={`flex items-center gap-1.5 truncate font-medium ${item.hidden ? 'text-gray-400 line-through' : 'text-white'}`}>
            <span className="truncate">{name}</span>
            {locked && <Icon name="lock" className="h-4 w-4 shrink-0 text-gray-500" />}
          </p>
          {item[field] && <p className="truncate text-xs text-gray-500">{t('ui_original').replace('{name}', original)}</p>}
          {locked && <p className="text-xs text-gray-500">{t('ui_locked')}</p>}
          {fixed && <p className="text-xs text-gray-500">{t('ui_fixed')}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!fixed && <>
            <button type="button" className={ICON_BUTTON} onClick={() => onMove(-1)} disabled={isFirst} aria-label={`${t('ui_up')}: ${name}`} title={t('ui_up')}><Icon name="up" className="h-5 w-5" /></button>
            <button type="button" className={ICON_BUTTON} onClick={() => onMove(1)} disabled={isLast} aria-label={`${t('ui_down')}: ${name}`} title={t('ui_down')}><Icon name="down" className="h-5 w-5" /></button>
          </>}
          <button type="button" className={ICON_BUTTON} onClick={onEdit} aria-expanded={editing} aria-label={`${t('ui_rename')}: ${name}`} title={t('ui_rename')}><Icon name="pencil" className="h-5 w-5" /></button>
          {!locked && (
            <button type="button" className={ICON_BUTTON} onClick={onToggle} aria-pressed={item.hidden} aria-label={`${item.hidden ? t('ui_show') : t('ui_hide')}: ${name}`} title={item.hidden ? t('ui_show') : t('ui_hide')}>
              <Icon name={item.hidden ? 'eyeoff' : 'eye'} className="h-5 w-5" />
            </button>
          )}
          <button type="button" className={`${ICON_BUTTON} !w-auto px-3 text-sm`} onClick={onReset} disabled={!changed} aria-label={`${t('ui_reset_item')}: ${name}`}>{t('ui_reset_item')}</button>
        </div>
      </div>
      {editing && (
        <label className="mt-3 block">
          <span className="mb-1.5 flex items-center justify-between text-xs uppercase tracking-wider text-gray-400">
            <span>{t('ui_name')}</span><span className="tabular-nums" aria-live="polite">{(item[field] || '').length}/{LABEL_MAX}</span>
          </span>
          <input ref={input} className={CONTROL} value={item[field]} maxLength={LABEL_MAX} placeholder={original} onChange={(event) => onText(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onEdit() } }} />
        </label>
      )}
    </li>
  )
}

function ItemList({ list, originalOf, field, isMenu, onChange, onWarn, t }) {
  const [editingKey, setEditingKey] = useState('')
  const dragKey = useRef('')
  const [dragging, setDragging] = useState('')
  const movable = list.filter(item => item.key !== CUSTOMIZE_KEY)
  return (
    <ul className="space-y-2">
      {list.map(item => {
        const locked = isMenu && PROTECTED_MENU_KEYS.includes(item.key)         // cannot be hidden (lock)
        const fixed = isMenu && item.key === CUSTOMIZE_KEY                      // and this one is also always last
        const index = movable.findIndex(candidate => candidate.key === item.key)
        return (
          <Row
            key={item.key} item={item} original={originalOf(item.key)} field={field} t={t}
            fixed={fixed} locked={locked} isFirst={index === 0} isLast={index === movable.length - 1}
            editing={editingKey === item.key} dragging={dragging === item.key}
            onEdit={() => setEditingKey(editingKey === item.key ? '' : item.key)}
            onMove={(delta) => onChange(moveItem(list, item.key, delta))}
            onText={(value) => onChange(setItemText(list, item.key, field, value))}
            onToggle={() => {
              if (locked) { onWarn('ui_warn_protected'); return }
              const result = toggleHidden(list, item.key, { isMenu })
              if (result.error) onWarn(result.error === 'too_few_visible' ? 'ui_warn_min' : 'ui_warn_protected')
              else { onWarn(''); onChange(result.list) }
            }}
            onReset={() => onChange(resetItem(list, item.key, field))}
            onDragStart={() => { dragKey.current = item.key; setDragging(item.key) }}
            onDrop={() => { if (dragKey.current) onChange(moveToItem(list, dragKey.current, item.key)); dragKey.current = ''; setDragging('') }}
          />
        )
      })}
    </ul>
  )
}

// The editor ("Personalizar panel"): three tabs (Menu, Overview, Pages) over the draft held by the provider. The panel behind already shows the
// draft (live preview); Save stores it for the whole studio, Cancel drops it, "Reset everything" removes the stored configuration.
export default function CustomizePanel() {
  const { t } = useAdminText()
  const toast = useToast()
  const ui = useUiSettings()
  const [tab, setTab] = useState('menu')
  const [warning, setWarning] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const dirty = !!ui?.dirty

  // closing the page with something unsaved asks first
  useEffect(() => {
    if (!dirty) return undefined
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (!ui || !ui.draft) return null
  const draft = ui.draft
  const update = (patch) => { setWarning(''); ui.setDraft({ ...draft, ...patch }) }
  const requestClose = () => { if (dirty) setConfirmLeave(true); else ui.cancelEditing() }

  const errorText = () => {
    if (!ui.error) return ''
    const known = t(`ui_err_${ui.error.code}`)
    return known !== `ui_err_${ui.error.code}` ? known : t('ui_err_generic')      // the server's own message is technical English: the panel always speaks ES / EN
  }

  const save = async () => { if (await ui.save()) toast.push(t('ui_saved')) }
  const reset = async () => { if (await ui.resetAll()) { setConfirmReset(false); toast.push(t('ui_reset_ok')) } else setConfirmReset(false) }

  const menuOriginal = (key) => (key === CUSTOMIZE_KEY ? t(CUSTOMIZE_LABEL_KEY) : t(MENU_ITEMS.find(item => item.key === key)?.labelKey))
  const cardOriginal = (key) => t(OVERVIEW_CARDS.find(card => card.key === key)?.titleKey)

  return (
    <>
      <Drawer
        open onClose={requestClose} busy={ui.saving} title={t('ui_title')} subtitle={t('ui_sub')} fullOnMobile
        footer={<>
          <Button variant="danger" onClick={() => setConfirmReset(true)} disabled={ui.saving}>{t('ui_reset_all')}</Button>
          <Button variant="secondary" onClick={requestClose} disabled={ui.saving}>{t('cancel')}</Button>
          <Button variant="primary" onClick={save} loading={ui.saving}>{t('ui_save')}</Button>
        </>}
      >
        <p className="mb-5 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-100">{t('ui_preview')}</p>

        <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label={t('ui_title')}>
          {TABS.map(key => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setWarning('') }}
              className={`min-h-[44px] rounded-full border px-5 py-2 text-sm transition ${tab === key ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-gray-400 hover:border-white/25 hover:text-white'}`}>
              {t(`ui_tab_${key}`)}
            </button>
          ))}
        </div>

        {(warning || ui.error) && (
          <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            <span>{warning ? t(warning) : errorText()}</span>
            {ui.error?.code === 'version_conflict' && <Button variant="secondary" onClick={ui.reload}>{t('ui_reload')}</Button>}
          </div>
        )}

        {tab === 'menu' && (
          <section aria-label={t('ui_tab_menu')}>
            <p className="mb-4 text-sm text-gray-400">{t('ui_menu_hint')}</p>
            <ItemList list={draft.menu} originalOf={menuOriginal} field="label" isMenu t={t}
              onChange={(menu) => update({ menu })} onWarn={setWarning} />
          </section>
        )}

        {tab === 'overview' && (
          <section aria-label={t('ui_tab_overview')}>
            <p className="mb-4 text-sm text-gray-400">{t('ui_overview_hint')}</p>
            <ItemList list={draft.overview} originalOf={cardOriginal} field="title" isMenu={false} t={t}
              onChange={(overview) => update({ overview })} onWarn={setWarning} />
          </section>
        )}

        {tab === 'pages' && (
          <section aria-label={t('ui_tab_pages')}>
            <p className="mb-4 text-sm text-gray-400">{t('ui_pages_hint')}</p>
            <ul className="space-y-3">
              {PAGES.map(page => {
                const originalTitle = page.titleKey ? t(page.titleKey) : page.title
                const value = draft.pages[page.key] || { title: '', subtitle: '' }
                return (
                  <li key={page.key} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                    <p className="mb-3 font-medium text-white">{originalTitle}</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1.5 flex items-center justify-between text-xs uppercase tracking-wider text-gray-400">
                          <span>{t('ui_page_title')}</span><span className="tabular-nums">{value.title.length}/{LABEL_MAX}</span>
                        </span>
                        <input className={CONTROL} value={value.title} maxLength={LABEL_MAX} placeholder={originalTitle}
                          onChange={(event) => update({ pages: setPageText(draft.pages, page.key, 'title', event.target.value) })} />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 flex items-center justify-between text-xs uppercase tracking-wider text-gray-400">
                          <span>{t('ui_page_subtitle')}</span><span className="tabular-nums">{value.subtitle.length}/{SUBTITLE_MAX}</span>
                        </span>
                        <input className={CONTROL} value={value.subtitle} maxLength={SUBTITLE_MAX} placeholder={t(page.subtitleKey)}
                          onChange={(event) => update({ pages: setPageText(draft.pages, page.key, 'subtitle', event.target.value) })} />
                      </label>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmReset} title={t('ui_reset_title')} text={t('ui_reset_text')} confirmLabel={t('ui_reset_yes')} cancelLabel={t('cancel')}
        busy={ui.saving} onConfirm={reset} onCancel={() => setConfirmReset(false)}
      />
      <ConfirmDialog
        open={confirmLeave} tone="neutral" icon="alert" title={t('ui_leave_title')} text={t('ui_leave_text')}
        confirmLabel={t('ui_leave_yes')} cancelLabel={t('ui_leave_stay')}
        onConfirm={() => { setConfirmLeave(false); ui.cancelEditing() }} onCancel={() => setConfirmLeave(false)}
      />
    </>
  )
}
