import { useState } from 'react'
import { useLandingContent } from '../../content/LandingContentContext'
import { SECTION_LABELS, SECTION_TYPE_INFO, SECTION_TYPE_DEFAULTS, generateSectionId } from '../../content/defaultContent'
import { useAdminText } from '../../admin/useAdminText'
import { deepClone } from '../../utils/objectPath'
import ConfirmDialog from './ConfirmDialog'
import { EdIcon } from './editorIcons'
import './EditorChrome.css'

// Navbar and Hero stay on top, Footer at the bottom; only the sections in
// between can be added, duplicated, deleted and reordered.
const FIXED_TOP = ['navbar', 'hero']
const FIXED_BOTTOM = ['footer']

function AddSectionModal({ open, onClose, onPick, t }) {
  if (!open) return null
  const types = Object.keys(SECTION_TYPE_DEFAULTS)

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={t('ed_add_section')} className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-[#111] p-7 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-xl font-semibold text-white">{t('ed_add_section')}</h3>
            <p className="mt-1 text-sm text-gray-500">{t('ed_add_section_sub')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('ed_cancel')} className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"><EdIcon name="close" /></button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {types.map((type) => (
            <button
              key={type} type="button" onClick={() => onPick(type)}
              className="flex items-start gap-3 rounded-xl border border-white/10 p-4 text-left transition hover:border-emerald-400/60 hover:bg-emerald-400/5"
            >
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300"><EdIcon name={type} className="h-5 w-5" /></span>
              <span>
                <span className="block text-sm font-medium text-white">{SECTION_TYPE_INFO[type]?.label || type}</span>
                <span className="mt-0.5 block text-xs text-gray-500">{SECTION_TYPE_INFO[type]?.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function EditorSidebar() {
  const { t } = useAdminText()
  const { content, selection, select, updateField } = useLandingContent()
  const order = content.sectionOrder || []

  const [addOpen, setAddOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [dragId, setDragId] = useState(null)
  const [dropIndex, setDropIndex] = useState(null)

  const labelFor = (key) => {
    const section = content.sections[key] || {}
    return SECTION_LABELS[key] || SECTION_TYPE_INFO[section.type]?.label || key
  }

  const choose = (key) => {
    select({ type: 'section', path: key, label: labelFor(key) })
    document.getElementById(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const toggleVisible = (key, event) => {
    event.stopPropagation()
    updateField(`sections.${key}.visible`, content.sections[key]?.visible === false)
  }

  const handleAdd = (type) => {
    const id = generateSectionId()
    const created = SECTION_TYPE_DEFAULTS[type] ? SECTION_TYPE_DEFAULTS[type]() : { type, visible: true }
    updateField('sections', { ...content.sections, [id]: created })
    updateField('sectionOrder', [...order, id])
    setAddOpen(false)
    select({ type: 'section', path: id, label: SECTION_TYPE_INFO[type]?.label || type })
  }

  const handleDuplicate = (key, event) => {
    event.stopPropagation()
    const original = content.sections[key]
    if (!original) return
    const id = generateSectionId()
    const next = [...order]
    next.splice(order.indexOf(key) + 1, 0, id)
    updateField('sections', { ...content.sections, [id]: deepClone(original) })
    updateField('sectionOrder', next)
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    const sections = { ...content.sections }
    delete sections[deleteTarget]
    updateField('sections', sections)
    updateField('sectionOrder', order.filter((key) => key !== deleteTarget))
    if (selection?.type === 'section' && selection.path === deleteTarget) select(null)
    setDeleteTarget(null)
  }

  // Dragging a section row: the drop line shows where it will land.
  const onDragOverRow = (event, index) => {
    if (!dragId) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    setDropIndex(event.clientY < rect.top + rect.height / 2 ? index : index + 1)
  }
  const endDrag = () => { setDragId(null); setDropIndex(null) }
  const onDrop = (event) => {
    event.preventDefault()
    if (dragId && dropIndex !== null) {
      const from = order.indexOf(dragId)
      const next = order.filter((key) => key !== dragId)
      next.splice(dropIndex > from ? dropIndex - 1 : dropIndex, 0, dragId)
      if (next.join('|') !== order.join('|')) updateField('sectionOrder', next)
    }
    endDrag()
  }

  const actionButton = 'flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-white/10 hover:text-white'

  const row = (key, index) => {
    const section = content.sections[key] || {}
    const visible = section.visible !== false
    const isDynamic = order.includes(key)
    const selected = selection?.type === 'section' && selection.path === key
    const type = isDynamic ? section.type : key

    return (
      <div key={key}>
        {isDynamic && dropIndex === index && dragId !== key && <div className="section-drop-line" />}
        <div
          role="button" tabIndex={0}
          draggable={isDynamic}
          onDragStart={isDynamic ? (event) => { setDragId(key); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key) } : undefined}
          onDragEnd={isDynamic ? endDrag : undefined}
          onDragOver={isDynamic ? (event) => onDragOverRow(event, index) : undefined}
          onDrop={isDynamic ? onDrop : undefined}
          onClick={() => choose(key)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(key) } }}
          className={`section-row group relative flex items-center gap-2 rounded-lg py-2 pl-1.5 pr-2 text-sm transition ${dragId === key ? 'is-dragging' : ''} ${selected ? 'bg-emerald-400/15 text-emerald-300' : 'text-gray-300 hover:bg-white/5'} ${visible ? '' : 'opacity-50'}`}
        >
          {isDynamic
            ? <span title={t('ed_drag_hint')} className="cursor-grab text-gray-600 group-hover:text-gray-400 active:cursor-grabbing"><EdIcon name="grip" className="h-4 w-4" /></span>
            : <span title={t('ed_fixed')} className="text-gray-700"><EdIcon name="lock" className="h-4 w-4" /></span>}
          <EdIcon name={type} className="h-[18px] w-[18px] shrink-0 opacity-80" />
          <span className="min-w-0 flex-1 truncate">{labelFor(key)}</span>
          <span className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center rounded-md bg-[#161816] opacity-0 shadow-lg shadow-black/40 transition focus-within:opacity-100 group-hover:opacity-100">
            {isDynamic && <button type="button" onClick={(event) => handleDuplicate(key, event)} title={t('ed_duplicate')} aria-label={t('ed_duplicate')} className={actionButton}><EdIcon name="copy" className="h-4 w-4" /></button>}
            {isDynamic && <button type="button" onClick={(event) => { event.stopPropagation(); setDeleteTarget(key) }} title={t('ed_delete')} aria-label={t('ed_delete')} className={`${actionButton} hover:!text-red-300`}><EdIcon name="trash" className="h-4 w-4" /></button>}
            <button type="button" onClick={(event) => toggleVisible(key, event)} title={visible ? t('ed_hide') : t('ed_show')} aria-label={visible ? t('ed_hide') : t('ed_show')} className={actionButton}><EdIcon name={visible ? 'eye' : 'eyeOff'} className="h-4 w-4" /></button>
          </span>
        </div>
      </div>
    )
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-white/10 bg-[#0b0b0b]">
      <div className="flex-1 overflow-y-auto p-3">
        <button
          type="button" onClick={() => select({ type: 'theme', label: t('ed_site_style') })}
          className={`mb-3 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm transition ${selection?.type === 'theme' ? 'bg-emerald-400/15 text-emerald-300' : 'text-gray-300 hover:bg-white/5'}`}
        >
          <EdIcon name="palette" />{t('ed_site_style')}
        </button>

        <p className="px-2.5 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-600">{t('ed_sections')}</p>

        {FIXED_TOP.map((key) => row(key, -1))}

        <div onDragOver={(event) => { if (dragId) event.preventDefault() }} onDrop={onDrop}>
          {order.map((key, index) => row(key, index))}
          {dropIndex === order.length && <div className="section-drop-line" />}
        </div>

        <button
          type="button" onClick={() => setAddOpen(true)}
          className="mt-2 flex w-full items-center gap-2.5 rounded-lg border border-dashed border-white/15 px-2.5 py-2.5 text-sm text-gray-400 transition hover:border-emerald-400/50 hover:text-emerald-300"
        >
          <EdIcon name="plus" />{t('ed_add_section')}
        </button>

        <div className="my-3 h-px bg-white/10" />
        {FIXED_BOTTOM.map((key) => row(key, -1))}
      </div>

      <p className="border-t border-white/10 p-4 text-[11px] leading-5 text-gray-500">{t('ed_tip')}</p>

      <AddSectionModal open={addOpen} onClose={() => setAddOpen(false)} onPick={handleAdd} t={t} />

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('ed_delete_title')}
        description={t('ed_delete_text')}
        confirmLabel={t('ed_delete')}
        cancelLabel={t('ed_cancel')}
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </aside>
  )
}
