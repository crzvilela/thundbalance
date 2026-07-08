import heroImage from '../assets/images/hero.jpg'
import { useNavigate } from 'react-router-dom'

function Hero() {
  const navigate = useNavigate()
  return (
    <section className="relative h-screen flex items-center justify-center text-white overflow-hidden">

      <img
        src={heroImage}
        alt="Fitness"
        className="absolute inset-0 w-full h-full object-cover opacity-40 scale-105"
      />

     <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/60 to-black"></div>
      <div className="absolute bottom-0 left-0 w-full h-40 bg-gradient-to-t from-black to-transparent"></div>
      <div className="relative z-10 text-center px-6">

        <p className="uppercase tracking-[6px] text-sm text-gray-400 mb-6">
          Private Fitness Studio
        </p>

        <h1
          style={{ fontFamily: 'Bebas Neue' }}
          className="text-5xl sm:text-6xl md:text-8xl font-bold uppercase leading-tight max-w-5xl"
        >
          Transform Your Body And Performance
        </h1>

        <p className="text-gray-300 mt-8 max-w-2xl text-base md:text-lg mx-auto">
          Personalized 1:1 training sessions focused on performance,
          health, rehabilitation and real results.
        </p>

       <button
          onClick={() => navigate('/trial-session')}
          className="mt-10 border border-white px-10 py-4 uppercase text-sm tracking-[3px] hover:bg-white hover:text-black transition-all duration-500 hover:scale-105 hover:tracking-[5px]"
        >
          BOOK A TRIAL SESSION
        </button>

      </div>

    </section>
  )
}

export default Hero