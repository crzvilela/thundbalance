import { auth } from '../firebase/auth'
import { signOut } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import Navbar from '../components/Navbar'

function Dashboard() {

  const user = auth.currentUser
  const navigate = useNavigate()

  const [sessions, setSessions] = useState([])
  const [userData, setUserData] = useState(null)

  useEffect(() => {

    const loadUserSessions = async () => {

      try {

        const email = auth.currentUser.email

        const userResponse = await fetch(
          `http://127.0.0.1:8000/users/email/${email}`
        )

        

        const userData = await userResponse.json()

        setUserData(userData)
        

        const sessionsResponse = await fetch(
          `http://127.0.0.1:8000/sessions/user/${userData.id}`
        )

        const sessionsData = await sessionsResponse.json()

        setSessions(sessionsData)

      } catch (error) {
        console.log(error)
      }

    }

    loadUserSessions()

  }, [])

  const handleLogout = async () => {

    try {
      await signOut(auth)
      navigate('/login')
    } catch (error) {
      console.log(error)
      alert('Erro ao terminar sessão')
    }

  }

  const upcomingSessions = sessions.filter(
    (session) => session[4] === 'Booked'
  )

  return (
    <div className="min-h-screen bg-black text-white">

      <Navbar />

      <div className="p-10 pt-36">

        <div className="max-w-7xl mx-auto">

          <div className="flex justify-between items-center mb-12">

            <h1
              style={{ fontFamily: 'Bebas Neue' }}
              className="text-6xl"
            >
              Dashboard
            </h1>

            <button
              onClick={handleLogout}
              className="border border-red-500 text-red-500 px-6 py-3 hover:bg-red-500 hover:text-white transition duration-300"
            >
              Logout
            </button>

          </div>

          {user && (

            <div className="border border-white/10 p-8 rounded-2xl mb-12">

              <div className="flex items-center gap-6">

                <img
                  src={
                    user.photoURL ||
                    `https://ui-avatars.com/api/?name=${encodeURIComponent(
                      user.displayName || 'User'
                    )}`
                  }
                  alt="Profile"
                  className="w-24 h-24 rounded-full border border-white/20"
                />

                <div>

                  <h2 className="text-3xl mb-2">
                    Welcome Back,
                  </h2>

                  <h3 className="text-2xl">
                    {user.displayName}
                  </h3>

                  <p className="text-gray-400">
                    {user.email}
                  </p>

                </div>

              </div>

            </div>

          )}

          <div className="grid md:grid-cols-4 gap-8">

            <div className="border border-white/10 p-8 rounded-2xl">

              <p className="text-gray-400 mb-4">
                Next Session
              </p>

              {sessions.length > 0 ? (

                <div>

                  <h2 className="text-3xl mb-2">
                    {sessions[0][1]}
                  </h2>

                  <p className="text-gray-400">
                    {sessions[0][2]}
                  </p>

                  <p className="mt-4">
                    Trainer: {sessions[0][3]}
                  </p>

                  <p className="text-green-400">
                    {sessions[0][4]}
                  </p>

                </div>

              ) : (

                <h2 className="text-3xl">
                  Not Scheduled
                </h2>

              )}

            </div>

            <div className="border border-white/10 p-8 rounded-2xl">

              <p className="text-gray-400 mb-4">
                Active Plan
              </p>

              <h2 className="text-3xl">
                {userData?.plano || 'No Plan Assigned'}
              </h2>

            </div>

            <div className="border border-white/10 p-8 rounded-2xl">

              <p className="text-gray-400 mb-4">
                Total Sessions
              </p>

              <h2 className="text-3xl">
                {sessions.length}
              </h2>

            </div>

            <div className="border border-white/10 p-8 rounded-2xl">

              <p className="text-gray-400 mb-4">
                Upcoming Sessions
              </p>

              <h2 className="text-3xl">
                {upcomingSessions.length}
              </h2>

            </div>

          </div>

          {/* RECENT SESSIONS */}
          <div className="mt-16">

            <h2
              style={{ fontFamily: 'Bebas Neue' }}
              className="text-4xl mb-8"
            >
              Recent Sessions
            </h2>

            <div className="border border-white/10 rounded-2xl overflow-hidden">

              <div className="grid grid-cols-4 p-6 border-b border-white/10 font-bold">
                <div>Date</div>
                <div>Time</div>
                <div>Trainer</div>
                <div>Status</div>
              </div>

              {sessions.length === 0 ? (

                <div className="p-8 text-center text-gray-400">
                  No sessions found.
                </div>

              ) : (

                sessions.slice(0, 5).map((session) => (

                  <div
                    key={session[0]}
                    className="grid grid-cols-4 p-6 border-b border-white/10"
                  >

                    <div>{session[1]}</div>
                    <div>{session[2]}</div>
                    <div>{session[3]}</div>

                    <div
                      className={
                        session[4] === 'Booked'
                          ? 'text-green-400'
                          : 'text-red-400'
                      }
                    >
                      {session[4]}
                    </div>

                  </div>

                ))

              )}

            </div>

          </div>

          <div className="mt-12 flex gap-4">

           

            <button
              onClick={() => navigate('/my-sessions')}
              className="border border-white px-8 py-4 uppercase tracking-[3px] hover:bg-white hover:text-black transition duration-300"
            >
              My Sessions
            </button>

            <button
              onClick={() => navigate('/training-request')}
              className="border border-green-500 text-green-500 px-8 py-4 uppercase tracking-[3px] hover:bg-green-500 hover:text-white transition duration-300 ml-4"
            >
              CHOOSE PACK
            </button>

          </div>

        </div>

      </div>

    </div>
  )
}

export default Dashboard