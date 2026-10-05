import { createContext, useContext } from 'react'

// begin(event, { path, kind, mode, el? }) starts a drag (mode "move") or a
// resize (mode "n" | "e" | "se" ...) of the element that has that layout path.
// Outside the visual editor it does nothing, so the same components render the
// public site unchanged.
// setEditing(path | null) tells the layer that a text is being typed in, so it
// hides its selection box instead of covering the text.
export const LayoutEditorContext = createContext({ enabled: false, begin: () => {}, setEditing: () => {} })

export function useLayoutEditor() {
  return useContext(LayoutEditorContext)
}
