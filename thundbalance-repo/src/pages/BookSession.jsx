import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from '../firebase/auth'
import Navbar from '../components/Navbar'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { API_URL } from '../config'

function BookSession() {

  const navigate = useNavigate()

  const [date, setDate] = useState(null)
  const [time, setTime] = useState('09:00')

  const [trainers, setTrainers] = useState([])

  const [selectedTrainer, setSelectedTrainer] = useState('')

  useEffect(() => {

    const loadAvailableTrainers = async () => {

      if (!date || !time) {
        return
      }

      try {

        const selectedDate = date

        const days = [
          'Sunday',
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday'
        ]

        const dayName =
          days[selectedDate.getDay()]

        const response = await fetch(
          `${API_URL}/available-trainers/${dayName}/${time}`
        )

        const data = await response.json()

        setTrainers(data)

        if (data.length > 0) {

          setSelectedTrainer(data[0][0])

        } else {

          setSelectedTrainer('')

        }

      } catch (error) {

        console.log(error)

      }

    }

    loadAvailableTrainers()

  }, [date, time])

  const handleBooking = async () => {

    try {

      if (!selectedTrainer) {

        alert('No trainers available for this schedule.')

        return

      }

      const email = auth.currentUser.email

      const userResponse = await fetch(
        `${API_URL}/users/email/${email}`
      )

      const userData = await userResponse.json()

      const response = await fetch(
        `${API_URL}/sessions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: userData.id,
            trainer_id: selectedTrainer,
            session_date:
              `${date.getFullYear()}-${
                String(date.getMonth() + 1).padStart(2, '0')
              }-${
                String(date.getDate()).padStart(2, '0')
              }`,
            session_time: time
          })
        }
      )

      const data = await response.json()

      console.log(data)

      alert('Session booked successfully!')

      navigate('/my-sessions')

    } catch (error) {

      console.log(error)

      alert('Error booking session')

    }

  }

  return (
    <div className="min-h-screen bg-black text-white">

      <Navbar />

      <div className="p-10 pt-36">

        <div className="max-w-4xl mx-auto">

          <h1
            style={{ fontFamily: 'Bebas Neue' }}
            className="text-6xl mb-12"
          >
            Book Session
          </h1>

          <div className="border border-white/10 p-8 rounded-2xl">

            <div className="mb-6">

              <label className="block mb-2 text-gray-400">
                Select Date
              </label>

              <DatePicker
                selected={date}
                onChange={(selectedDate) =>
                  setDate(selectedDate)
                }
                minDate={new Date()}
                dateFormat="dd/MM/yyyy"
                placeholderText="Select a date"
                className="w-full bg-black border border-white/20 p-4 text-white"
              />

            </div>

            <div className="mb-6">

              <label className="block mb-2 text-gray-400">
                Select Time
              </label>

              <select
                value={time}
                onChange={(e) => setTime(e.target.value)}
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
                <option>21:00</option>
              </select>

            </div>

            <div className="mb-8">

              <label className="block mb-2 text-gray-400">
                Available Trainers
              </label>

              <select
                value={selectedTrainer}
                onChange={(e) =>
                  setSelectedTrainer(e.target.value)
                }
                className="w-full bg-black border border-white/20 p-4"
              >

                {trainers.length === 0 ? (

                  <option>
                    No trainers available
                  </option>

                ) : (

                  trainers.map((trainer) => (

                    <option
                      key={trainer[0]}
                      value={trainer[0]}
                    >
                      {trainer[1]}
                    </option>

                  ))

                )}

              </select>

            </div>

            <button
              onClick={handleBooking}
              className="bg-white text-black px-8 py-4 uppercase tracking-[3px] hover:bg-gray-300 transition duration-300"
            >
              Confirm Booking
            </button>

          </div>

        </div>

      </div>

    </div>
  )

}

export default BookSession