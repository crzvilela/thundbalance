import { useEffect, useState } from 'react'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import TrainingVideoCard from '../components/TrainingVideoCard'
import { LandingContentProvider } from '../content/LandingContentContext'
import { useI18n } from '../i18n/I18nContext'
import { fetchTrainingVideos } from '../api/trainingVideos'

function TrainingTips() {
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const { t } = useI18n()

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const data = await fetchTrainingVideos()
        if (!cancelled) setVideos(data)
      } catch (err) {
        console.error('Failed to load training videos:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()

    return () => { cancelled = true }
  }, [])

  return (
    // Navbar/Footer read brand/logo/background from here — same provider
    // Home.jsx uses, so this page stays visually in sync with whatever the
    // admin has configured in the Landing Page Editor.
    <LandingContentProvider mode="view" version="published">
      <div className="bg-black min-h-screen text-white overflow-x-hidden">

        <Navbar />

        <section className="relative pt-32 pb-20 md:pt-48 md:pb-40 px-6">
          <div className="max-w-7xl mx-auto">

            <div className="mb-12 md:mb-20 text-center">
              <p className="uppercase tracking-[5px] text-sm text-gray-400 mb-6">
                {t('training_tips_eyebrow')}
              </p>

              <h1
                style={{ fontFamily: 'Bebas Neue' }}
                className="text-4xl sm:text-5xl md:text-7xl"
              >
                {t('training_tips_title')}
              </h1>
            </div>

            {loading ? (
              <p className="text-center text-gray-400">{t('training_tips_loading')}</p>
            ) : videos.length === 0 ? (
              <p className="text-center text-gray-400">{t('training_tips_empty')}</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
                {videos.map((video) => (
                  <TrainingVideoCard key={video.id} video={video} />
                ))}
              </div>
            )}

          </div>
        </section>

        <Footer />

      </div>
    </LandingContentProvider>
  )
}

export default TrainingTips
