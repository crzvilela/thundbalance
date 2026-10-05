import { useNavigate } from 'react-router-dom'
import {
  EditableText,
  EditableCtaButton,
  useSectionSelection,
  SectionEditOverlay
} from './editor/Editable'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'
import HeroTitleFrame from './editor/HeroTitleFrame'
import { heroTitleStyle } from '../utils/heroTitle'
import './HeroTitle.css'

// Visitors get the saved position/width through CSS variables; the editor
// uses HeroTitleFrame, which adds dragging on top of the same values.
function PublicHeroTitleFrame({ section, children }) {
  return <div data-hero-title className="hero-title-frame" style={heroTitleStyle(section.titleLayout)}>{children}</div>
}

function Hero() {
  const navigate = useNavigate()
  const { section, isEditMode, isSelected, onSectionClick, visible, theme } = useSectionSelection('hero')

  if (!visible && !isEditMode) return null

  const TitleFrame = isEditMode ? HeroTitleFrame : PublicHeroTitleFrame

  return (
    <section
      onClick={onSectionClick}
      style={sectionBackgroundStyle(section.background)}
      className={`relative isolate h-screen flex items-center justify-center text-white overflow-hidden ${!visible ? 'opacity-40' : ''}`}
    >
      <SectionEditOverlay isEditMode={isEditMode} isSelected={isSelected} hidden={!visible} label="Hero" />

      <SectionBackgroundImage
        background={section.background}
        fallbackSrc={`${import.meta.env.BASE_URL}site-images/hero.jpg`}
        imageClassName="scale-105"
      />

      <div className="absolute bottom-0 left-0 w-full h-40 bg-gradient-to-t from-black to-transparent" />

      <div className="relative z-10 text-center px-6">
        <EditableText
          as="p"
          path="sections.hero.eyebrow"
          styleObj="sections.hero.eyebrowStyle"
          label="Hero Eyebrow"
          style={{ fontFamily: theme.typography.accentFont }}
          className="uppercase tracking-[6px] text-sm text-gray-400 mb-6"
        />

        <TitleFrame section={section}>
          <EditableText
            as="h1"
            path="sections.hero.title"
            styleObj="sections.hero.titleStyle"
            label="Hero Title"
            style={{ fontFamily: theme.typography.headingFont }}
            className="text-5xl sm:text-6xl md:text-8xl font-bold uppercase leading-tight max-w-5xl mx-auto"
          />
        </TitleFrame>

        <EditableText
          as="p"
          path="sections.hero.subtitle"
          styleObj="sections.hero.subtitleStyle"
          label="Hero Subtitle"
          style={{ fontFamily: theme.typography.bodyFont }}
          className="text-gray-300 mt-8 max-w-2xl text-base md:text-lg mx-auto block"
        />

        <div className="mt-10 flex justify-center">
          <EditableCtaButton
            path="sections.hero.button"
            style={{ fontFamily: theme.typography.accentFont }}
            className="px-10 py-4 uppercase text-sm tracking-[3px] hover:scale-105 hover:tracking-[5px]"
            onNavigate={(link) => navigate(link || '/trial-session')}
          />
        </div>
      </div>
    </section>
  )
}

export default Hero
