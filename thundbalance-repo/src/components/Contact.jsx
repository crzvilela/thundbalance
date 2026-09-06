function Contact() {
  return (
    <section id="contact" className="bg-white text-black py-40 px-6">

      <div className="max-w-4xl mx-auto text-center">

        <p className="uppercase tracking-[5px] text-sm text-gray-500 mb-6">
          Contact
        </p>

        <h2
          style={{ fontFamily: 'Bebas Neue' }}
          className="text-5xl md:text-7xl mb-8"
        >
          Start Your Transformation
        </h2>

        <p className="text-gray-600 text-lg mb-16">
          Book your first session and discover a personalized
          training experience focused on real results.
        </p>

        <form className="flex flex-col gap-6">

          <input
            type="text"
            placeholder="Your Name"
            className="border border-black/20 px-6 py-4 outline-none"
          />

          <input
            type="email"
            placeholder="Your Email"
            className="border border-black/20 px-6 py-4 outline-none"
          />

          <textarea
            placeholder="Your Message"
            rows="6"
            className="border border-black/20 px-6 py-4 outline-none resize-none"
          ></textarea>

          <button
            className="mt-10 border border-white px-10 py-4 uppercase text-sm tracking-[3px] hover:bg-white hover:text-black transition-all duration-500 hover:scale-105 hover:tracking-[5px]"
          >
            Send Message
          </button>

        </form>

      </div>

    </section>
  )
}

export default Contact