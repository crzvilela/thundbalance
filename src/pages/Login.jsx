import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { API_URL } from '../config'
import { useChallenge } from '../challenge/useChallenge'
import { sendWithChallenge } from '../challenge/challenge'
import { authFetch } from '../api/authFetch'
import { useI18n } from '../i18n/I18nContext'
import { loginErrorKey } from '../utils/loginErrors'
import { Button, FormField, Input } from '../components/ui'
import { uiText } from '../legal/legalText'

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
  const { t, language } = useI18n()
  const legal = uiText(language)
  const [problem, setProblem] = useState('')            // a text key: the error is a line in the form, never a pop-up

  const guard = useChallenge()          // only the Google button can create a profile: the check starts when it is pressed
  const emailField = useRef(null)
  const passwordField = useRef(null)
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

      const key = loginErrorKey(error) || ''
      setProblem(key)
      if (key) (key === 'lgn_err_email' ? emailField : passwordField).current?.focus()      // the focus goes to the field to fix

    }

  }

  const handleGoogleLogin = async () => {

    setProblem('')
    guard.start()                       // solved while the Google window is open

    try {

      const result = await signInWithPopup(
        auth,
        googleProvider
      )

      const user = result.user

      await sendWithChallenge(guard, (challenge) => authFetch(
        `${API_URL}/users`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            challenge,
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
      ))

      navigate('/dashboard')

    } catch (error) {

      setProblem(error.message === 'ch_failed' ? 'ch_failed' : (loginErrorKey(error) || ''))

    }

  }

  return (

    <main id="main" className="min-h-screen bg-black text-white flex items-center justify-center px-6">

      <div className="w-full max-w-md border border-line p-10">

        <h1
          style={{ fontFamily: 'Bebas Neue' }}
          className="text-5xl mb-10 text-center"
        >
          {t('lgn_title')}
        </h1>

        <form
          onSubmit={handleLogin}
          className="flex flex-col gap-6"
        >

          {/* visible labels (the same FormField as the registration), with useful placeholders */}
          <FormField label={t('lgn_email_label')} id="login-email" className="-mb-4">
            {({ id }) => (
              <Input
                id={id}
                ref={emailField}
                name="email"
                type="email"
                autoComplete="username"
                placeholder={t('lgn_email')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? 'login-error' : undefined}
                invalid={Boolean(problem)}
                required
              />
            )}
          </FormField>

          <FormField label={t('lgn_password_label')} id="login-password" className="-mb-4">
            {({ id }) => (
              <Input
                id={id}
                ref={passwordField}
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder={t('lgn_password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? 'login-error' : undefined}
                invalid={Boolean(problem)}
                required
              />
            )}
          </FormField>

          {problem && <p id="login-error" role="alert" className="text-sm text-red-300">{t(problem)}</p>}

          <Button type="submit" variant="light" size="form" radius="none">
            {t('lgn_submit')}
          </Button>

          <Button type="button" variant="outline" size="form" radius="none" onClick={handleGoogleLogin}>
            {t('lgn_google')}
          </Button>

          <p className="text-center text-xs leading-relaxed text-gray-500">
            {legal.registerNotice}{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white">{legal.privacy}</a>{' '}{legal.registerNoticeAnd}{' '}
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white">{legal.terms}</a>.
          </p>

          <p className="text-center text-gray-400 text-sm mt-4">

            {t('lgn_no_account')}{" "}

            <Link
              to="/register"
              className="inline-block py-2 text-white hover:text-gray-300"
            >
              {t('lgn_register')}
            </Link>

          </p>

        </form>

      </div>

    </main>

  )

}

export default Login