import { motion } from 'framer-motion'

function About() {
  return (
    <motion.section
      id="about"
      initial={{ opacity: 0, y: 100 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 1 }}
      viewport={{ once: true }}
      className="bg-white text-black py-40 px-6"
    >

      <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-16 items-center">

        <div>
          <p className="uppercase tracking-[5px] text-sm text-gray-500 mb-6">
            About Us
          </p>

          <h2
            style={{ fontFamily: 'Bebas Neue' }}
            className="text-5xl md:text-7xl leading-none mb-8"
          >
            Private Training Focused On Real Results
          </h2>
        </div>

        <div>
          <p className="text-lg leading-8 text-gray-700">
            ThundBalance is a private fitness studio focused on personalized
            1:1 and dual training sessions. Every client receives individual
            support, training plans, nutritional guidance and body metrics
            monitoring in an exclusive and professional environment.
          </p>
        </div>

      </div>

    </motion.section>
  )
}

export default About