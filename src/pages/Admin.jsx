import { useEffect, useState } from 'react'
import Navbar from '../components/Navbar'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import Calendar from 'react-calendar'
import 'react-calendar/dist/Calendar.css'
import { API_URL } from '../config'

function Admin() {

  const [stats, setStats] = useState(null)

  const [users, setUsers] = useState([])

  const [trainers, setTrainers] = useState([])

  const [sessions, setSessions] = useState([])

  const [requests, setRequests] = useState([])

  const [selectedTrainer, setSelectedTrainer] = useState({})


  const [startDates, setStartDates] = useState({})

  const [showSessions, setShowSessions] = useState(false)

  const [searchEmail, setSearchEmail] = useState('')

  const [filteredSessions, setFilteredSessions] = useState([])
  
  const [clientProgress, setClientProgress] = useState(null)

  const [selectedSession, setSelectedSession] = useState(null)

        
  const [selectedDate, setSelectedDate] = useState(
  new Date()
  )

  const assignPlan = async (
  userId,
  planId
  ) => {

    try {

      await fetch(
        `${API_URL}/admin/assign-plan`,
        {
          method: 'POST',

          headers: {
            'Content-Type': 'application/json'
          },

          body: JSON.stringify({

            user_id: userId,

            plan_id: planId

          })
        }
      )

      window.location.reload()

    } catch (error) {

      console.log(error)

    }

  }

  useEffect(() => {

    const loadData = async () => {
      const requestsResponse = await fetch(
        '${API_URL}/admin/client-requests'
      )

      const requestsData =
        await requestsResponse.json()

      setRequests(requestsData)

      try {

        const statsResponse = await fetch(
          '${API_URL}/admin/stats'
        )

        const statsData = await statsResponse.json()

        setStats(statsData)

        const usersResponse = await fetch(
          '${API_URL}/admin/users'
        )

        const usersData = await usersResponse.json()

        setUsers(usersData)

        const trainersResponse = await fetch(
          '${API_URL}/admin/trainers'
        )

        const trainersData = await trainersResponse.json()

        setTrainers(trainersData)

        const sessionsResponse = await fetch(
          '${API_URL}/admin/sessions'
        )

        const sessionsData = await sessionsResponse.json()

        setSessions(sessionsData)

      } catch (error) {

        console.log(error)

      }

    }

    loadData()

  }, [])

  const searchClient = async () => {

    try {

      const sessionsResponse = await fetch(
        `${API_URL}/admin/sessions/email/${searchEmail}`
      )

      const sessionsData =
        await sessionsResponse.json()

      setFilteredSessions(
        sessionsData
      )

      const progressResponse =
        await fetch(
          `${API_URL}/admin/client-progress/${searchEmail}`
        )

      const progressData =
        await progressResponse.json()

      setClientProgress(
        progressData
      )

    } catch (error) {

      console.log(error)

    }

  

  }

  const approveRequest = async (
    requestId
  ) => {

    try {

      const trainerId =
        selectedTrainer[requestId]

      const startDate =
        startDates[requestId]

      if (
        !trainerId ||
        !startDate
      ) {

        alert(
          'Select trainer and start date'
        )

        return

      }

      await fetch(
        `${API_URL}/admin/approve-request`,
        {
          method: 'POST',

          headers: {
            'Content-Type': 'application/json'
          },

          body: JSON.stringify({

            request_id: requestId,

            trainer_id:
              parseInt(trainerId),

            start_date:
              startDate

          })

        }
      )

      alert(
        'Request approved!'
      )

      window.location.reload()

    } catch (error) {

      console.log(error)

    }

  }

  if (!stats) {

    return (

      <div className="min-h-screen bg-black text-white flex items-center justify-center">

        Loading...

      </div>

    )

  }

  return (

    <div className="min-h-screen bg-black text-white">

      <Navbar />

      <div className="p-10 pt-36">

        <div className="max-w-7xl mx-auto">

          <h1
            style={{ fontFamily: 'Bebas Neue' }}
            className="text-6xl mb-12"
          >
            Admin Dashboard
          </h1>

          <div className="grid md:grid-cols-3 gap-6 mb-12">

            <div className="border border-white/10 p-8 rounded-2xl">

              <p className="text-gray-400 mb-2">
                Total Users
              </p>

              <h2 className="text-4xl">
                {stats.users}
              </h2>

            </div>

            <div className="border border-white/10 p-8 rounded-2xl">

              <p className="text-gray-400 mb-2">
                Total Trainers
              </p>

              <h2 className="text-4xl">
                {stats.trainers}
              </h2>

            </div>

            <div className="border border-white/10 p-8 rounded-2xl">

              <p className="text-gray-400 mb-2">
                Total Sessions
              </p>

              <h2 className="text-4xl">
                {stats.sessions}
              </h2>

            </div>

          </div>

          <div className="grid lg:grid-cols-2 gap-10">

            <div className="border border-white/10 p-8 rounded-2xl">

              <h2 className="text-3xl mb-6">
                Users
              </h2>

              {users.map(user => (

                <div
                  key={user[0]}
                  className="border-b border-white/10 py-3"
                >

                  <p>{user[1]}</p>

                  <p className="text-gray-400 text-sm">
                    {user[2]}
                  </p>

                  <p className="text-yellow-400 text-sm mt-1">
                    {user[3]}
                  </p>


                  <div className="flex gap-2 mt-3">

                    <div className="flex gap-2 mt-3">

                    <button
                      onClick={() => assignPlan(user[0], 1)}
                      className={`px-3 py-1 border rounded transition ${
                        user[3] === '1 Month Pack'
                          ? 'bg-green-600 border-green-600 text-white'
                          : 'border-white/20'
                      }`}
                    >
                      Monthly
                    </button>

                    <button
                      onClick={() => assignPlan(user[0], 2)}
                      className={`px-3 py-1 border rounded transition ${
                        user[3] === '3 Months Pack'
                          ? 'bg-green-600 border-green-600 text-white'
                          : 'border-white/20'
                      }`}
                    >
                      Quarterly
                    </button>

                    <button
                      onClick={() => assignPlan(user[0], 3)}
                      className={`px-3 py-1 border rounded transition ${
                        user[3] === '6 Months Pack'
                          ? 'bg-green-600 border-green-600 text-white'
                          : 'border-white/20'
                      }`}
                    >
                      Semiannual
                    </button>

                  </div>

                  </div>
                </div>

              ))}

            </div>

            <div className="border border-white/10 p-8 rounded-2xl">

              <h2 className="text-3xl mb-6">
                Trainers
              </h2>

              {trainers.map(trainer => (

                <div
                  key={trainer[0]}
                  className="border-b border-white/10 py-3"
                >

                  <p>{trainer[1]}</p>

                  <p className="text-gray-400 text-sm">
                    {trainer[2]}
                  </p>

                </div>

              ))}

            </div>

          </div>

          <div className="border border-white/10 p-8 rounded-2xl mt-10">

            <h2 className="text-3xl mb-6">
              Sessions
            </h2>

            <div className="border border-white/10 p-8 rounded-2xl mt-10">

            <h2 className="text-3xl mb-6">
              Training Requests
            </h2>

            {requests.map(request => (

              <div
                key={request[0]}
                className="border-b border-white/10 py-4"
              >

                <p>

                  <strong>{request[1]}</strong>

                </p>

                <p className="text-gray-400">

                  {request[2]}

                </p>

                <p className="text-gray-400">

                  {request[3]} sessions/week

                </p>

                <p className="text-gray-400">

                  {request[4]}
                </p>

                <p className="text-gray-400">

                  {request[5]}
                </p>

                <p className="text-yellow-400">

                  {request[6]}
                </p>

                <div className="mt-4">

                  <select
                    value={
                      selectedTrainer[
                        request[0]
                      ] || ''
                    }

                    onChange={(e) =>
                      setSelectedTrainer({

                        ...selectedTrainer,

                        [request[0]]:
                          e.target.value

                      })
                    }

                    className="bg-black border border-white/20 p-3 mr-3"
                  >

                    <option value="">
                      Select Trainer
                    </option>

                    {trainers.map(trainer => (

                      <option
                        key={trainer[0]}
                        value={trainer[0]}
                      >
                        {trainer[1]}
                      </option>

                    ))}

                  </select>

                  <DatePicker

                    selected={
                      startDates[request[0]]
                        ? new Date(
                            startDates[request[0]]
                          )
                        : null
                    }

                    onChange={(date) =>

                      setStartDates({

                        ...startDates,

                        [request[0]]:
                          `${date.getFullYear()}-${
                            String(
                              date.getMonth() + 1
                            ).padStart(2, '0')
                          }-${
                            String(
                              date.getDate()
                            ).padStart(2, '0')
                          }`

                      })

                    }

                    minDate={new Date()}

                    dateFormat="dd/MM/yyyy"

                    placeholderText="Select Start Date"

                    className="bg-black border border-white/20 p-3 mr-3 text-white"
                  />

                  <button
                    onClick={() =>
                      approveRequest(
                        request[0]
                      )
                    }
                    className="bg-green-600 px-4 py-3 rounded"
                  >
                    Approve
                  </button>

                </div>

              </div>

            ))}

          </div>

          <div className="flex items-center justify-between mb-6">

            {clientProgress && (

              <div className="border border-green-600 rounded-2xl p-6 mb-6">

                <h3 className="text-3xl mb-4">

                  Progress

                </h3>

                <div className="w-full h-4 bg-white/10 rounded-full mb-6 overflow-hidden">

                  <div
                    className="h-full bg-green-500 rounded-full transition-all duration-700"
                    style={{
                      width: `${
                        (clientProgress.completed /
                          clientProgress.total) * 100
                      }%`
                    }}
                  />

                </div>

                <p className="text-5xl font-bold text-green-500">

                  {clientProgress.completed}/
                  {clientProgress.total}

                </p>

                <p className="text-gray-400 mt-2">

                  {Math.round(

                    (clientProgress.completed /
                      clientProgress.total) * 100

                  )}% Completed

                </p>

                <p className="mt-4">

                  Remaining:

                  {' '}

                  {clientProgress.remaining}

                </p>

                <p>

                  Next Session:

                  {' '}

                  {clientProgress.next_session}

                </p>

              </div>

            )}

            <h2
              style={{ fontFamily: 'Bebas Neue' }}
              className="text-5xl mb-4"
            >
              Filter Session
            </h2>

            <div className="flex gap-4">

              <input
                type="text"
                placeholder="Client Email"
                value={searchEmail}
                onChange={(e) =>
                  setSearchEmail(e.target.value)
                }
                className="bg-black border border-white/20 p-3 rounded-lg w-80"
              />

              <button
                onClick={searchClient}
                className="bg-white text-black px-5 rounded-lg"
              >
                Search
              </button>

              <button
                onClick={() =>
                  setShowSessions(!showSessions)
                }
                className="border border-white/20 px-5 py-2 rounded-lg hover:bg-white hover:text-black transition"
              >
                {
                  showSessions
                    ? 'Hide Sessions'
                    : 'View Sessions'
                }
              </button>

            </div>

            <div className="mt-8">

              <Calendar

                onChange={setSelectedDate}

                value={selectedDate}

                tileClassName={({ date }) => {

                  const sessionsToCheck =
                    filteredSessions.length > 0
                      ? filteredSessions
                      : sessions

                  const foundSession =
                    sessionsToCheck.find(session => {

                      const sessionDate =
                        new Date(session[1])

                      return (
                        sessionDate.getFullYear() === date.getFullYear()
                        &&
                        sessionDate.getMonth() === date.getMonth()
                        &&
                        sessionDate.getDate() === date.getDate()
                      )

                    })

                  if (!foundSession)
                    return null

                  const today = new Date()

                  const sessionDate =
                    new Date(foundSession[1])

                  if (sessionDate < today)
                    return 'completed-day'

                  return 'training-day'

                }}

                onClickDay={(date) => {

                  const sessionsToCheck =
                    filteredSessions.length > 0
                      ? filteredSessions
                      : sessions

                  const foundSession =
                    sessionsToCheck.find(session => {

                      const sessionDate =
                        new Date(session[1])

                      return (
                        sessionDate.getFullYear() === date.getFullYear()
                        &&
                        sessionDate.getMonth() === date.getMonth()
                        &&
                        sessionDate.getDate() === date.getDate()
                      )

                    })

                  setSelectedSession(
                    foundSession || null
                  )

                }}

              />

              <div className="flex gap-6 mt-6">

                <div className="flex items-center gap-2">

                  <div className="w-4 h-4 rounded-full bg-green-500" />

                  <span>Upcoming</span>

                </div>

                <div className="flex items-center gap-2">

                  <div className="w-4 h-4 rounded-full bg-blue-500" />

                  <span>Completed</span>

                </div>

              </div>

              {selectedSession && (

                <div
                  onClick={() =>
                    setSelectedSession(null)
                  }
                  className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6"
                >

                  <div
                    onClick={(e) =>
                      e.stopPropagation()
                    }
                    className="w-full max-w-3xl border border-white/10 bg-[#0a0a0a] rounded-3xl p-8"
                  >

                    <p className="text-green-500 uppercase tracking-[4px] text-sm mb-4">
                      Session Details
                    </p>

                    <h2
                      style={{ fontFamily: 'Bebas Neue' }}
                      className="text-5xl mb-8"
                    >
                      {selectedSession[0]}
                    </h2>

                    <div className="grid md:grid-cols-2 gap-6">

                      <div className="border border-white/10 rounded-2xl p-5">

                        <p className="text-gray-400 text-sm mb-2">
                          Trainer
                        </p>

                        <h3 className="text-2xl">
                          {selectedSession[4]}
                        </h3>

                      </div>

                      <div className="border border-white/10 rounded-2xl p-5">

                        <p className="text-gray-400 text-sm mb-2">
                          Status
                        </p>

                        <h3 className="text-2xl text-green-500">
                          {selectedSession[3]}
                        </h3>

                      </div>

                      <div className="border border-white/10 rounded-2xl p-5">

                        <p className="text-gray-400 text-sm mb-2">
                          Date
                        </p>

                        <h3 className="text-2xl">
                          {selectedSession[1]}
                        </h3>

                      </div>

                      <div className="border border-white/10 rounded-2xl p-5">

                        <p className="text-gray-400 text-sm mb-2">
                          Time
                        </p>

                        <h3 className="text-2xl">
                          {selectedSession[2]}
                        </h3>

                      </div>

                    </div>

                    <button
                      onClick={() =>
                        setSelectedSession(null)
                      }
                      className="mt-8 border border-white/20 px-6 py-3 rounded-xl hover:bg-white hover:text-black transition"
                    >
                      Close
                    </button>

                  </div>

                </div>

              )}

            </div>

            

          </div>

          {showSessions && (

            <div className="max-h-[500px] overflow-y-auto">

              {sessions.map(session => (

                <div
                  key={session[0]}
                  className="border-b border-white/10 py-4"
                >

                  <p>

                    <strong>{session[1]}</strong>

                    {' '}with{' '}

                    <strong>{session[2]}</strong>

                  </p>

                  <p className="text-gray-400">

                    {session[3]} | {session[4]}

                  </p>

                  <p className="text-green-400">

                    {session[5]}

                  </p>

                </div>

              ))}

            </div>

          )}

          </div>

        </div>

      </div>

    </div>

  )

}

export default Admin