import service1 from '../assets/images/service1.jpg'
import service2 from '../assets/images/service2.jpg'
import service3 from '../assets/images/service3.jpg'

function Services() {
  return (
    <section id="services" className="bg-black text-white py-40 px-6">

      <div className="max-w-7xl mx-auto">

        <div className="mb-20">

          <p className="uppercase tracking-[5px] text-sm text-gray-400 mb-6">
            Services
          </p>

          <h2
            style={{ fontFamily: 'Bebas Neue' }}
            className="text-5xl md:text-7xl"
          >
            Personalized Training Experience
          </h2>

        </div>

        <div className="grid md:grid-cols-3 gap-8">

          <div className="border border-white/10 overflow-hidden hover:border-white hover:-translate-y-2 hover:bg-white/5 transition duration-500">

            <img
              src={service1}
              alt=""
              className="w-full h-72 object-cover hover:scale-110 transition duration-700"
            />

            <div className="p-10">

              <h3 className="text-2xl mb-6 uppercase tracking-wide">
                1:1 Training
              </h3>

              <p className="text-gray-400 leading-7">
                Individual sessions fully focused on your goals,
                performance and physical condition.
              </p>

            </div>

          </div>

          <div className="border border-white/10 overflow-hidden hover:border-white hover:-translate-y-2 hover:bg-white/5 transition duration-500">

            <img
              src={service2}
              alt=""
              className="w-full h-72 object-cover hover:scale-110 transition duration-700"
            />

            <div className="p-10">

              <h3 className="text-2xl mb-6 uppercase tracking-wide">
                Dual Sessions
              </h3>

              <p className="text-gray-400 leading-7">
                Train together with a partner while maintaining
                personalized coaching and guidance.
              </p>

            </div>

          </div>

          <div className="border border-white/10 overflow-hidden hover:border-white hover:-translate-y-2 hover:bg-white/5 transition duration-500">

            <img
              src={service3}
              alt=""
              className="w-full h-72 object-cover hover:scale-110 transition duration-700"
            />

            <div className="p-10">

              <h3 className="text-2xl mb-6 uppercase tracking-wide">
                Nutrition & Metrics
              </h3>

              <p className="text-gray-400 leading-7">
                Training plans, nutritional guidance and body metrics
                tracking included in every program.
              </p>

            </div>

          </div>

        </div>

      </div>

    </section>
  )
}

export default Services