import Hero from './Hero'
import About from './About'
import Services from './Services'
import Pricing from './Pricing'
import Testimonials from './Testimonials'
import Contact from './Contact'
import TextBlockSection from './TextBlockSection'
import ImageTextSection from './ImageTextSection'
import VideoBlockSection from './VideoBlockSection'
import { useLandingContent } from '../content/LandingContentContext'
import { defaultContent } from '../content/defaultContent'

// Maps a dynamic section's `type` to the component that renders it. Hero is
// NOT here — it's fixed/structural and always rendered first, outside this
// dynamic system entirely (see the render below).
const SECTION_COMPONENTS = {
  about: About,
  services: Services,
  pricing: Pricing,
  testimonials: Testimonials,
  contact: Contact,
  textBlock: TextBlockSection,
  imageText: ImageTextSection,
  videoBlock: VideoBlockSection
}

// Reads the live sectionOrder from context so reordering/adding/duplicating/
// deleting in the editor is reflected immediately, falling back to the
// static default order if content hasn't loaded yet. sectionOrder now holds
// dynamic section IDs (not fixed names) — each ID's `type` picks the
// component to render.
export default function LandingSections() {
  const { content } = useLandingContent()
  const order = (content.sectionOrder && content.sectionOrder.length)
    ? content.sectionOrder
    : defaultContent.sectionOrder

  return (
    <>
      <Hero />

      {order.map((id) => {
        const section = content.sections[id]
        if (!section) return null
        const SectionComponent = SECTION_COMPONENTS[section.type]
        return SectionComponent ? <SectionComponent key={id} sectionId={id} /> : null
      })}
    </>
  )
}
