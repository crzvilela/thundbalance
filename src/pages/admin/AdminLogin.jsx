import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth } from '../../firebase/auth'
import { ADMIN_EMAIL } from '../../config'

export default function AdminLogin() {
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
        setError('Este e-mail não tem acesso de administrador.')
        return
      }

      const destination = location.state?.from?.pathname || '/admin'
      navigate(destination, { replace: true })
    } catch {
      setError('Não foi possível entrar. Confira o e-mail e a senha.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 p-8 md:p-10">
        <p className="mb-3 text-center text-xs uppercase tracking-[0.3em] text-emerald-400">Thundbalance</p>
        <h1 className="mb-8 text-center text-3xl font-semibold">Acesso administrativo</h1>

        {location.state?.denied && (
          <p className="mb-5 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">
            Esta conta não tem acesso de administrador.
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <label className="flex flex-col gap-2 text-sm text-gray-300">
            E-mail
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded-lg border border-white/15 bg-transparent px-4 py-3 text-white outline-none focus:border-emerald-400"
              required
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-gray-300">
            Senha
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-lg border border-white/15 bg-transparent px-4 py-3 text-white outline-none focus:border-emerald-400"
              required
            />
          </label>

          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-emerald-400 px-4 py-3 font-semibold text-black transition hover:bg-emerald-300 disabled:opacity-50"
          >
            {submitting ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  )
}
