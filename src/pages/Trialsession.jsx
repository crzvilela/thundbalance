import { useState } from 'react'
import Navbar from '../components/Navbar'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'

function TrialSession() {

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [age, setAge] = useState('')
  const [goal, setGoal] = useState('')
  const [experience, setExperience] = useState('')
  const [date, setDate] = useState(null)
  const [time, setTime] = useState('09:00')

  const handleSubmit = async () => {

    try {

      if (
        !fullName ||
        !email ||
        !phone ||
        !goal ||
        !experience ||
        !date
      ) {

        alert('Please complete all required fields.')

        return

      }

      const response = await fetch(
        'http://127.0.0.1:8000/trial-sessions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({

            full_name: fullName,

            email: email,

            phone: phone,

            age: parseInt(age),

            goal: goal,

            experience: experience,

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

      alert('Trial Session Requested Successfully!')

      setFullName('')
      setEmail('')
      setPhone('')
      setAge('')
      setGoal('')
      setExperience('')
      setDate(null)
      setTime('09:00')

    } catch (error) {

      console.log(error)

      alert('Error sending request')

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
          Book a Trial Session
        </h1>

        <div className="border border-white/10 p-10 rounded-2xl">

          <div className="grid md:grid-cols-2 gap-6">

            <input
              type="text"
              placeholder="Full Name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="bg-black border border-white/20 p-4"
            />

            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-black border border-white/20 p-4"
            />

            <input
              type="text"
              placeholder="Phone Number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="bg-black border border-white/20 p-4"
            />

            <input
              type="number"
              placeholder="Age"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className="bg-black border border-white/20 p-4"
            />

          </div>

          <div className="mt-6">

            <label className="block mb-2 text-gray-400">
              Training Goal
            </label>

            <select
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="w-full bg-black border border-white/20 p-4"
            >
              <option value="">Select Goal</option>
              <option>Weight Loss</option>
              <option>Muscle Gain</option>
              <option>Performance</option>
              <option>General Fitness</option>
            </select>

          </div>

          <div className="mt-6">

            <label className="block mb-2 text-gray-400">
              Training Experience
            </label>

            <select
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              className="w-full bg-black border border-white/20 p-4"
            >
              <option value="">Select Experience</option>
              <option>Beginner</option>
              <option>Intermediate</option>
              <option>Advanced</option>
            </select>

          </div>

          <div className="mt-6">

            <label className="block mb-2 text-gray-400">
              Preferred Date
            </label>

            <DatePicker
              selected={date}
              onChange={(selectedDate) =>
                setDate(selectedDate)
              }
              minDate={new Date()}
              dateFormat="dd/MM/yyyy"
              className="w-full bg-black border border-white/20 p-4 text-white"
            />

          </div>

          <div className="mt-6">

            <label className="block mb-2 text-gray-400">
              Preferred Time
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

          <button
            onClick={handleSubmit}
            className="mt-10 bg-white text-black px-8 py-4 uppercase tracking-[3px] hover:bg-gray-300 transition duration-300"
          >
            Request Trial Session
          </button>

        </div>

      </div>

    </div>
  )
}

export default TrialSession