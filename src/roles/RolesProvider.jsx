import { useCallback, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase/auth'
import { API_URL } from '../config'
import { authFetch } from '../api/authFetch'
import { RolesContext } from './rolesContext'

// After the login it asks GET /me/roles once, keeps the answer for the whole site and forgets it at logout.
// The answer only decides what the menu and the pages SHOW: the server checks the role again on every request.
export default function RolesProvider({ children }) {
  const [signedIn, setSignedIn] = useState(Boolean(auth.currentUser))
  const [state, setState] = useState({ uid: null, status: 'signed-out', roles: null })
  const [version, setVersion] = useState(0)
  const [uid, setUid] = useState(auth.currentUser?.uid || null)
  const [authReady, setAuthReady] = useState(false)       // Firebase has said, at least once, who is signed in

  useEffect(() => onAuthStateChanged(auth, user => {
    setSignedIn(Boolean(user))
    setUid(user?.uid || null)
    setAuthReady(true)
    if (!user) setState({ uid: null, status: 'signed-out', roles: null })        // logout: nothing is kept
  }), [])

  useEffect(() => {
    if (!uid) return undefined
    let cancelled = false
    authFetch(`${API_URL}/me/roles`)
      .then(response => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then(roles => { if (!cancelled) setState({ uid, status: 'ready', roles }) })
      .catch(() => { if (!cancelled) setState({ uid, status: 'error', roles: null }) })
    return () => { cancelled = true }
  }, [uid, version])

  const reload = useCallback(() => {
    setState(current => ({ ...current, status: 'loading' }))
    setVersion(value => value + 1)
  }, [])

  // an answer belongs to the account that asked: another login never sees the previous one
  const value = useMemo(() => {
    if (!authReady) return { status: 'loading', roles: null, isTrainer: false, reload }
    if (!signedIn || !uid) return { status: 'signed-out', roles: null, isTrainer: false, reload }
    if (state.uid !== uid) return { status: 'loading', roles: null, isTrainer: false, reload }
    return { status: state.status, roles: state.roles, isTrainer: Boolean(state.roles?.is_trainer), reload }
  }, [authReady, signedIn, uid, state, reload])

  return <RolesContext.Provider value={value}>{children}</RolesContext.Provider>
}
