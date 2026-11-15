// Is the person looking at the page the admin? Only used to SHOW the pending marks of the legal texts to the admin; it protects nothing
// (the marks hide data the public could not use anyway) and the real protection of the editor is the server (require_admin).
import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase/auth'
import { ADMIN_EMAIL } from '../config'

export function useIsAdmin() {
  const [admin, setAdmin] = useState(false)
  useEffect(() => onAuthStateChanged(auth, (user) => setAdmin(Boolean(user?.email) && user.email.trim().toLowerCase() === ADMIN_EMAIL)), [])
  return admin
}
