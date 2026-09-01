import { useState } from 'react'
import { useLandingContent } from '../../content/LandingContentContext'
import { SECTION_LABELS, SECTION_TYPE_INFO, SECTION_TYPE_DEFAULTS, generateSectionId } from '../../content/defaultContent'
import { deepClone } from '../../utils/objectPath'
import ConfirmDialog from './ConfirmDialog'

// Hero renders fixed/first (outside the dynamic system), Navbar sits above
// the dynamic list, Footer sits below it. None of these three can be
// duplicated, deleted, reordered, or added again.
const FIXED_TOP = ['navbar', 'hero']
const FIXED_BOTTOM = ['footer']

function AddSectionModal({ open, onClose, onPick }) {
  if (!open) return null

  const types = Object.keys(SECTION_TYPE_DEFAULTS)

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      <div className="relative bg-[#111] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-white mb-1">Add Section</h3>
        <p className="text-xs text-gray-500 mb-4">Pick a template to add to the end of the page.</p>

        <div className="space-y-2">
          {types.map((type) => (
            <button
              key={type}
              onClick={() => onPick(type)}
              className="w-full text-left px-4 py-3 rounded-lg border border-white/10 hover:border-emerald-400 hover:bg-emerald-500/10 transition"
            >
              <p className="text-sm font-medium text-white">{SECTION_TYPE_INFO[type]?.label || type}</p>
              <p className="text-xs text-gray-500 mt-0.5">{SECTION_TYPE_INFO[type]?.description}</p>
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          className="mt-4 text-xs uppercase tracking-wider text-gray-400 hover:text-white transition"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function EditorSidebar() {
  const { content, selection, select, updateField } = useLandingContent()
  const order = content.sectionOrder || []

  const [addModalOpen, setAddModalOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const toggleVisible = (key, e) => {
    e.stopPropagation()
    const current = content.sections[key]?.visible !== false
    updateField(`sections.${key}.visible`, !current)
  }

  const handleAddSection = (type) => {
    const id = generateSectionId()
    const newSection = SECTION_TYPE_DEFAULTS[type] ? SECTION_TYPE_DEFAULTS[type]() : { type, visible: true }

    updateField('sections', { ...content.sections, [id]: newSection })
    updateField('sectionOrder', [...order, id])

    setAddModalOpen(false)
    select({ type: 'section', path: id, label: SECTION_TYPE_INFO[type]?.label || type })
  }

  const handleDuplicate = (key, e) => {
    e.stopPropagation()
    const original = content.sections[key]
    if (!original) return

    const id = generateSectionId()
    const clone = deepClone(original)
    const index = order.indexOf(key)
    const newOrder = [...order]
    newOrder.splice(index + 1, 0, id)

    updateField('sections', { ...content.sections, [id]: clone })
    updateField('sectionOrder', newOrder)
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    const key = deleteTarget

    const newSections = { ...content.sections }
    delete newSections[key]

    updateField('sections', newSections)
    updateField('sectionOrder', order.filter((k) => k !== key))

    if (selection?.type === 'section' && selection.path === key) select(null)
    setDeleteTarget(null)
  }

  const renderRow = (key) => {
    const section = content.sections[key] || {}
    const visible = section.visible !== false
    const isSelected = selection?.type === 'section' && selection.path === key
    const isDynamic = order.includes(key)
    const label = SECTION_LABELS[key] || SECTION_TYPE_INFO[section.type]?.label || key

    return (
      <div
        key={key}
        onClick={() => select({ type: 'section', path: key, label })}
        className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 text-sm flex items-center justify-between gap-2 cursor-pointer transition ${
          isSelected ? 'bg-emerald-500/15 text-emerald-400' : 'text-gray-300 hover:bg-white/5'
        } ${!visible ? 'opacity-50' : ''}`}
      >
        <span className="truncate">{label}</span>

        <div className="flex items-center gap-1 shrink-0">
          {!isDynamic && (
            <span className="text-[9px] uppercase tracking-wider text-gray-600 mr-1">fixed</span>
          )}

          {isDynamic && (
            <>
              <button
                onClick={(e) => handleDuplicate(key, e)}
                title="Duplicate section"
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10"
              >
                📋
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(key) }}
                title="Delete section"
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10"
              >
                🗑️
              </button>
            </>
          )}

          <button
            onClick={(e) => toggleVisible(key, e)}
            title={visible ? 'Hide section' : 'Show section'}
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10"
          >
            {visible ? '👁️' : '🚫'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <aside className="w-64 shrink-0 bg-[#0b0b0b] border-r border-white/10 flex flex-col">
      <div className="p-5 border-b border-white/10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white">Sections</h2>
        <p className="text-[11px] text-gray-500 mt-1">Click a section to edit it, or click any element in the preview.</p>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <button
          onClick={() => select(null)}
          className={`w-full text-left px-3 py-2.5 rounded-lg mb-2 text-sm flex items-center gap-2 transition ${
            !selection ? 'bg-emerald-500/15 text-emerald-400' : 'text-gray-300 hover:bg-white/5'
          }`}
        >
          <span>🎨</span> Global Styles
        </button>

        <div className="h-px bg-white/10 my-3" />

        {FIXED_TOP.map(renderRow)}

        <div className="h-px bg-white/10 my-3" />

        {order.map(renderRow)}

        <button
          onClick={() => setAddModalOpen(true)}
          className="w-full text-left px-3 py-2.5 rounded-lg mt-2 mb-1 text-sm border border-dashed border-white/15 text-gray-400 hover:text-emerald-400 hover:border-emerald-400/50 transition"
        >
          + Add Section
        </button>

        <div className="h-px bg-white/10 my-3" />

        {FIXED_BOTTOM.map(renderRow)}
      </div>

      <AddSectionModal open={addModalOpen} onClose={() => setAddModalOpen(false)} onPick={handleAddSection} />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this section?"
        description="This cannot be undone with the undo button and all its content will be permanently removed."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </aside>
  )
}
