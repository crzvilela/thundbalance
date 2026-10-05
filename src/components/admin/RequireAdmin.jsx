import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../../firebase/auth'
import { ADMIN_EMAIL } from '../../config'
import { useAdminText } from '../../admin/useAdminText'
import '../../admin/admin.css'

export default function RequireAdmin({ children }) {
  const location = useLocation()
  const { t } = useAdminText()
  const [status, setStatus] = useState('checking')

  useEffect(() => onAuthStateChanged(auth, (user) => {
    if (!user) {
      setStatus('signed-out')
      return
    }

    setStatus(user.email?.trim().toLowerCase() === ADMIN_EMAIL ? 'admin' : 'not-admin')
  }), [])

  if (status === 'checking') {
    return (
      <div className="admin-shell flex min-h-screen items-center justify-center gap-3 text-gray-300">
        <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-emerald-400" />
        {t('lg_checking')}
      </div>
    )
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
