import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../../firebase/auth'
import { ADMIN_EMAIL } from '../../config'

export default function RequireAdmin({ children }) {
  const location = useLocation()
  const [status, setStatus] = useState('checking')

  useEffect(() => onAuthStateChanged(auth, (user) => {
    if (!user) {
      setStatus('signed-out')
      return
    }

    setStatus(user.email?.trim().toLowerCase() === ADMIN_EMAIL ? 'admin' : 'not-admin')
  }), [])

  if (status === 'checking') {
    return <div className="min-h-screen bg-black text-white flex items-center justify-center">Verificando acesso…</div>
  }

  if (status !== 'admin') {
    return (
      <Navigate
        to="/admin/login"
        replace
        state={{ from: location, denied: status === 'not-admin' }}
      />
    )
  }

  return children
}
