import { useEffect } from 'react'

function Testimonials() {
  useEffect(() => {
    if (document.querySelector('script[src*="elfsight"]')) return

    const script = document.createElement('script')
    script.src = 'https://elfsightcdn.com/platform.js'
    script.async = true
    document.body.appendChild(script)
  }, [])

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

        <div
          className="elfsight-app-ad21ff0a-7d99-486d-a394-b51a8007f2c6"
          data-elfsight-app-lazy
        ></div>

      </div>
    </section>
  )
}

export default Testimonials