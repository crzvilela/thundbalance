import { useEffect, useReducer, useRef, useState } from 'react'
import { sendEmailVerification, signOut } from 'firebase/auth'
import { auth } from '../firebase/auth'
import { useI18n } from '../i18n/I18nContext'
import { NOT_VERIFIED_EVENT, gateReducer, markSent, readLastSent, secondsUntilResend } from './emailVerification'

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
  return <VerifyDialog t={t} onVerified={() => dispatch('verified')} />
}

function VerifyDialog({ t, onVerified }) {
  const user = auth.currentUser
  const [lastSent, setLastSent] = useState(() => readLastSent(user?.uid))
  const [now, setNow] = useState(() => Date.now())
  const [message, setMessage] = useState({ text: '', tone: 'info' })
  const [busy, setBusy] = useState('')
  const working = useRef(false)
  const first = useRef(null)

  useEffect(() => { first.current?.focus() }, [])

  const wait = secondsUntilResend(lastSent, now)
  useEffect(() => {
    if (!wait) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [wait])

  const run = async (name, work) => {
    if (working.current) return
    working.current = true
    setBusy(name)
    setMessage({ text: '', tone: 'info' })
    try {
      await work()
    } catch (error) {
      setMessage({ text: t(error?.code === 'auth/too-many-requests' ? 've_too_many' : 've_error'), tone: 'error' })
    } finally {
      working.current = false
      setBusy('')
    }
  }

  const resend = () => run('resend', async () => {
    if (!user || secondsUntilResend(lastSent) > 0) return
    await sendEmailVerification(user)
    const sentAt = Date.now()
    markSent(user.uid, sentAt)
    setLastSent(sentAt)
    setNow(sentAt)
    setMessage({ text: t('ve_sent'), tone: 'ok' })
  })

  const check = () => run('check', async () => {
    const current = auth.currentUser
    if (!current) return
    await current.reload()
    if (!auth.currentUser.emailVerified) {
      setMessage({ text: t('ve_not_yet'), tone: 'error' })
      return
    }
    await auth.currentUser.getIdToken(true)           // the old login still says "not verified": a new one is needed
    onVerified()
    window.location.reload()                          // every page asks for its data again with the verified login
  })

  const leave = async () => {
    await signOut(auth).catch(() => {})
    window.location.assign('/')
  }

  const button = 'min-h-[44px] w-full rounded-xl px-5 text-sm font-semibold uppercase tracking-wider transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 disabled:opacity-50'
  const tone = message.tone === 'error' ? 'text-red-300' : message.tone === 'ok' ? 'text-emerald-300' : 'text-gray-300'

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 px-6 py-10 backdrop-blur-sm">
      <div role="alertdialog" aria-modal="true" aria-labelledby="ve-title" className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1110] p-8 text-white shadow-2xl">
        <h1 id="ve-title" style={{ fontFamily: 'Bebas Neue' }} className="mb-4 text-center text-4xl">{t('ve_title')}</h1>
        <p className="text-base leading-relaxed text-gray-200">{t('ve_text', { email: user?.email || '' })}</p>
        <p className="mt-2 text-sm text-gray-500">{t('ve_spam')}</p>

        <div className="mt-6 flex flex-col gap-3">
          <button ref={first} type="button" onClick={check} disabled={Boolean(busy)} className={`${button} bg-emerald-400 text-black hover:bg-emerald-300`}>
            {busy === 'check' ? t('ve_checking') : t('ve_done')}
          </button>
          <button type="button" onClick={resend} disabled={Boolean(busy) || wait > 0} className={`${button} border border-white/25 text-white hover:border-white/60`}>
            {wait > 0 ? t('ve_resend_wait', { s: wait }) : t('ve_resend')}
          </button>
          <button type="button" onClick={leave} className="min-h-[44px] text-sm text-gray-400 underline underline-offset-2 hover:text-white">{t('ve_signout')}</button>
        </div>

        <p role="status" aria-live="polite" className={`mt-4 min-h-[1.5rem] text-sm ${tone}`}>{message.text}</p>
      </div>
    </div>
  )
}
