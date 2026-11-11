import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminRequest } from './api'
import { UiSettingsContext } from './uiSettingsContext'
import { buildDraft, draftProblems, draftToSettings, isDefaultDraft, sameDraft, sanitizeSettings, toPayload } from './uiSettings'

// Loads the panel configuration ONCE (GET /admin/ui-settings) and shares it. It never blocks the panel: until the answer arrives, and if
// the request fails or the answer is not usable, the original panel is shown. While the editor is open the draft is what the panel shows
// (the live preview); nothing is saved until Save.
export default function UiSettingsProvider({ children }) {
  const [saved, setSaved] = useState(() => sanitizeSettings({}))      // the stored configuration (sanitised), version 0 = none
  const [draft, setDraft] = useState(null)                            // null = not editing
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)                           // { code, message } of the last refused save / reset

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

  const fail = (caught) => { setError({ code: caught?.code || '', message: caught?.message || '' }); return false }

  // true when saved (or nothing needed saving)
  const save = useCallback(async () => {
    if (!draft) return true
    const problems = draftProblems(draft)
    if (problems.length) { setError({ code: problems[0].code, message: '' }); return false }
    setSaving(true)
    setError(null)
    try {
      if (isDefaultDraft(draft)) {
        if (saved.version > 0) await adminRequest('DELETE', '/admin/ui-settings')
        setSaved(sanitizeSettings({}))
      } else {
        setSaved(sanitizeSettings(await adminRequest('PUT', '/admin/ui-settings', toPayload(draft, saved.version))))
      }
      setDraft(null)
      return true
    } catch (caught) {
      return fail(caught)
    } finally {
      setSaving(false)
    }
  }, [draft, saved])

  const resetAll = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      await adminRequest('DELETE', '/admin/ui-settings')
      setSaved(sanitizeSettings({}))
      setDraft(null)
      return true
    } catch (caught) {
      return fail(caught)
    } finally {
      setSaving(false)
    }
  }, [])

  // after a 409: the newest saved configuration replaces what was loaded (the draft starts again from it)
  const reload = useCallback(async () => {
    try {
      const fresh = sanitizeSettings(await adminRequest('GET', '/admin/ui-settings'))
      setSaved(fresh)
      setDraft(buildDraft(fresh))
      setError(null)
    } catch (caught) {
      fail(caught)
    }
  }, [])

  const value = useMemo(() => ({
    effective, saved, draft, setDraft, editing: !!draft, dirty, saving, error, setError,
    startEditing, cancelEditing, save, resetAll, reload
  }), [effective, saved, draft, dirty, saving, error, startEditing, cancelEditing, save, resetAll, reload])

  return <UiSettingsContext.Provider value={value}>{children}</UiSettingsContext.Provider>
}
