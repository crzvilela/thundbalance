import { useEffect, useState } from 'react'
import { auth } from '../firebase/auth'
import Navbar from '../components/Navbar'

import DatePicker from 'react-datepicker'
import Calendar from 'react-calendar'

import 'react-datepicker/dist/react-datepicker.css'
import 'react-calendar/dist/Calendar.css'
import { API_URL } from '../config'

function MySessions() {

  const [sessions, setSessions] = useState([])
  const [selectedDate, setSelectedDate] =
  useState(new Date())

  const [selectedSession, setSelectedSession] = useState(null)
  

  const [editingSession, setEditingSession] = useState(null)

  const [newDate, setNewDate] = useState(null)
  const [newTime, setNewTime] = useState('09:00')
  const [availableTimes, setAvailableTimes] = useState([])

  const loadSessions = async () => {

    try {

      const email = auth.currentUser.email

      const userResponse = await fetch(
        `${API_URL}/users/email/${email}`
      )

      const userData = await userResponse.json()

      const sessionsResponse = await fetch(
        `${API_URL}/sessions/user/${userData.id}`
      )

      const sessionsData = await sessionsResponse.json()

      setSessions(sessionsData)

    } catch (error) {

      console.log(error)

    }

  }

  useEffect(() => {

    loadSessions()

  }, [])

  const formatDateForAPI = (date) => {

  return `${date.getFullYear()}-${
    String(date.getMonth() + 1).padStart(2, '0')
  }-${
    String(date.getDate()).padStart(2, '0')
  }`

}
  const loadAvailableTimes = async (
    trainerName,
    date
  ) => {

    const trainerMap = {

      David: 1,
      Carles: 2,
      Guille: 3,
      Matilda: 4

    }

    const trainerId =
      trainerMap[trainerName]

    if (!trainerId)
      return

    const formattedDate =
      formatDateForAPI(date)

    const response = await fetch(

      `${API_URL}/trainer/${trainerId}/available-times/${formattedDate}`

    )

    const data =
      await response.json()

    setAvailableTimes(data)

  }




  const handleReschedule = async (sessionId) => {

    try {

      await fetch(
        `${API_URL}/sessions/${sessionId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            session_date: formatDateForAPI(newDate),
            session_time: newTime
          })
        }
      )

      alert('Session rescheduled successfully!')

      setEditingSession(null)
      setSelectedSession(null)

      loadSessions()

    } catch (error) {

      console.log(error)

      alert('Error updating session')

    }

  }

  const handleCancel = async (sessionId) => {

  try {

    await fetch(
      `${API_URL}/sessions/${sessionId}`,
      {
        method: 'DELETE'
      }
    )

    alert('Session cancelled successfully!')

    loadSessions()

  } catch (error) {

    console.log(error)

    alert('Error cancelling session')

  }

}

  return (
    <div className="min-h-screen bg-black text-white">

      <Navbar />

      <div className="p-10 pt-36">

        <div className="max-w-6xl mx-auto">

          <h1
            style={{ fontFamily: 'Bebas Neue' }}
            className="text-6xl mb-12"
          >
            My Sessions
          </h1>

          <div className="border border-white/10 rounded-3xl p-8">

            <Calendar

              onChange={setSelectedDate}

              value={selectedDate}

              tileClassName={({ date }) => {

                const foundSession =
                  sessions.find(session => {

                    const sessionDate =
                      new Date(session[1])

                    return (
                      sessionDate.getFullYear() ===
                        date.getFullYear()
                      &&
                      sessionDate.getMonth() ===
                        date.getMonth()
                      &&
                      sessionDate.getDate() ===
                        date.getDate()
                    )

                  })

                if (!foundSession)
                  return null

                const sessionDate =
                  new Date(foundSession[1])

                const today = new Date()

                if (foundSession[5])
                  return 'rescheduled-day'

                if (sessionDate < today)
                  return 'completed-day'

                return 'training-day'

              }}

              onClickDay={(date) => {

                const foundSession =
                  sessions.find(session => {

                    const sessionDate =
                      new Date(session[1])

                    return (
                      sessionDate.getFullYear() ===
                        date.getFullYear()
                      &&
                      sessionDate.getMonth() ===
                        date.getMonth()
                      &&
                      sessionDate.getDate() ===
                        date.getDate()
                    )

                  })

                setSelectedSession(
                  foundSession || null
                )

              }}

            />

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
                    {selectedSession[6] || 'Session'}
                  </h2>

                  <div className="grid md:grid-cols-2 gap-6">

                    <div className="border border-white/10 rounded-2xl p-5">

                      <p className="text-gray-400">
                        Trainer
                      </p>

                      <h3 className="text-2xl">
                        {selectedSession[3]}
                      </h3>

                    </div>

                    <div className="border border-white/10 rounded-2xl p-5">

                      <p className="text-gray-400">
                        Status
                      </p>

                      <h3 className="text-2xl">
                        {selectedSession[4]}
                      </h3>

                    </div>

                    <div className="border border-white/10 rounded-2xl p-5">

                      <p className="text-gray-400">
                        Date
                      </p>

                      <h3 className="text-2xl">
                        {selectedSession[1]}
                      </h3>

                    </div>

                    <div className="border border-white/10 rounded-2xl p-5">

                      <p className="text-gray-400">
                        Time
                      </p>

                      <h3 className="text-2xl">
                        {selectedSession[2]}
                      </h3>

                    </div>

                  </div>

                  <div className="flex gap-4 mt-8">

                    {editingSession === selectedSession[0] && (

                      <div className="mt-8 border-t border-white/10 pt-8">

                        <div className="grid md:grid-cols-2 gap-6">

                          <div>

                            <label className="block mb-3 text-gray-400">
                              New Date
                            </label>

                            <DatePicker
                              selected={newDate}
                             onChange={(date) => {

                              setNewDate(date)

                              loadAvailableTimes(

                                selectedSession[3],

                                date

                              )

                            }}
                              minDate={new Date()}
                              dateFormat="dd/MM/yyyy"
                              placeholderText="Select date"
                              className="w-full bg-black border border-white/20 p-4 rounded-xl text-white"
                            />

                          </div>

                          <div>

                            <label className="block mb-3 text-gray-400">
                              New Time
                            </label>

                            <select

                              value={newTime}

                              onChange={(e) =>
                                setNewTime(e.target.value)
                              }

                              className="w-full bg-black border border-white/20 p-4 rounded-xl"

                            >

                              {availableTimes.map(time => (

                                <option

                                  key={time}

                                  value={time}

                                >

                                  {time}

                                </option>

                              ))}

                            </select>

                          </div>

                        </div>

                        <button
                          onClick={() =>
                            handleReschedule(
                              selectedSession[0]
                            )
                          }
                          className="mt-6 bg-white text-black px-8 py-4 rounded-xl font-semibold hover:bg-gray-300 transition"
                        >
                          Save Changes
                        </button>

                      </div>

                    )}

                    {selectedSession &&
                      selectedSession[4] === 'Booked' &&
                      !selectedSession[5] && (

                        <button
                          onClick={() =>
                            setEditingSession(
                              selectedSession[0]
                            )
                          }
                          className="border border-blue-500 text-blue-500 px-6 py-3 rounded-xl hover:bg-blue-500 hover:text-white transition"
                        >
                          Reschedule
                        </button>

                    )}

                    {selectedSession && (

                      <button
                        onClick={() =>
                          handleCancel(
                            selectedSession[0]
                          )
                        }
                        className="border border-red-500 text-red-500 px-6 py-3 rounded-xl hover:bg-red-500 hover:text-white transition"
                      >
                        Cancel
                      </button>

                    )}

                  </div>

                </div>

              </div>

            )}

            <div className="flex gap-6 mt-6">

              <div className="flex items-center gap-2">

                <div className="w-4 h-4 bg-green-500 rounded-full" />

                <span>Upcoming</span>

              </div>

              <div className="flex items-center gap-2">

                <div className="w-4 h-4 bg-blue-500 rounded-full" />

                <span>Completed</span>

              </div>

              <div className="flex items-center gap-2">

                <div className="w-4 h-4 bg-yellow-500 rounded-full" />

                <span>Rescheduled</span>

              </div>

             

            </div>

          </div>

        </div>

      </div>

    </div>
  )
}

export default MySessions