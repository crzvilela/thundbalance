import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth } from '../../firebase/auth'
import { ADMIN_EMAIL } from '../../config'
import { useAdminText } from '../../admin/useAdminText'
import { Button, Field, TextInput } from '../../admin/ui'
import '../../admin/admin.css'

export default function AdminLogin() {
  const { t, language, setLanguage } = useAdminText()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password)
      if (credential.user.email?.trim().toLowerCase() !== ADMIN_EMAIL) {
        await signOut(auth)
        setError(t('lg_denied'))
        return
      }

      const destination = location.state?.from?.pathname || '/admin'
      navigate(destination, { replace: true })
    } catch {
      setError(t('lg_invalid'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="admin-shell relative flex min-h-screen items-center justify-center px-4 py-10 text-white">
      <div className="absolute right-4 top-4 flex rounded-lg border border-white/10 bg-black/30 p-0.5" role="group" aria-label="Language">
        {['en', 'es'].map(code => (
          <button key={code} type="button" onClick={() => setLanguage(code)} aria-pressed={language === code}
            className={`rounded-md px-3 py-1 text-xs font-semibold uppercase transition ${language === code ? 'bg-emerald-400 text-black' : 'text-gray-400 hover:text-white'}`}>
            {code}
          </button>
        ))}
      </div>

      <div className="admin-fade w-full max-w-md rounded-3xl border border-white/[0.08] bg-white/[0.03] p-8 shadow-2xl backdrop-blur md:p-10">
        <p className="text-center text-3xl tracking-[0.2em]" style={{ fontFamily: 'Bebas Neue, Inter, sans-serif' }}>THUNDBALANCE</p>
        <p className="mb-8 mt-1 flex items-center justify-center gap-2 text-xs uppercase tracking-[0.25em] text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
          {t('brand_sub')}
        </p>
        <h1 className="text-2xl font-semibold">{t('lg_title')}</h1>
        <p className="mb-7 mt-1 text-sm text-gray-400">{t('lg_sub')}</p>

        {location.state?.denied && (
          <p className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">{t('lg_denied')}</p>
        )}

        <form onSubmit={handleSubmit}>
          <Field label={t('lg_email')}>
            <TextInput type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </Field>
          <Field label={t('lg_password')}>
            <TextInput type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </Field>

          {error && <p role="alert" className="mb-4 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}

          <Button type="submit" variant="primary" className="w-full !py-3" loading={submitting}>
            {submitting ? t('lg_signing') : t('lg_submit')}
          </Button>
        </form>

        <Link to="/" className="mt-6 block text-center text-sm text-gray-500 transition hover:text-gray-300">{t('lg_back')}</Link>
      </div>
    </main>
  )
}
