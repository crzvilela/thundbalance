import { useEffect, useRef, useState } from 'react'
import { useAdminText } from './useAdminText'
import { useToast } from './toastContext'
import { useEditMode } from './editModeContext'
import { useUiSettings } from './uiSettingsContext'
import { Button, ConfirmDialog, Drawer, Icon } from './ui'
import {
  BLOCKS, BLOCK_PAGES, CUSTOMIZE_KEY, TEXT_ENTRIES, CUSTOMIZE_LABEL_KEY, LABEL_MAX, MENU_ITEMS, OVERVIEW_CARDS, PAGES, PROTECTED_MENU_KEYS, SUBTITLE_MAX
} from './uiRegistry'
import { moveItem, moveToItem, pageIsCustomised, resetItem, setItemText, setPageText, toggleHidden } from './uiSettings'

const TABS = ['menu', 'overview', 'pages', 'blocks', 'texts']
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

// One block of a page in the "Blocks" tab: drag handle, name, up / down inside its group, and the eye (or the lock of a protected block).
function BlockRow({ block, name, index, count, onMove, onToggle, onDragStart, onDrop, dragging, t }) {
  return (
    <li
      className={`flex flex-wrap items-center gap-2 rounded-2xl border bg-white/[0.02] p-3 transition ${dragging ? 'border-emerald-400/50 opacity-60' : 'border-white/10'} ${block.hidden ? 'opacity-60' : ''}`}
      draggable onDragStart={onDragStart} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop() }}
    >
      <span className="flex h-11 w-7 shrink-0 cursor-grab items-center justify-center text-gray-500" title={t('ui_drag')} aria-hidden="true"><Icon name="grip" className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1 basis-40">
        <p className={`flex items-center gap-1.5 font-medium ${block.hidden ? 'text-gray-400 line-through' : 'text-white'}`}>
          <span className="truncate">{name}</span>
          {block.protected && <Icon name="lock" className="h-4 w-4 shrink-0 text-gray-500" />}
        </p>
        {block.protected && <p className="text-xs text-gray-500">{t('ui_block_locked')}</p>}
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" className={ICON_BUTTON} onClick={() => onMove(-1)} disabled={index === 0} aria-label={`${t('ui_up')}: ${name}`} title={t('ui_up')}><Icon name="up" className="h-5 w-5" /></button>
        <button type="button" className={ICON_BUTTON} onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`${t('ui_down')}: ${name}`} title={t('ui_down')}><Icon name="down" className="h-5 w-5" /></button>
        {!block.protected && (
          <button type="button" className={ICON_BUTTON} onClick={onToggle} aria-pressed={block.hidden} aria-label={`${block.hidden ? t('ui_show') : t('ui_hide')}: ${name}`} title={block.hidden ? t('ui_show') : t('ui_hide')}>
            <Icon name={block.hidden ? 'eyeoff' : 'eye'} className="h-5 w-5" />
          </button>
        )}
      </div>
    </li>
  )
}

// The "Texts" tab: every editable text of every page, grouped by page, with a search. The field shows the original as its placeholder (empty = the
// original), "Reset" puts one text back and "Reset page" all the texts (and blocks, title and subtitle) of a page. Same draft and Save as everything else.
function TextsTab({ draft, edit, t }) {
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const pageName = (page) => t(MENU_ITEMS.find(item => item.key === page)?.labelKey)
  const pages = [...new Set(TEXT_ENTRIES.map(entry => entry.page))]
  const shown = (entry) => {
    if (!needle) return true
    const custom = draft.texts?.[entry.key] || ''
    return `${t(entry.defaultKey)} ${custom} ${entry.key} ${pageName(entry.page)}`.toLowerCase().includes(needle)
  }
  const visiblePages = pages.filter(page => TEXT_ENTRIES.some(entry => entry.page === page && shown(entry)))
  return (
    <div>
      <label className="mb-5 block">
        <span className="mb-1.5 block text-xs uppercase tracking-wider text-gray-400">{t('ui_texts_search')}</span>
        <input type="search" className={CONTROL} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('ui_texts_search_ph')} />
      </label>
      {visiblePages.length === 0 && <p role="status" className="text-sm text-gray-400">{t('ui_texts_none')}</p>}
      <div className="space-y-8">
        {visiblePages.map(page => (
          <section key={page} aria-label={pageName(page)}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-white">{pageName(page)}</h3>
              <Button variant="secondary" onClick={() => edit.resetPage(page)} disabled={!pageIsCustomised(draft, page)}>{t('ui_page_reset')}</Button>
            </div>
            <ul className="space-y-2">
              {TEXT_ENTRIES.filter(entry => entry.page === page && shown(entry)).map(entry => {
                const path = `text:${entry.key}`
                const value = draft.texts?.[entry.key] || ''
                const problem = edit.invalid.get(path)
                const original = t(entry.defaultKey)
                return (
                  <li key={entry.key} className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                    <label className="block">
                      <span className="mb-1.5 flex items-center justify-between gap-3 text-xs text-gray-400">
                        <span className="truncate">{t('ui_original').replace('{name}', original)}</span>
                        <span className="shrink-0 tabular-nums">{value.length}/{entry.max}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <input className={`${CONTROL} ${problem ? '!border-red-400/70' : ''}`} value={value} maxLength={entry.max} placeholder={original}
                          aria-label={`${pageName(page)}: ${original}`} onChange={(event) => edit.setText(path, event.target.value)} />
                        <button type="button" className={`${ICON_BUTTON} !w-auto px-3 text-sm`} onClick={() => edit.resetText(path)} disabled={!value}
                          aria-label={`${t('ui_reset_item')}: ${original}`}>{t('ui_reset_item')}</button>
                      </span>
                    </label>
                    {problem && <p role="alert" className="mt-1 text-xs text-red-300">{t(`ui_err_${problem}`)}</p>}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

function BlocksTab({ draft, edit, t }) {
  const dragRef = useRef({ key: '', page: '', group: '' })
  const [dragging, setDragging] = useState('')
  return (
    <div className="space-y-8">
      {BLOCK_PAGES.map(page => (
        <section key={page} aria-label={t(MENU_ITEMS.find(item => item.key === page)?.labelKey)}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-white">{t(MENU_ITEMS.find(item => item.key === page)?.labelKey)}</h3>
            <Button variant="secondary" onClick={() => edit.resetPage(page)}>{t('ui_page_reset')}</Button>
          </div>
          {Object.keys(BLOCKS[page]).map(group => {
            const list = draft.blocks?.[page]?.[group] || []
            return (
              <ul key={group} className="space-y-2">
                {list.map((entry, index) => {
                  const block = { ...BLOCKS[page][group].find(candidate => candidate.key === entry.key), hidden: entry.hidden }
                  return (
                    <BlockRow
                      key={entry.key} block={block} name={t(block.labelKey)} index={index} count={list.length} t={t}
                      dragging={dragging === `${page}.${group}.${entry.key}`}
                      onMove={(delta) => edit.moveBlock(page, group, entry.key, delta)}
                      onToggle={() => edit.toggleBlock(page, group, entry.key)}
                      onDragStart={() => { dragRef.current = { key: entry.key, page, group }; setDragging(`${page}.${group}.${entry.key}`) }}
                      onDrop={() => {
                        const from = dragRef.current
                        if (from.key && from.page === page && from.group === group) edit.moveBlockTo(page, group, from.key, entry.key)      // only inside its own group
                        dragRef.current = { key: '', page: '', group: '' }; setDragging('')
                      }}
                    />
                  )
                })}
              </ul>
            )
          })}
        </section>
      ))}
    </div>
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
  const edit = useEditMode()
  const [tab, setTab] = useState('menu')
  const [warning, setWarning] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)

  if (!ui || !ui.draft) return null
  const draft = ui.draft
  const update = (patch) => { setWarning(''); ui.setDraft({ ...draft, ...patch }) }
  // closing the advanced editor goes back to editing on the panel (the draft is kept); Save and "Reset everything" end the edit mode
  const requestClose = () => edit?.closeAdvanced()

  const errorText = () => {
    if (!ui.error) return ''
    const known = t(`ui_err_${ui.error.code}`)
    return known !== `ui_err_${ui.error.code}` ? known : t('ui_err_generic')      // the server's own message is technical English: the panel always speaks ES / EN
  }

  const save = async () => { if (await edit.save()) toast.push(t('ui_saved')) }
  const reset = async () => { if (await edit.resetAll()) { setConfirmReset(false); toast.push(t('ui_reset_ok')) } else setConfirmReset(false) }

  const menuOriginal = (key) => (key === CUSTOMIZE_KEY ? t(CUSTOMIZE_LABEL_KEY) : t(MENU_ITEMS.find(item => item.key === key)?.labelKey))
  const cardOriginal = (key) => t(OVERVIEW_CARDS.find(card => card.key === key)?.titleKey)

  return (
    <>
      <Drawer
        open onClose={requestClose} busy={ui.saving} title={t('ui_title')} subtitle={t('ui_sub')} fullOnMobile
        footer={<>
          <Button variant="danger" onClick={() => setConfirmReset(true)} disabled={ui.saving}>{t('ui_reset_all')}</Button>
          <Button variant="secondary" onClick={requestClose} disabled={ui.saving}>{t('ui_back_to_panel')}</Button>
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

        {(warning || edit?.warning || ui.error) && (
          <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            <span>{warning ? t(warning) : edit?.warning ? t(edit.warning) : errorText()}</span>
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

        {tab === 'blocks' && (
          <section aria-label={t('ui_tab_blocks')}>
            <p className="mb-4 text-sm text-gray-400">{t('ui_blocks_hint')}</p>
            <BlocksTab draft={draft} edit={edit} t={t} />
          </section>
        )}

        {tab === 'texts' && (
          <section aria-label={t('ui_tab_texts')}>
            <p className="mb-4 text-sm text-gray-400">{t('ui_texts_hint')}</p>
            <TextsTab draft={draft} edit={edit} t={t} />
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
    </>
  )
}
