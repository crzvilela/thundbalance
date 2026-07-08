import Navbar from '../components/Navbar'
import Hero from '../components/Hero'
import About from '../components/About'
import Services from '../components/Services'
import Pricing from '../components/Pricing'
import Testimonials from '../components/Testimonials'
import Contact from '../components/Contact'
import Footer from '../components/Footer'

function Home() {
  return (
    <div className="bg-black min-h-screen text-white overflow-x-hidden">

      <Navbar />

      <Hero />

      <About />

      <Services />

      <Pricing />

      <Testimonials />

      <Contact />

      <Footer />

    </div>
  )
}

export default Home

