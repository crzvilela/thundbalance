import { useCallback, useEffect, useMemo, useState } from 'react'
import { auth } from '../firebase/auth'
import { ADMIN_EMAIL } from '../config'
import { EditModeContext } from './editModeContext'
import { useUiSettings } from './uiSettingsContext'
import {
  canEditPanel, draftTextOf, moveBlock as moveBlockIn, moveBlockTo as moveBlockToIn, moveItem, moveToItem, problemPaths, resetItem, resetPage as resetPageIn,
  setDraftText, textOfPath, toggleBlock as toggleBlockIn, toggleHidden
} from './uiSettings'

// Edit mode of the panel (inside UiSettingsProvider). It only turns on for the studio's main admin. It holds no data of its own: the draft is the
// one of UiSettingsProvider (so the advanced editor and the inline editing work on the SAME draft), and every change is made with the pure
// functions of uiSettings.js. Nothing is saved until save(); the draft lives only in memory.
export default function EditModeProvider({ children, canEdit: allowed }) {
  const ui = useUiSettings()
  const canEdit = !!ui && (allowed ?? canEditPanel(auth.currentUser?.email, ADMIN_EMAIL))
  const [warning, setWarning] = useState('')                 // a text key (ui_warn_*) shown in the bar: a protected item, fewer than 3 areas
  const [advancedOpen, setAdvancedOpen] = useState(false)    // the editor with tabs (CustomizePanel) over the same draft
  const draft = canEdit ? ui?.draft || null : null
  const isEditing = !!draft
  const dirty = isEditing && !!ui.dirty

  // closing or leaving the page with something unsaved asks first
  useEffect(() => {
    if (!dirty) return undefined
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const update = useCallback((change) => { setWarning(''); ui.setDraft(change) }, [ui])

  const value = useMemo(() => {
    // the custom text of a keyPath (what the panel shows: the draft while editing, else the saved configuration); everybody reads it, only the main admin edits
    const textOf = (path) => (ui ? textOfPath(ui.effective, path) : '')
    if (!canEdit) return { canEdit: false, isEditing: false, textOf }
    const start = () => { setWarning(''); setAdvancedOpen(false); ui.startEditing() }
    const stop = () => { setWarning(''); setAdvancedOpen(false); ui.cancelEditing() }
    return {
      canEdit: true, isEditing, draft, dirty, saving: ui.saving, error: ui.error, warning, advancedOpen,
      invalid: draft ? problemPaths(draft) : new Map(),
      start, cancel: stop,
      save: async () => { const ok = await ui.save(); if (ok) { setWarning(''); setAdvancedOpen(false) } return ok },
      resetAll: async () => { const ok = await ui.resetAll(); if (ok) { setWarning(''); setAdvancedOpen(false) } return ok },
      reload: ui.reload,
      openAdvanced: () => setAdvancedOpen(true),
      closeAdvanced: () => setAdvancedOpen(false),
      // the text of a keyPath: the custom one (what the panel shows now: the draft while editing) and the one in the draft
      textOf,
      draftTextOf: (path) => (draft ? draftTextOf(draft, path) : ''),
      setText: (path, text) => { if (draft) update(setDraftText(draft, path, text)) },
      resetText: (path) => { if (draft) update(setDraftText(draft, path, '')) },
      // menu items and Overview cards: reorder (buttons or drag), hide / show, reset one
      moveMenu: (key, delta) => { if (draft) update({ ...draft, menu: moveItem(draft.menu, key, delta) }) },
      moveMenuTo: (key, targetKey) => { if (draft) update({ ...draft, menu: moveToItem(draft.menu, key, targetKey) }) },
      toggleMenu: (key) => {
        if (!draft) return
        const result = toggleHidden(draft.menu, key, { isMenu: true })
        if (result.error) setWarning(result.error === 'too_few_visible' ? 'ui_warn_min' : 'ui_warn_protected')
        else update({ ...draft, menu: result.list })
      },
      resetMenu: (key) => { if (draft) update({ ...draft, menu: resetItem(draft.menu, key, 'label') }) },
      moveCard: (key, delta) => { if (draft) update({ ...draft, overview: moveItem(draft.overview, key, delta) }) },
      moveCardTo: (key, targetKey) => { if (draft) update({ ...draft, overview: moveToItem(draft.overview, key, targetKey) }) },
      toggleCard: (key) => { if (draft) update({ ...draft, overview: toggleHidden(draft.overview, key).list }) },
      // blocks (whole parts of a page): reorder inside their group, hide / show; "Repor página" puts the blocks of a page back as they were
      moveBlock: (page, group, key, delta) => { if (draft) update(moveBlockIn(draft, page, group, key, delta)) },
      moveBlockTo: (page, group, key, targetKey) => { if (draft) update(moveBlockToIn(draft, page, group, key, targetKey)) },
      toggleBlock: (page, group, key) => {
        if (!draft) return
        const result = toggleBlockIn(draft, page, group, key)
        if (result.error) setWarning(result.error === 'page_empty' ? 'ui_warn_page_empty' : 'ui_warn_block_protected')
        else update(result.draft)
      },
      resetPage: (page) => { if (draft) update(resetPageIn(draft, page)) },
      clearWarning: () => setWarning('')
    }
  }, [canEdit, isEditing, draft, dirty, ui, warning, advancedOpen, update])

  return <EditModeContext.Provider value={value}>{children}</EditModeContext.Provider>
}
