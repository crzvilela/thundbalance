import { useLandingContent } from '../../content/LandingContentContext'
import { getEffectiveTypography } from '../../utils/typography'
import { loadFont } from '../../utils/fonts'

// Reads and edits the typography saved for one text (`content.typography[path]`).
// Shared by the full Typography controls and the quick style bar, so both
// change the same values the same way.
export function useTypography(path) {
  const { content, updateField, device } = useLandingContent()
  const entry = content.typography?.[path] || {}
  const inherited = getEffectiveTypography({ ...content, typography: {} }, path)

  const setEntry = (next) => {
    const typography = { ...(content.typography || {}) }
    if (Object.keys(next).length) typography[path] = next
    else delete typography[path]
    updateField('typography', typography)
  }

  const update = (property, value) => {
    const next = { ...entry }
    const defaultValue = inherited[property]
    if (property === 'fontSize') {
      const sizes = { ...(entry.fontSize || {}) }
      if (!value || value === defaultValue?.[device]) delete sizes[device]
      else sizes[device] = value
      if (Object.keys(sizes).length) next.fontSize = sizes
      else delete next.fontSize
    } else if (value === defaultValue || value === '' || (property === 'opacity' && value === 1)) {
      delete next[property]
    } else next[property] = value
    if (property === 'fontFamily' && value) loadFont(value)
    setEntry(next)
  }

  const clear = () => {
    const typography = { ...(content.typography || {}) }
    delete typography[path]
    updateField('typography', typography)
  }

  return { entry, inherited, device, update, clear }
}
