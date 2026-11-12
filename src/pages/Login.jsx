import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { API_URL } from '../config'
import { authFetch } from '../api/authFetch'
import { useI18n } from '../i18n/I18nContext'
import { loginErrorKey } from '../utils/loginErrors'

import {
  signInWithPopup,
  signInWithEmailAndPassword
} from 'firebase/auth'

import {
  auth,
  googleProvider
} from '../firebase/auth'

function Login() {

  const navigate = useNavigate()
  const { t } = useI18n()
  const [problem, setProblem] = useState('')            // a text key: the error is a line in the form, never a pop-up

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleLogin = async (e) => {

    e.preventDefault()
    setProblem('')

    try {

      await signInWithEmailAndPassword(
        auth,
        email,
        password
      )

      navigate('/dashboard')

    } catch (error) {

      setProblem(loginErrorKey(error) || '')

    }

  }

  const handleGoogleLogin = async () => {

    setProblem('')

    try {

      const result = await signInWithPopup(
        auth,
        googleProvider
      )

      const user = result.user

      await authFetch(
        `${API_URL}/users`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            firebase_uid: user.uid,
            nome: user.displayName,
            email: user.email,
            foto: user.photoURL,
            telefone: null,
            codigo_pais: null,
            cidade: null,
            morada: null,
            cep: null
          })
        }
      )

      navigate('/dashboard')

    } catch (error) {

      setProblem(loginErrorKey(error) || '')

    }

  }

  return (

    <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">

      <div className="w-full max-w-md border border-white/10 p-10">

        <h1
          style={{ fontFamily: 'Bebas Neue' }}
          className="text-5xl mb-10 text-center"
        >
          Login
        </h1>

        <form
          onSubmit={handleLogin}
          className="flex flex-col gap-6"
        >

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-transparent border border-white/20 px-6 py-4 outline-none"
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-transparent border border-white/20 px-6 py-4 outline-none"
            required
          />

          {problem && <p role="alert" className="text-sm text-red-300">{t(problem)}</p>}

          <button
            type="submit"
            className="bg-white text-black py-4 uppercase tracking-[3px] hover:bg-gray-300 transition duration-300"
          >
            Sign In
          </button>

          <button
            type="button"
            onClick={handleGoogleLogin}
            className="border border-white/20 py-4 uppercase tracking-[3px] hover:bg-white hover:text-black transition duration-300"
          >
            Continue With Google
          </button>

          <p className="text-center text-gray-400 text-sm mt-4">

            Don’t have an account?{" "}

            <Link
              to="/register"
              className="inline-block py-2 text-white hover:text-gray-300"
            >
              Register
            </Link>

          </p>

        </form>

      </div>

    </div>

  )

}

export default Login