import { EditableText, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'
import MovableBox from './editor/MovableBox'
import { useState } from 'react'
import { useI18n } from '../i18n/I18nContext'
import SegmentedType from './forms/SegmentedType'
import { textOf, visibleEntries } from '../utils/landingCards'

function Pricing({ sectionId }) {
  const { section, isEditMode, isSelected, onSectionClick, visible, theme } = useSectionSelection(sectionId, 'Pricing')
  const { t, language } = useI18n()
  const [sessionType, setSessionType] = useState('individual')

  if (!visible && !isEditMode) return null

  // The cards are written by hand in the landing editor (section.cards). Nothing here reads the catalogue of packs: changing or
  // deleting a pack in Admin > Packs never changes this page. The button has no destination, as before.
  const entries = visibleEntries(section, sessionType)
  const base = `sections.${sectionId}.cards`

  return (
    <section
      id={sectionId}
      onClick={onSectionClick}
      style={sectionBackgroundStyle(section.background)}
      className={`relative isolate bg-white text-black py-20 md:py-40 px-6 ${!visible ? 'opacity-40' : ''}`}
    >
      <SectionEditOverlay isEditMode={isEditMode} isSelected={isSelected} hidden={!visible} label="Pricing" />
      <SectionBackgroundImage background={section.background} />

      <div className="max-w-7xl mx-auto">

        <div className="mb-12 md:mb-20 text-center">
          <EditableText
            as="p"
            path={`sections.${sectionId}.eyebrow`}
            styleObj={`sections.${sectionId}.eyebrowStyle`}
            label="Pricing Eyebrow"
            style={{ fontFamily: theme.typography.accentFont }}
            className="uppercase tracking-[5px] text-sm text-gray-500 mb-6"
          />

          <EditableText
            as="h2"
            path={`sections.${sectionId}.title`}
            styleObj={`sections.${sectionId}.titleStyle`}
            label="Pricing Title"
            style={{ fontFamily: theme.typography.headingFont }}
            className="text-4xl sm:text-5xl md:text-7xl"
          />
        </div>

        <div className="mb-10 flex justify-center">
          <SegmentedType
            value={sessionType} onChange={setSessionType}
            labels={{ legend: t('st_prices_for'), individual: t('st_individual'), dual: t('st_dual') }}
            tone="light" className="text-center [&_legend]:mx-auto"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

          {entries.map(({ card, index }) => {
            const highlighted = !!card.highlighted
            const muted = highlighted ? 'text-gray-400' : 'text-gray-500'
            const has = (field) => textOf(card[field], language) !== ''
            const benefits = Array.isArray(card.benefits) ? card.benefits : []
            const features = Array.isArray(card.features) ? card.features : []
            const path = `${base}.${index}`

            return (
              <MovableBox key={card.id || index} path={`${path}.card`} label={`Pack ${index + 1} Card`} className="h-full">
              <div
                className={`h-full p-10 hover:-translate-y-2 transition duration-500 ${
                  highlighted
                    ? 'border border-black bg-black text-white'
                    : 'border border-black/10'
                }`}
              >
                {has('tag') && (
                  <EditableText
                    as="p"
                    path={`${path}.tag`}
                    label={`Pack ${index + 1} Tag`}
                    className={`mb-3 text-xs uppercase tracking-[3px] ${muted}`}
                  />
                )}

                {has('name') && (
                  <EditableText
                    as="h3"
                    path={`${path}.name`}
                    styleObj={`${path}.nameStyle`}
                    label={`Pack ${index + 1} Name`}
                    style={{ fontFamily: theme.typography.headingFont }}
                    className="text-3xl mb-1 uppercase block"
                  />
                )}

                {has('duration') && (
                  <EditableText as="p" path={`${path}.duration`} label={`Pack ${index + 1} Duration`} className={`mb-4 text-sm ${muted}`} />
                )}

                {has('objective') && (
                  <EditableText
                    as="p"
                    path={`${path}.objective`}
                    label={`Pack ${index + 1} Goal`}
                    className={`mb-4 text-sm leading-6 ${highlighted ? 'text-gray-300' : 'text-gray-600'}`}
                  />
                )}

                {benefits.length > 0 && (
                  <div className="mb-4">
                    <p className={`text-xs uppercase tracking-wider ${muted}`}>{t('pk_includes')}</p>
                    <ul className={`mt-1 space-y-1 text-sm ${highlighted ? 'text-gray-300' : 'text-gray-700'}`}>
                      {benefits.map((_benefit, benefitIndex) => (
                        <li key={benefitIndex} className="flex gap-2">
                          <span aria-hidden="true">{'✓'}</span>
                          <EditableText as="span" path={`${path}.benefits.${benefitIndex}`} label={`Pack ${index + 1} Benefit ${benefitIndex + 1}`} className="break-words" />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(has('price') || has('period')) && (
                  <div className="mb-6">
                    <div className="text-5xl font-bold">
                      {has('price') && <EditableText as="span" path={`${path}.price`} label={`Pack ${index + 1} Price`} />}
                      {has('period') && (
                        <EditableText
                          as="span"
                          path={`${path}.period`}
                          styleObj={`${path}.periodStyle`}
                          label={`Pack ${index + 1} Price note`}
                          className="text-xl ml-1"
                        />
                      )}
                    </div>
                    {has('totalSessions') && (
                      <EditableText as="p" path={`${path}.totalSessions`} label={`Pack ${index + 1} Total sessions`} className={`mt-1 text-sm ${muted}`} />
                    )}
                  </div>
                )}

                {!(has('price') || has('period')) && has('totalSessions') && (
                  <EditableText as="p" path={`${path}.totalSessions`} label={`Pack ${index + 1} Total sessions`} className={`mb-6 text-sm ${muted}`} />
                )}

                {has('description') && (
                  <EditableText
                    as="p"
                    path={`${path}.description`}
                    styleObj={`${path}.descriptionStyle`}
                    label={`Pack ${index + 1} Description`}
                    style={{ fontFamily: theme.typography.bodyFont }}
                    className={`leading-7 mb-8 block ${highlighted ? 'text-gray-300' : 'text-gray-600'}`}
                  />
                )}

                {features.length > 0 && (
                  <ul className={`space-y-3 mb-8 ${highlighted ? 'text-gray-300' : 'text-gray-700'}`}>
                    {features.map((_feature, featureIndex) => (
                      <li key={featureIndex} className="flex gap-2">
                        <span aria-hidden="true">{'✓'}</span>
                        <EditableText
                          as="span"
                          path={`${path}.features.${featureIndex}`}
                          label={`Pack ${index + 1} Feature ${featureIndex + 1}`}
                          style={{ fontFamily: theme.typography.bodyFont }}
                        />
                      </li>
                    ))}
                  </ul>
                )}

                {has('buttonText') && (
                  <EditableText
                    as="button"
                    path={`${path}.buttonText`}
                    styleObj={`${path}.buttonTextStyle`}
                    label={`Pack ${index + 1} Button`}
                    style={{ fontFamily: theme.typography.accentFont }}
                    className={`border px-6 py-3 uppercase text-sm tracking-[3px] transition duration-300 ${
                      highlighted
                        ? 'border-white hover:bg-white hover:text-black'
                        : 'border-black hover:bg-black hover:text-white'
                    }`}
                  />
                )}
              </div>
              </MovableBox>
            )
          })}

        </div>

      </div>

    </section>
  )
}

export default Pricing
