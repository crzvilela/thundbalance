import { useState } from 'react'
import { auth } from '../firebase/auth'
import Navbar from '../components/Navbar'

function TrainingRequest() {

  const [planId, setPlanId] = useState('1')

  const [sessionsPerWeek, setSessionsPerWeek] = useState('1')

  const [preferredDays, setPreferredDays] = useState([])

  const [preferredTime, setPreferredTime] = useState('18:00')

  const handleDayChange = (day) => {

    if (preferredDays.includes(day)) {

      setPreferredDays(
        preferredDays.filter(
          d => d !== day
        )
      )

    } else {

      setPreferredDays([
        ...preferredDays,
        day
      ])

    }

  }

  const handleSubmit = async () => {

    try {

      const email = auth.currentUser.email

      const userResponse = await fetch(
        `http://127.0.0.1:8000/users/email/${email}`
      )

      const userData = await userResponse.json()

      const response = await fetch(
        'http://127.0.0.1:8000/client-requests',
        {
          method: 'POST',

          headers: {
            'Content-Type': 'application/json'
          },

          body: JSON.stringify({

            user_id: userData.id,

            plan_id: parseInt(planId),

            sessions_per_week:
              parseInt(sessionsPerWeek),

            preferred_days:
              preferredDays.join(','),

            preferred_time:
              preferredTime

          })

        }
      )

      const data = await response.json()

      console.log(data)

      alert(
        'Training request submitted successfully!'
      )

    } catch (error) {

      console.log(error)

      alert(
        'Error submitting request'
      )

    }

  }

  return (

    <div className="min-h-screen bg-black text-white">

      <Navbar />

      <div className="max-w-4xl mx-auto pt-36 px-6">

        <h1
          style={{ fontFamily: 'Bebas Neue' }}
          className="text-6xl mb-12"
        >
          Training Request
        </h1>

        <div className="border border-white/10 p-10 rounded-2xl">

          <div className="mb-8">

            <label className="block mb-2 text-gray-400">
              Select Package
            </label>

            <select
              value={planId}
              onChange={(e) =>
                setPlanId(e.target.value)
              }
              className="w-full bg-black border border-white/20 p-4"
            >
              <option value="1">
                Monthly Plan
              </option>

              <option value="2">
                Quarterly Plan
              </option>

              <option value="3">
                Semiannual Plan
              </option>

            </select>

          </div>

          <div className="mb-8">

            <label className="block mb-2 text-gray-400">
              Sessions Per Week
            </label>

            <select
              value={sessionsPerWeek}
              onChange={(e) =>
                setSessionsPerWeek(
                  e.target.value
                )
              }
              className="w-full bg-black border border-white/20 p-4"
            >
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
            </select>

          </div>

          <div className="mb-8">

            <label className="block mb-4 text-gray-400">
              Preferred Days
            </label>

            <div className="flex flex-wrap gap-4">

              {[
                'Monday',
                'Tuesday',
                'Wednesday',
                'Thursday',
                'Friday'
              ].map(day => (

                <button
                  key={day}
                  onClick={() =>
                    handleDayChange(day)
                  }
                  className={`px-4 py-2 rounded-lg border ${
                    preferredDays.includes(day)
                      ? 'bg-green-600 border-green-600'
                      : 'border-white/20'
                  }`}
                >
                  {day}
                </button>

              ))}

            </div>

          </div>

          <div className="mb-8">

            <label className="block mb-2 text-gray-400">
              Preferred Time
            </label>

            <select
              value={preferredTime}
              onChange={(e) =>
                setPreferredTime(
                  e.target.value
                )
              }
              className="w-full bg-black border border-white/20 p-4"
            >
              <option>07:00</option>
              <option>08:00</option>
              <option>09:00</option>
              <option>10:00</option>
              <option>11:00</option>
              <option>12:00</option>
              <option>13:00</option>
              <option>14:00</option>
              <option>15:00</option>
              <option>16:00</option>
              <option>17:00</option>
              <option>18:00</option>
              <option>19:00</option>
              <option>20:00</option>
              
            </select>

          </div>

          <button
            onClick={handleSubmit}
            className="bg-white text-black px-8 py-4 uppercase tracking-[3px] hover:bg-gray-300 transition duration-300"
          >
            Submit Request
          </button>

        </div>

      </div>

    </div>

  )

}

export default TrainingRequest