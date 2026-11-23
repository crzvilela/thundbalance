import { lazy, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { API_URL } from '../config'
import { hasAuthHint } from '../firebase/session'
import { ADMIN_SEGMENT } from '../admin/adminUrl.js'
import { useRoles } from '../roles/rolesContext'
const NotFound = lazy(() => import('../pages/NotFound'))
const Login = lazy(() => import('../pages/Login'))           // (it brings the sign-in code: not part of the first load)

// The "*" route: every address the site does not know. For everybody it is the ordinary 404 (the same page, the same text, no redirect, no hint), except in
// two cases, both about the admin panel (docs/ADMIN_ACCESS.md):
//   1. The address starts with the SECRET segment of the panel and the server has confirmed that the signed-in person is the administrator: the panel.
//      (The panel is a separate file that is requested only now: a visitor, a client or a trainer never downloads it.)
//   2. The same address without a session: the browser asks POST /route-check whether the segment is the secret one. If it is, the login shows and,
//      once signed in, the administrator comes back here; if it is not, it is the ordinary 404.
// The old address /admin (and /admin/...) is a 404 for everybody, except that the signed-in administrator is sent to the new address (old links and bookmarks).
const AdminApp = lazy(() => import('../admin/AdminApp'))

function Waiting() {
  return <div className="min-h-dvh bg-black" aria-busy="true" />
}

// asks the server once whether this segment is the secret one
function useRouteCheck(segment, active) {
  const [answer, setAnswer] = useState({ segment: '', match: null })
  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    fetch(`${API_URL}/route-check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segment }) })
      .then(response => response.json())
      .then(body => { if (!cancelled) setAnswer({ segment, match: body?.match === true }) })
      .catch(() => { if (!cancelled) setAnswer({ segment, match: false }) })
    return () => { cancelled = true }
  }, [segment, active])
  return answer.segment === segment ? answer.match : null
}

export default function UnknownOrAdmin() {
  const { pathname, search, hash } = useLocation()
  const rolesState = useRoles()
  const parts = pathname.split('/')
  const first = parts[1] || ''
  const rest = parts.slice(2).join('/')
  const roles = rolesState.roles
  const isAdmin = roles?.is_admin === true && ADMIN_SEGMENT.test(roles?.admin_path || '')
  const looksLikeSecret = ADMIN_SEGMENT.test(first)
  const oldAddress = first.toLowerCase() === 'admin'
  const waitingForRoles = rolesState.status === 'loading' && hasAuthHint()
  const signedOut = rolesState.status === 'signed-out'
  const asking = looksLikeSecret && signedOut
  const match = useRouteCheck(first, asking)

  if (!looksLikeSecret && !oldAddress) return <NotFound />
  if (waitingForRoles) return <Waiting />
  if (isAdmin && oldAddress) return <Navigate to={`/${roles.admin_path}${rest ? `/${rest}` : ''}${search}${hash}`} replace />
  if (isAdmin && looksLikeSecret && first === roles.admin_path) return <AdminApp base={first} />
  if (asking) {
    if (match === null) return <Waiting />
    if (match) return <Login returnTo={`${pathname}${search}${hash}`} />
  }
  return <NotFound />
}
