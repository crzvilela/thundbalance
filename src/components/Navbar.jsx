import { auth } from '../firebase/auth'
import { signOut } from 'firebase/auth'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'

function Navbar() {

  const navigate = useNavigate()

  const user = auth.currentUser

  const [openMenu, setOpenMenu] = useState(false)

  const handleLogout = async () => {

    try {

      await signOut(auth)

      navigate('/')

    } catch (error) {

      console.log(error)

    }

  }

  return (
    <nav className="fixed top-0 left-0 w-full z-50 px-6 pt-6">

      <div className="max-w-7xl mx-auto backdrop-blur-md bg-black/40 border border-white/10 rounded-2xl px-8 py-5 flex justify-between items-center">

        <Link
          to="/"
          className="text-2xl tracking-[4px] font-bold hover:text-gray-400 transition duration-300"
        >
          THUNDBALANCE
        </Link>

        <div className="flex items-center gap-10">

          {!user ? (

            <ul className="hidden md:flex gap-8 text-sm uppercase tracking-wider">

              <li>
                <a
                  href="#about"
                  className="hover:text-gray-400 transition duration-300"
                >
                  About
                </a>
              </li>

              <li>
                <a
                  href="#services"
                  className="hover:text-gray-400 transition duration-300"
                >
                  Services
                </a>
              </li>

              <li>
                <a
                  href="#pricing"
                  className="hover:text-gray-400 transition duration-300"
                >
                  Pricing
                </a>
              </li>

              <li>
                <a
                  href="#contact"
                  className="hover:text-gray-400 transition duration-300"
                >
                  Contact
                </a>
              </li>

            </ul>

          ) : (

            <ul className="hidden md:flex gap-8 text-sm uppercase tracking-wider">

              <li>
                <Link
                  to="/"
                  className="hover:text-gray-400 transition duration-300"
                >
                  Home
                </Link>
              </li>

              <li>
                <Link
                  to="/dashboard"
                  className="hover:text-gray-400 transition duration-300"
                >
                  Dashboard
                </Link>
              </li>

              <li>
                <Link
                  to="/profile"
                  className="hover:text-gray-400 transition duration-300"
                >
                  Profile
                </Link>
              </li>

              <li>
                <Link
                  to="/my-sessions"
                  className="hover:text-gray-400 transition duration-300"
                >
                  Sessions
                </Link>
              </li>

            </ul>

          )}

          {!user ? (

            <div className="flex items-center gap-4">

              <Link
                to="/login"
                className="hover:text-gray-400 transition duration-300 uppercase text-sm"
              >
                Login
              </Link>

              <Link
                to="/register"
                className="border border-white/20 px-4 py-2 rounded-lg hover:bg-white hover:text-black transition duration-300 uppercase text-sm"
              >
                Register
              </Link>

            </div>

          ) : (

            <div className="relative">

              <img
                src={
                  user.photoURL ||
                  'https://ui-avatars.com/api/?name=' +
                  encodeURIComponent(user.displayName || 'User')
                }
                alt="Profile"
                onClick={() => setOpenMenu(!openMenu)}
                className="w-12 h-12 rounded-full cursor-pointer border border-white/20 hover:scale-105 transition duration-300"
              />

              {openMenu && (

                <div className="absolute right-0 mt-4 w-56 bg-black border border-white/10 rounded-xl overflow-hidden">

                  <div className="p-4 border-b border-white/10">

                    <p className="font-semibold">
                      {user.displayName}
                    </p>

                    <p className="text-xs text-gray-400 truncate">
                      {user.email}
                    </p>

                  </div>

                  <Link
                    to="/dashboard"
                    className="block px-4 py-3 hover:bg-white/10 transition duration-300"
                  >
                    Dashboard
                  </Link>

                  <Link
                    to="/profile"
                    className="block px-4 py-3 hover:bg-white/10 transition duration-300"
                  >
                    Profile
                  </Link>

                  <Link
                    to="/my-sessions"
                    className="block px-4 py-3 hover:bg-white/10 transition duration-300"
                  >
                    My Sessions
                  </Link>

                  <Link
                    to="/book-session"
                    className="block px-4 py-3 hover:bg-white/10 transition duration-300"
                  >
                    Book Session
                  </Link>

                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-3 text-red-400 hover:bg-red-500 hover:text-white transition duration-300"
                  >
                    Logout
                  </button>

                </div>

              )}

            </div>

          )}

        </div>

      </div>

    </nav>
  )
}

export default Navbar