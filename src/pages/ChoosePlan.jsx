import { useEffect, useState } from 'react'
import { auth } from '../firebase/auth'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'

function ChoosePlan() {

  const [plans, setPlans] = useState([])

  const navigate = useNavigate()

  useEffect(() => {

    const loadPlans = async () => {

      try {

        const response = await fetch(
          'http://127.0.0.1:8000/plans'
        )

        const data = await response.json()

        setPlans(data)

      } catch (error) {

        console.log(error)

      }

    }

    loadPlans()

  }, [])

  const handleSelectPlan = async (planId) => {

    try {

      const email = auth.currentUser.email

      const userResponse = await fetch(
        `http://127.0.0.1:8000/users/email/${email}`
      )

      const userData = await userResponse.json()

      await fetch(
        'http://127.0.0.1:8000/user-plan',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user_id: userData.id,
            plan_id: planId
          })
        }
      )

      alert('Plan selected successfully!')

      navigate('/profile')

    } catch (error) {

      console.log(error)

      alert('Error selecting plan')

    }

  }

  return (

    <div className="min-h-screen bg-black text-white">

      <Navbar />

      <div className="p-10 pt-36">

        <div className="max-w-6xl mx-auto">

          <h1
            style={{ fontFamily: 'Bebas Neue' }}
            className="text-6xl text-center mb-16"
          >
            Choose Your Plan
          </h1>

          <div className="grid md:grid-cols-3 gap-8">

            {plans.map((plan) => (

              <div
                key={plan[0]}
                className="border border-white/10 rounded-2xl p-10 text-center"
              >

                <h2 className="text-3xl mb-4">
                  {plan[1]}
                </h2>

                <p className="text-gray-400 mb-6">
                  {plan[2]} Months
                </p>

                <h3 className="text-5xl mb-8">
                  €{plan[3]}
                </h3>

                <button
                  onClick={() => handleSelectPlan(plan[0])}
                  className="bg-white text-black px-8 py-4 rounded-lg uppercase tracking-[3px] hover:bg-gray-300 transition duration-300"
                >
                  Select Plan
                </button>

              </div>

            ))}

          </div>

        </div>

      </div>

    </div>

  )

}

export default ChoosePlan