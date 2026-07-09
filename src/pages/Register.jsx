import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { API_URL } from '../config'

import {
  createUserWithEmailAndPassword,
  updateProfile
} from 'firebase/auth'

import { auth } from '../firebase/auth'

function Register() {

  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [countryCode, setCountryCode] = useState('+351')
  const [phone, setPhone] = useState('')
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleRegister = async (e) => {

    e.preventDefault()

    try {

      const result =
        await createUserWithEmailAndPassword(
          auth,
          email,
          password
        )

      const user = result.user

      await updateProfile(
        user,
        {
          displayName: name
        }
      )

      await fetch(
        '${API_URL}/users',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            firebase_uid: user.uid,
            nome: name,
            email: email,
            foto: null,

            telefone: phone,
            codigo_pais: countryCode,
            cidade: city,
            morada: address,
            cep: zipCode
          })
        }
      )

      alert('Account created successfully!')

      navigate('/dashboard')

    } catch (error) {

      console.log(error)

      alert(error.message)

    }

  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-6 py-10">

      <div className="w-full max-w-lg border border-white/10 p-10 rounded-2xl">

        <h1
          style={{ fontFamily: 'Bebas Neue' }}
          className="text-5xl mb-10 text-center"
        >
          Register
        </h1>

        <form
          onSubmit={handleRegister}
          className="flex flex-col gap-5"
        >

          <input
            type="text"
            placeholder="Full Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-transparent border border-white/20 px-6 py-4 outline-none rounded-lg"
          />

          <div className="flex gap-3">

            <select
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              className="bg-black border border-white/20 px-4 py-4 rounded-lg"
            >
              <option value="+351">🇵🇹 +351</option>
              <option value="+55">🇧🇷 +55</option>
              <option value="+34">🇪🇸 +34</option>
              <option value="+1">🇺🇸 +1</option>
            </select>

            <input
              type="text"
              placeholder="Phone Number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="flex-1 bg-transparent border border-white/20 px-6 py-4 outline-none rounded-lg"
            />

          </div>

          <input
            type="text"
            placeholder="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="bg-transparent border border-white/20 px-6 py-4 outline-none rounded-lg"
          />

          <input
            type="text"
            placeholder="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="bg-transparent border border-white/20 px-6 py-4 outline-none rounded-lg"
          />

          <input
            type="text"
            placeholder="ZIP Code"
            value={zipCode}
            onChange={(e) => setZipCode(e.target.value)}
            className="bg-transparent border border-white/20 px-6 py-4 outline-none rounded-lg"
          />

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-transparent border border-white/20 px-6 py-4 outline-none rounded-lg"
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-transparent border border-white/20 px-6 py-4 outline-none rounded-lg"
          />

          <button
            type="submit"
            className="bg-white text-black py-4 uppercase tracking-[3px] rounded-lg hover:bg-gray-300 transition duration-300"
          >
            Create Account
          </button>

          <p className="text-center text-gray-400 text-sm mt-2">

            Already have an account?{' '}

            <Link
              to="/login"
              className="text-white hover:text-gray-300"
            >
              Login
            </Link>

          </p>

        </form>

      </div>

    </div>
  )
}

export default Register