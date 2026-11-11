import { Fragment, useRef } from 'react'
import { useAdminText } from './useAdminText'
import { useEditMode } from './editModeContext'
import { useBlocks } from './uiSettingsContext'
import { Icon } from './ui'
import { GRID_GROUPS } from './uiRegistry'
import { blockRows } from './uiSettings'

const TOOL = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-black/60 text-gray-200 transition hover:border-white/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30'
const SPAN = { 2: 'lg:col-span-2', 3: 'lg:col-span-3' }

// The controls of ONE block while the panel is being edited (never drawn otherwise): a drag handle, the name of the block, up / down inside its
// group and the eye to hide or show it, or a lock when the block is protected. Dropping another block of the same group on it moves that one here.
function BlockBar({ pageKey, groupKey, block, index, count, className = '', dragRef }) {
  const { t } = useAdminText()
  const edit = useEditMode()
  const name = t(block.labelKey)
  return (
    <div
      className={`mb-2 flex flex-wrap items-center gap-1 rounded-xl border border-dashed border-emerald-400/40 bg-emerald-400/5 p-1 ${block.hidden ? 'opacity-60' : ''} ${className}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); if (dragRef.current && dragRef.current !== block.key) edit.moveBlockTo(pageKey, groupKey, dragRef.current, block.key); dragRef.current = '' }}
    >
      <span draggable className={`${TOOL} cursor-grab`} title={t('ui_drag')} aria-hidden="true"
        onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; dragRef.current = block.key }}><Icon name="grip" className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1 px-1 text-xs font-medium uppercase tracking-wider text-emerald-200">{name}{block.hidden ? ` · ${t('ui_hidden')}` : ''}</span>
      <button type="button" className={TOOL} onClick={() => edit.moveBlock(pageKey, groupKey, block.key, -1)} disabled={index === 0} aria-label={`${t('ui_up')}: ${name}`} title={t('ui_up')}><Icon name="up" className="h-5 w-5" /></button>
      <button type="button" className={TOOL} onClick={() => edit.moveBlock(pageKey, groupKey, block.key, 1)} disabled={index === count - 1} aria-label={`${t('ui_down')}: ${name}`} title={t('ui_down')}><Icon name="down" className="h-5 w-5" /></button>
      {block.protected
        ? <span className={`${TOOL} opacity-60`} role="img" aria-label={t('ui_block_locked')} title={t('ui_block_locked')}><Icon name="lock" className="h-5 w-5" /></span>
        : <button type="button" className={TOOL} onClick={() => edit.toggleBlock(pageKey, groupKey, block.key)} aria-pressed={block.hidden} aria-label={`${block.hidden ? t('ui_show') : t('ui_hide')}: ${name}`} title={block.hidden ? t('ui_show') : t('ui_hide')}>
          <Icon name={block.hidden ? 'eyeoff' : 'eye'} className="h-5 w-5" />
        </button>}
    </div>
  )
}

// The blocks of one group of a page, in the studio's order (the original order when nothing is saved; a block that is not saved yet, a new one,
// comes last). `blocks` maps each block key to a function that draws it: (className) => element, where `className` carries the margin or column
// span the block needs where it is (put it on the root element); a block that has nothing to draw is null. `gap` is the margin of every block but the
// first (blocks keep their own margin only through it, so they can swap places). Outside edit mode a hidden block is not drawn and nothing is added
// around the others; while editing every block gets its bar, hidden ones stay (dimmed) so they can be shown again.
export default function BlockGroup({ pageKey, groupKey, blocks, gap = '' }) {
  const items = useBlocks(pageKey, groupKey)
  const edit = useEditMode()
  const dragRef = useRef('')
  const editing = !!edit?.isEditing
  const shown = items.map((block, index) => ({ block, index })).filter(({ block }) => typeof blocks[block.key] === 'function' && (editing || !block.hidden))
  const join = (...parts) => parts.filter(Boolean).join(' ')

  const bar = (block, index, className = '') => (
    <BlockBar pageKey={pageKey} groupKey={groupKey} block={block} index={index} count={items.length} className={className} dragRef={dragRef} />
  )

  if (GRID_GROUPS.includes(`${pageKey}.${groupKey}`)) {
    return blockRows(shown.map(({ block, index }) => ({ ...block, index }))).map((row, rowIndex) => {
      const margin = rowIndex > 0 ? gap : ''
      const draw = (block, className) => (editing
        ? <div key={block.key} className={join(className, block.hidden ? 'opacity-40' : '')}>{bar(block, block.index)}{blocks[block.key]('')}</div>
        : <Fragment key={block.key}>{blocks[block.key](className)}</Fragment>)
      if (row.length === 1) return editing ? <div key={row[0].key} className={margin || undefined}>{draw(row[0], '')}</div> : draw(row[0], margin)
      return <div key={row.map(block => block.key).join('+')} className={join('grid gap-6 lg:grid-cols-5', margin)}>{row.map(block => draw(block, SPAN[block.span] || ''))}</div>
    })
  }

  return shown.map(({ block, index }, position) => {
    const margin = position > 0 ? gap : ''
    return editing
      ? <Fragment key={block.key}>{bar(block, index, margin)}{blocks[block.key](block.hidden ? 'opacity-40' : '')}</Fragment>
      : <Fragment key={block.key}>{blocks[block.key](margin)}</Fragment>
  })
}
