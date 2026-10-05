import Navbar from '../Navbar'
import Footer from '../Footer'
import LandingSections from '../LandingSections'
import { useLandingContent } from '../../content/LandingContentContext'

const DEVICE_WIDTHS = {
  desktop: '100%',
  tablet: '834px',
  mobile: '390px'
}

export default function EditorCanvas() {
  const { device, select, loading } = useLandingContent()

  return (
    <div
      className="flex-1 overflow-y-auto overflow-x-auto bg-[#050505] py-10 px-6"
      onClick={() => select(null)}
    >
      {loading ? (
        <div className="flex items-center justify-center h-full text-gray-500 text-sm">
          Loading landing page…
        </div>
      ) : (
        <div
          className="mx-auto bg-black shadow-2xl shadow-black/50 relative transition-[width] duration-300"
          style={{ width: DEVICE_WIDTHS[device], minHeight: '100%' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative">
            <Navbar />
            <LandingSections />
            <Footer />
          </div>
        </div>
      )}
    </div>
  )
}
