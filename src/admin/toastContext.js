import { createContext, useContext } from 'react'

// push(message, tone) shows a short notification. Outside the admin layout it
// does nothing, so components stay safe to render on their own.
export const ToastContext = createContext({ push: () => {} })

export function useToast() {
  return useContext(ToastContext)
}
