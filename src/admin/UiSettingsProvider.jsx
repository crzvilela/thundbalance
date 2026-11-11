import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminRequest } from './api'
import { UiSettingsContext } from './uiSettingsContext'
import { buildDraft, draftToSettings, performReset, performSave, sameDraft, sanitizeSettings } from './uiSettings'

// Loads the panel configuration ONCE (GET /admin/ui-settings) and shares it. It never blocks the panel: until the answer arrives, and if
// the request fails or the answer is not usable, the original panel is shown. While the panel is being edited the draft is what it shows
// (the live preview); nothing is saved until Save. The editing itself (inline on the panel) is EditModeProvider, which sits inside this one
// and uses this state; saving and resetting are the pure functions of uiSettings.js.
export default function UiSettingsProvider({ children }) {
  const [saved, setSaved] = useState(() => sanitizeSettings({}))      // the stored configuration (sanitised), version 0 = none
  const [draft, setDraft] = useState(null)                            // null = not editing
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)                           // { code, field? } of the last refused save / reset

  useEffect(() => {
    let cancelled = false
    adminRequest('GET', '/admin/ui-settings')
      .then(data => { if (!cancelled) setSaved(sanitizeSettings(data)) })
      .catch(() => { /* the original panel stays: nothing here may break it */ })
    return () => { cancelled = true }
  }, [])

  const effective = useMemo(() => (draft ? draftToSettings(draft) : saved), [draft, saved])
  const dirty = !!draft && !sameDraft(draft, buildDraft(saved))

  const startEditing = useCallback(() => { setError(null); setDraft(buildDraft(saved)) }, [saved])
  const cancelEditing = useCallback(() => { setError(null); setDraft(null) }, [])

  // true when saved (or there was nothing to save)
  const save = useCallback(async () => {
    if (!draft) return true
    setSaving(true)
    setError(null)
    const result = await performSave({ draft, saved, request: adminRequest })
    setSaving(false)
    if (!result.ok) { setError(result.error); return false }
    setSaved(result.saved)
    setDraft(null)
    return true
  }, [draft, saved])

  const resetAll = useCallback(async () => {
    setSaving(true)
    setError(null)
    const result = await performReset({ request: adminRequest })
    setSaving(false)
    if (!result.ok) { setError(result.error); return false }
    setSaved(result.saved)
    setDraft(null)
    return true
  }, [])

  // after a 409: the newest saved configuration replaces what was loaded (the draft starts again from it)
  const reload = useCallback(async () => {
    try {
      const fresh = sanitizeSettings(await adminRequest('GET', '/admin/ui-settings'))
      setSaved(fresh)
      setDraft(buildDraft(fresh))
      setError(null)
    } catch (caught) {
      setError({ code: caught?.code || '' })
    }
  }, [])

  const value = useMemo(() => ({
    effective, saved, draft, setDraft, editing: !!draft, dirty, saving, error, setError,
    startEditing, cancelEditing, save, resetAll, reload
  }), [effective, saved, draft, dirty, saving, error, startEditing, cancelEditing, save, resetAll, reload])

  return <UiSettingsContext.Provider value={value}>{children}</UiSettingsContext.Provider>
}
