import { createContext, useContext, useState, useEffect, useCallback, useReducer } from 'react'
import { defaultContent, SECTION_TYPE_DEFAULTS } from './defaultContent'
import { deepMerge, deepClone, setPath } from '../utils/objectPath'
import { migrateSectionsToInstances, migrateBackgroundTypes, migrateBundledImages, migrateHeroImage } from './migrateContent'
import {
  fetchLandingContent,
  saveDraftContent,
  publishContent as publishContentApi,
  resetLandingContent
} from '../api/landingPage'

const noop = () => {}
const noopAsync = async () => {}

// deepMerge() (see objectPath.js) replaces arrays wholesale rather than
// merging their items, so admins who already have Service cards / Pricing
// plans saved before a new per-item field existed (e.g. titleStyle,
// imageStyle) wouldn't automatically get that field merged in. This patches
// those two list fields item-by-item against the current default shape,
// WITHOUT touching any of the admin's actual saved text/values (those still
// win). Driven by `type` (not by a fixed key name) so it works no matter
// how many Services/Pricing section instances exist, at any ID.
function withArrayItemDefaults(mergedContent) {
  const servicesTemplate = SECTION_TYPE_DEFAULTS.services().items[0]
  const pricingTemplate = SECTION_TYPE_DEFAULTS.pricing().plans[0]

  for (const section of Object.values(mergedContent.sections || {})) {
    if (section?.type === 'services' && Array.isArray(section.items)) {
      section.items = section.items.map(item => deepMerge(servicesTemplate, item))
    }
    if (section?.type === 'pricing' && Array.isArray(section.plans)) {
      section.plans = section.plans.map(plan => deepMerge(pricingTemplate, plan))
    }
  }

  return mergedContent
}

// Migrates content saved by an older schema version so nothing crashes or
// silently loses the admin's real customization when the shape of a field
// changes. Currently: About used to store a flat `backgroundColor` field;
// it moved into `background.color` (see defaultContent.js). deepMerge keeps
// that old key around harmlessly (it's just not read anywhere anymore), so
// this only needs to copy the value over once, and only if the admin hadn't
// already set a new-style background.color. Driven by `type` for the same
// reason as withArrayItemDefaults above.
function withLegacyMigrations(mergedContent) {
  for (const section of Object.values(mergedContent.sections || {})) {
    if (section?.type === 'about' && section.backgroundColor && (!section.background || !section.background.color)) {
      section.background = { ...(section.background || {}), color: section.backgroundColor }
    }
  }

  // theme.typography.bodyFont used to default to the literal CSS keyword
  // 'inherit' (relying on body's own font-family in index.css) rather than
  // a real font name, which isn't one of the dropdown's options in
  // PropertiesPanel. Normalize it once to the font it actually resolved to
  // visually (Inter, per index.css's `body { font-family: 'Inter',
  // sans-serif }`), without touching anyone who already picked a real font
  // explicitly.
  if (mergedContent.theme?.typography?.bodyFont === 'inherit') {
    mergedContent.theme.typography.bodyFont = 'Inter'
  }

  return mergedContent
}

// After migrating legacy fixed-key sections (about/services/...) into
// dynamic IDs, defaultContent's own stub entries under those old names are
// no longer referenced by anything and would otherwise linger forever as
// dead weight in every save. Keeps only navbar/hero/footer plus whatever's
// actually listed in sectionOrder.
function pruneOrphanedSections(mergedContent) {
  const keep = new Set(['navbar', 'hero', 'footer', ...(mergedContent.sectionOrder || [])])
  const sections = {}

  for (const key of Object.keys(mergedContent.sections || {})) {
    if (keep.has(key)) sections[key] = mergedContent.sections[key]
  }

  mergedContent.sections = sections
  return mergedContent
}

// Full pipeline applied to any content fetched from the API, whether from
// the normal load or after a reset: migrate legacy shape -> infer
// background.type for pre-Phase-3 content -> fill in any field missing
// versus current defaults -> fix up known old-schema quirks -> backfill
// list-item shapes -> drop now-unreferenced stub sections.
function normalizeLoadedContent(rawContent) {
  const migrated = migrateHeroImage(migrateBackgroundTypes(migrateSectionsToInstances(migrateBundledImages(rawContent))))
  const merged = deepMerge(defaultContent, migrated)
  return pruneOrphanedSections(withArrayItemDefaults(withLegacyMigrations(merged)))
}

const defaultContextValue = {
  content: defaultContent,
  loading: false,
  isEditMode: false,
  selection: null,
  select: noop,
  updateField: noop,
  device: 'desktop',
  setDevice: noop,
  undo: noop,
  redo: noop,
  canUndo: false,
  canRedo: false,
  save: noopAsync,
  publish: noopAsync,
  reset: noopAsync,
  saving: false,
  publishing: false,
  dirty: false,
  lastSavedAt: null
}

const LandingContentContext = createContext(defaultContextValue)

// Any component (even outside a Provider, e.g. Navbar rendered on other
// pages) can safely call this hook and will get sensible read-only defaults.
export function useLandingContent() {
  return useContext(LandingContentContext)
}

// Keep content and its history in a pure reducer. React StrictMode can call
// reducers twice; no nested state updates may create duplicate Undo entries.
function contentHistoryReducer(state, action) {
  if (action.type === 'load') {
    return { content: action.content, history: [deepClone(action.content)], historyIndex: 0 }
  }
  if (action.type === 'undo' || action.type === 'redo') {
    const index = state.historyIndex + (action.type === 'undo' ? -1 : 1)
    if (index < 0 || index >= state.history.length) return state
    return { ...state, content: deepClone(state.history[index]), historyIndex: index }
  }
  const next = action.type === 'reset' ? action.content : setPath(state.content, action.path, action.value)
  if (action.commit === false) return { ...state, content: next }
  const past = state.history.length ? state.history.slice(0, state.historyIndex + 1) : [deepClone(state.content)]
  const history = [...past, deepClone(next)]
  return { content: next, history, historyIndex: history.length - 1 }
}

// mode: 'view' (public site, read-only) | 'edit' (admin page builder)
// version: only used in 'view' mode -> 'published' (default) or 'draft' (preview)
export function LandingContentProvider({ mode = 'view', version = 'published', children }) {
  const isEditMode = mode === 'edit'

  const [{ content, history, historyIndex }, dispatch] = useReducer(contentHistoryReducer, {
    content: defaultContent, history: [], historyIndex: -1
  })
  const [loading, setLoading] = useState(true)
  const [selection, setSelection] = useState(null)
  const [device, setDevice] = useState('desktop')
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)


  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)

      try {
        const fetchVersion = isEditMode ? 'draft' : version
        const data = await fetchLandingContent(fetchVersion)
        if (cancelled) return

        const merged = normalizeLoadedContent(data.content)
        dispatch({ type: 'load', content: merged })
      } catch (err) {
        console.error('Failed to load landing page content, using defaults:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [isEditMode, version])

  // Non-committed updates (for example color dragging) update the preview;
  // the final committed update adds one history entry.
  const updateField = useCallback((path, value, options = {}) => {
    dispatch({ type: 'change', path, value, commit: options.commit })
    setDirty(true)
  }, [])

  const select = useCallback((sel) => {
    if (!isEditMode) return
    setSelection(sel)
  }, [isEditMode])

  const undo = useCallback(() => {
    if (historyIndex <= 0) return
    dispatch({ type: 'undo' })
    setDirty(true)
  }, [historyIndex])

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return
    dispatch({ type: 'redo' })
    setDirty(true)
  }, [history.length, historyIndex])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      await saveDraftContent(content)
      setDirty(false)
      setLastSavedAt(new Date())
    } finally {
      setSaving(false)
    }
  }, [content])

  const publish = useCallback(async () => {
    setPublishing(true)
    try {
      await saveDraftContent(content)
      await publishContentApi(content)
      setDirty(false)
      setLastSavedAt(new Date())
    } finally {
      setPublishing(false)
    }
  }, [content])

  const reset = useCallback(async () => {
    await resetLandingContent('draft')
    const data = await fetchLandingContent('draft')
    const merged = normalizeLoadedContent(data.content)
    dispatch({ type: 'reset', content: merged })
    setDirty(true)
    setSelection(null)
  }, [])

  const value = {
    content,
    loading,
    isEditMode,
    selection,
    select,
    updateField,
    device,
    setDevice,
    undo,
    redo,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    save,
    publish,
    reset,
    saving,
    publishing,
    dirty,
    lastSavedAt
  }

  return (
    <LandingContentContext.Provider value={value}>
      {children}
    </LandingContentContext.Provider>
  )
}

