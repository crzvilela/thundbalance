import { useSearchParams } from 'react-router-dom'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import LandingSections from '../components/LandingSections'
import { LandingContentProvider } from '../content/LandingContentContext'

function Home() {
  const [searchParams] = useSearchParams()
  const isPreview = searchParams.get('preview') === 'true'

  return (
    <LandingContentProvider mode="view" version={isPreview ? 'draft' : 'published'}>
      <div className="bg-black min-h-screen text-white overflow-x-hidden">

        <Navbar />

        <LandingSections />

        <Footer />

      </div>
    </LandingContentProvider>
  )
}

export default Home
