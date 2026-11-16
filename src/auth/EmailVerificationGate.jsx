import { lazy, Suspense, useEffect, useReducer } from 'react'
import { useI18n } from '../i18n/I18nContext'
import { NOT_VERIFIED_EVENT, gateReducer } from './emailVerification'

const VerifyDialog = lazy(() => import('./VerifyDialog'))

// Mounted once for the whole site. It stays invisible until the API answers "email_not_verified" (somebody whose address is not verified
// tried to reach data that already exists under it); then it covers the page with a short explanation and three buttons: resend the
// email (one every 60 s), "I have verified" (reloads the account and the login, and the page loads again) and sign out.
export default function EmailVerificationGate() {
  const { t } = useI18n()
  const [state, dispatch] = useReducer(gateReducer, { open: false })

  useEffect(() => {
    const open = () => dispatch('not_verified')
    window.addEventListener(NOT_VERIFIED_EVENT, open)
    return () => window.removeEventListener(NOT_VERIFIED_EVENT, open)
  }, [])

  if (!state.open) return null
  return <Suspense fallback={null}><VerifyDialog t={t} onVerified={() => dispatch('verified')} /></Suspense>
}
