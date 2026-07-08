import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

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

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleLogin = async (e) => {

    e.preventDefault()

    try {

      await signInWithEmailAndPassword(
        auth,
        email,
        password
      )

      alert('Login successful!')

      navigate('/')

    } catch (error) {

      console.log(error)

      alert(error.message)

    }

  }

  const handleGoogleLogin = async () => {

    try {

      const result = await signInWithPopup(
        auth,
        googleProvider
      )

      const user = result.user

      await fetch(
        'http://127.0.0.1:8000/users',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            firebase_uid: user.uid,
            nome: user.displayName,
            email: user.email,
            foto: user.photoURL
          })
        }
      )

      alert('Login successful!')

      navigate('/dashboard')

    } catch (error) {

      console.log(error)

      alert('Error during login')

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
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-transparent border border-white/20 px-6 py-4 outline-none"
          />

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

            Don’t have an account?{' '}

            <Link
              to="/register"
              className="text-white hover:text-gray-300"
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