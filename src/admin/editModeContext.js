import { createContext, useContext } from 'react'

// The state of "edit the panel on the panel itself". Outside the provider (a page on its own, a test) the value is null: every component
// that reads it then draws the plain, original thing and nothing about editing exists.
export const EditModeContext = createContext(null)

export function useEditMode() {
  return useContext(EditModeContext)
}
