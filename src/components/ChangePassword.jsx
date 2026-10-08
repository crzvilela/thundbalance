import { useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { auth } from '../firebase/auth'
import { useI18n } from '../i18n/I18nContext'

const MIN_LENGTH = 6   // Firebase's minimum
const EMPTY = { current: '', next: '', repeat: '' }
const FIELDS = [
  ['current', 'cp_current', 'current-password'],
  ['next', 'cp_new', 'new-password'],
  ['repeat', 'cp_repeat', 'new-password'],
]

// Firebase error code -> text key. Anything unknown gets a generic message;
// passwords are never logged.
const ERROR_KEYS = {
  'auth/wrong-password': 'cp_e_wrong',
  'auth/invalid-credential': 'cp_e_wrong',
  'auth/invalid-login-credentials': 'cp_e_wrong',
  'auth/weak-password': 'cp_e_weak',
  'auth/too-many-requests': 'cp_e_many',
  'auth/requires-recent-login': 'cp_e_recent',
  'auth/network-request-failed': 'cp_e_network',
}

function EyeIcon({ off }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  )
}

// "Change password" card for the Profile page. Only for accounts that sign in
// with email and password (Google accounts have no password to change). The
// password lives in Firebase Authentication; nothing is sent to our server.
//
// `banner` is an optional node shown at the top of the card (see PasswordBanner).
// `onChanged` is called after the password was changed.
export default function ChangePassword({ user, banner = null, onChanged }) {
  const { t } = useI18n()
  const [values, setValues] = useState(EMPTY)
  const [visible, setVisible] = useState({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)   // { tone: 'error' | 'success', key }

  const hasPassword = !!user?.providerData?.some(provider => provider.providerId === 'password')
  if (!hasPassword) return null

  const set = (name) => (event) => {
    setValues(current => ({ ...current, [name]: event.target.value }))
    if (message?.tone === 'error') setMessage(null)
  }

  const validate = () => {
    if (!values.current) return 'cp_e_current_required'
    if (values.next.length < MIN_LENGTH) return 'cp_e_weak'
    if (values.next !== values.repeat) return 'cp_e_mismatch'
    if (values.next === values.current) return 'cp_e_same'
    return null
  }

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    const problem = validate()
    if (problem) { setMessage({ tone: 'error', key: problem }); return }

    const current = auth.currentUser
    if (!current?.email) { setMessage({ tone: 'error', key: 'cp_e_recent' }); return }
    setBusy(true)
    setMessage(null)
    try {
      await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, values.current))
      await updatePassword(current, values.next)
      setValues(EMPTY)
      setVisible({})
      setMessage({ tone: 'success', key: 'cp_ok' })
      // e.g. tell the server the temporary password is gone; its failure must not hide the success
      Promise.resolve(onChanged?.()).catch(() => {})
    } catch (error) {
      setMessage({ tone: 'error', key: ERROR_KEYS[error?.code] || 'cp_e_generic' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="change-password-title" className="rounded-3xl border border-white/10 bg-white/[0.025] p-6 md:p-9">
      {banner}
      <div className="mb-8 border-b border-white/10 pb-6">
        <h2 id="change-password-title" className="text-xl font-semibold">{t('cp_title')}</h2>
        <p className="mt-2 text-sm text-gray-500">{t('cp_intro')}</p>
      </div>

      <form onSubmit={submit} noValidate>
        <div className="grid gap-6 sm:grid-cols-2">
          {FIELDS.map(([name, label, autoComplete]) => (
            <div key={name} className={name === 'current' ? 'sm:col-span-2' : ''}>
              <label htmlFor={`password-${name}`} className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-400">{t(label)}</label>
              <div className="relative">
                <input
                  id={`password-${name}`} name={name} type={visible[name] ? 'text' : 'password'}
                  value={values[name]} onChange={set(name)} disabled={busy} autoComplete={autoComplete}
                  className="w-full rounded-xl border border-white/15 bg-black/20 py-3 pl-4 pr-12 text-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/10 disabled:opacity-60"
                />
                <button
                  type="button" onClick={() => setVisible(current => ({ ...current, [name]: !current[name] }))}
                  aria-label={t(visible[name] ? 'cp_hide' : 'cp_show')} aria-pressed={!!visible[name]}
                  className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-gray-400 transition hover:text-white"
                >
                  <EyeIcon off={!!visible[name]} />
                </button>
              </div>
              {name === 'next' && <p className="mt-2 text-xs text-gray-500">{t('cp_hint')}</p>}
            </div>
          ))}
        </div>

        {message && (
          <p
            role={message.tone === 'error' ? 'alert' : 'status'}
            className={`mt-6 rounded-xl border px-4 py-3 text-sm ${message.tone === 'error' ? 'border-red-400/20 bg-red-400/10 text-red-200' : 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'}`}
          >
            {t(message.key)}
          </p>
        )}

        <div className="mt-8 flex justify-end border-t border-white/10 pt-6">
          <button
            type="submit" disabled={busy}
            className="w-full rounded-xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-50 sm:w-auto"
          >
            {busy ? t('cp_saving') : t('cp_save')}
          </button>
        </div>
      </form>
    </section>
  )
}
