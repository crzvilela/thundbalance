function Testimonials() {
  return (
    <section id="testimonials" className="bg-black text-white py-40 px-6">

      <div className="max-w-7xl mx-auto">

        <div className="mb-20 text-center">

          <p className="uppercase tracking-[5px] text-sm text-gray-400 mb-6">
            Testimonials
          </p>

          <h2
            style={{ fontFamily: 'Bebas Neue' }}
            className="text-5xl md:text-7xl"
          >
            Real Experiences
          </h2>

        </div>

        <div className="grid md:grid-cols-3 gap-8">

          <div className="border border-white/10 p-10 hover:bg-white/5 transition duration-500">

            <p className="text-gray-300 leading-8 mb-8">
              “The best personal training experience I’ve had in Barcelona.
              Professional, motivating and fully personalized.”
            </p>

            <h3 className="uppercase tracking-[3px]">
              — Michael, 34
            </h3>

          </div>

          <div className="border border-white/10 p-10 hover:bg-white/5 transition duration-500">

            <p className="text-gray-300 leading-8 mb-8">
              “I improved my mobility, strength and overall health in just a few months.
              Amazing environment and coaching.”
            </p>

            <h3 className="uppercase tracking-[3px]">
              — Sarah, 38
            </h3>

          </div>

          <div className="border border-white/10 p-10 hover:bg-white/5 transition duration-500">

            <p className="text-gray-300 leading-8 mb-8">
              “Private sessions, real attention and excellent trainers.
              Completely different from a traditional gym.”
            </p>

            <h3 className="uppercase tracking-[3px]">
              — Daniel, 41
            </h3>

          </div>

        </div>

      </div>

    </section>
  )
}

export default Testimonials