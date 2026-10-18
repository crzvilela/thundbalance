import { createContext, useContext, useEffect } from 'react'

// A screen with something unsaved ("you have an unsent message") tells the layout so: leaving through the side
// menu then asks first, and closing or reloading the browser tab shows the browser's own warning.
// (The app uses a plain BrowserRouter, which has no way to stop the browser's back button.)
export const LeaveGuardContext = createContext({ register: () => () => {} })

export function useLeaveGuard(dirty) {
  const { register } = useContext(LeaveGuardContext)

  useEffect(() => register(() => dirty), [register, dirty])

  useEffect(() => {
    if (!dirty) return undefined
    const warn = (event) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
}
