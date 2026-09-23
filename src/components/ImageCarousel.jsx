import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { resolveImageUrl } from '../api/landingPage'
import { useI18n } from '../i18n/I18nContext'
import { resolveText } from '../utils/multilingual'

// Lightweight, dependency-free photo carousel built on framer-motion (no
// react-slick/swiper/etc — the project already has framer-motion).
// One photo at a time (works well for both mobile and desktop and keeps
// captions simple — no partial neighbor photos to complicate layout),
// arrows on desktop, drag-to-swipe (`drag="x"`) for mobile/touch, and
// clickable dot indicators. Reusable anywhere the site needs a simple
// photo carousel — not tied to the About Us page.
//
// items: [{ image, caption }]
function ImageCarousel({ items = [] }) {
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(0)
  const { language } = useI18n()

  if (!items.length) return null

  const goTo = (newIndex, dir) => {
    const wrapped = (newIndex + items.length) % items.length
    setDirection(dir)
    setIndex(wrapped)
  }

  const handleDragEnd = (e, info) => {
    const threshold = 80
    if (info.offset.x < -threshold) goTo(index + 1, 1)
    else if (info.offset.x > threshold) goTo(index - 1, -1)
  }

  const current = items[index]
  const currentCaption = resolveText(current.caption, language)

  return (
    <div className="w-full">
      <div className="relative w-full aspect-[16/10] sm:aspect-[16/9] overflow-hidden rounded-xl bg-[#111]">
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.img
            key={index}
            src={resolveImageUrl(current.image)}
            alt={currentCaption || ''}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.6}
            onDragEnd={handleDragEnd}
            initial={{ opacity: 0, x: direction >= 0 ? 60 : -60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction >= 0 ? -60 : 60 }}
            transition={{ duration: 0.35 }}
            className="absolute inset-0 w-full h-full object-cover cursor-grab active:cursor-grabbing"
          />
        </AnimatePresence>

        {items.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => goTo(index - 1, -1)}
              aria-label="Previous photo"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 transition text-white text-xl"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => goTo(index + 1, 1)}
              aria-label="Next photo"
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 transition text-white text-xl"
            >
              ›
            </button>
          </>
        )}
      </div>

      {currentCaption && (
        <p className="text-center text-gray-400 text-sm mt-4">{currentCaption}</p>
      )}

      {items.length > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i, i > index ? 1 : -1)}
              aria-label={`Go to photo ${i + 1}`}
              className={`w-2.5 h-2.5 rounded-full transition ${i === index ? 'bg-white' : 'bg-white/25 hover:bg-white/50'}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default ImageCarousel
