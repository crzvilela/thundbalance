import { useLocation } from 'react-router-dom'
import { useRoles } from '../roles/rolesContext'

// The pages of the client area (the ones the bottom navigation of a phone belongs to) and who sees it: a signed-in client or the administrator, not a trainer
// (they have their own small menu) and nobody who is signed out. Pure part first (tested with node), the hook after.
export const CLIENT_AREA = ['/dashboard', '/my-sessions', '/messages', '/profile', '/training-request']

export const isClientAreaPath = (pathname) => CLIENT_AREA.some(path => pathname === path || String(pathname).startsWith(`${path}/`))

export function useBottomNavVisible() {
  const { pathname } = useLocation()
  const { status, isTrainerOnly } = useRoles()
  return isClientAreaPath(pathname) && (status === 'ready' || status === 'error') && !isTrainerOnly
}
