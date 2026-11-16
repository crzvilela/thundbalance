import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { pingServer } from '../api/schedule'
import Navbar, { WaitingNavbar } from '../components/Navbar'
import WakeNotice from '../components/WakeNotice'
import Footer from '../components/Footer'
import LandingSections from '../components/LandingSections'
import { LandingContentProvider } from '../content/LandingContentContext'

function Home() {
  const [searchParams] = useSearchParams()
  const isPreview = searchParams.get('preview') === 'true'

  // Wakes the (sleeping) server while the visitor reads the page, so the booking form is quick.
  useEffect(() => { pingServer() }, [])

  return (
    <LandingContentProvider
      mode="view"
      version={isPreview ? 'draft' : 'published'}
      placeholder={<div className="bg-black min-h-screen"><WaitingNavbar /><WakeNotice /></div>}
    >
      <div className="bg-black min-h-screen text-white overflow-x-hidden">

        <Navbar />

        <main id="main"><LandingSections /></main>

        <Footer />

      </div>
    </LandingContentProvider>
  )
}

export default Home
