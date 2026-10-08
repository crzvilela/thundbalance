import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../firebase/auth'
import { API_URL } from '../config'
import { authFetch } from '../api/authFetch'
import { PASSWORD_CHANGED_EVENT } from '../api/account'
import { useI18n } from '../i18n/I18nContext'
import PasswordBanner from './PasswordBanner'

// Shown at the top of the client pages while the account still has the
// temporary password the studio created it with. It never blocks the site and
// disappears as soon as the password is changed in Profile.
export default function TempPasswordNotice({ showLink = true }) {
  const { t } = useI18n()
  const [needsChange, setNeedsChange] = useState(false)

  useEffect(() => {
    let active = true
    const stop = onAuthStateChanged(auth, user => {
      if (!user?.email) { if (active) setNeedsChange(false); return }
      authFetch(`${API_URL}/users/email/${encodeURIComponent(user.email)}`)
        .then(response => (response.ok ? response.json() : null))
        .then(data => { if (active) setNeedsChange(!!data?.must_change_password) })
        .catch(() => {})
    })
    const hide = () => setNeedsChange(false)
    window.addEventListener(PASSWORD_CHANGED_EVENT, hide)
    return () => { active = false; stop(); window.removeEventListener(PASSWORD_CHANGED_EVENT, hide) }
  }, [])

  if (!needsChange) return null
  return (
    <PasswordBanner
      message={t('tp_banner')}
      action={showLink ? <Link to="/profile" className="font-semibold underline underline-offset-2 hover:text-white">{t('tp_go_profile')}</Link> : null}
    />
  )
}
