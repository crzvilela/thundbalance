function Pricing() {
  return (
    <section id="pricing" className="bg-white text-black py-40 px-6">

      <div className="max-w-7xl mx-auto">

        <div className="mb-20 text-center">

          <p className="uppercase tracking-[5px] text-sm text-gray-500 mb-6">
            Pricing
          </p>

          <h2
            style={{ fontFamily: 'Bebas Neue' }}
            className="text-5xl md:text-7xl"
          >
            Training Packages
          </h2>

        </div>

        <div className="grid md:grid-cols-3 gap-8">

          <div className="border border-black/10 p-10 hover:-translate-y-2 transition duration-500">

            <h3 className="text-3xl mb-4 uppercase">
              Monthly Plan
            </h3>

            <p className="text-5xl font-bold mb-6">
              €65<span className="text-xl ml-1">/session</span>
            </p>

            <p className="text-gray-600 leading-7 mb-8">
              Includes 1 to 5 training sessions per week with full coaching support.
            </p>

            <ul className="space-y-3 text-gray-700 mb-8">
              <li>✓ 1-5 sessions per week</li>
              <li>✓ Personal Training</li>
              <li>✓ Flexible Scheduling</li>
            </ul>

            <button className="border border-black px-6 py-3 uppercase text-sm tracking-[3px] hover:bg-black hover:text-white transition duration-300">
              Get Started
            </button>

          </div>

          <div className="border border-black p-10 bg-black text-white hover:-translate-y-2 transition duration-500">

            <h3 className="text-3xl mb-4 uppercase">
              Quarterly Plan
            </h3>

           <p className="text-5xl font-bold mb-6">
              €60<span className="text-xl ml-1">/session</span>
            </p>

            <p className="text-gray-300 leading-7 mb-8">
              Designed for long-term progress with training and nutrition follow-up.
            </p>

            <ul className="space-y-3 text-gray-300 mb-8">
              <li>✓ 1-5 sessions per week</li>
              <li>✓ 1 Body Metrics Assessment</li>
              <li>✓ 3 Training Plan Reviews</li>
              <li>✓ 3 Nutrition Plan Reviews</li>
            </ul>

            <button className="border border-white px-6 py-3 uppercase text-sm tracking-[3px] hover:bg-white hover:text-black transition duration-300">
              Most Popular
            </button>

          </div>

          <div className="border border-black/10 p-10 hover:-translate-y-2 transition duration-500">

            <h3 className="text-3xl mb-4 uppercase">
              Semiannual Plan
            </h3>

            <p className="text-5xl font-bold mb-6">
              €55<span className="text-xl ml-1">/session</span>
            </p>

            <p className="text-gray-600 leading-7 mb-8">
              The most complete package for maximum results and continuous monitoring.
            </p>

            <ul className="space-y-3 text-gray-700 mb-8">
              <li>✓ 1-5 sessions per week</li>
              <li>✓ 2 Body Metrics Assessments</li>
              <li>✓ 6 Training Plan Reviews</li>
              <li>✓ 6 Nutrition Plan Reviews</li>
              <li>✓ 1 Personal Consultation</li>
            </ul>

            <button className="border border-black px-6 py-3 uppercase text-sm tracking-[3px] hover:bg-black hover:text-white transition duration-300">
              Best Value
            </button>

          </div>

        </div>

      </div>

    </section>
  )
}

export default Pricing