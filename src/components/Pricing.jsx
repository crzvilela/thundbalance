import { EditableText, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'
import MovableBox from './editor/MovableBox'
import { useState } from 'react'
import { useI18n } from '../i18n/I18nContext'
import SegmentedType from './forms/SegmentedType'
import { TIERS, hasContent, textOf, tierOf } from '../utils/landingPrices'

function Pricing({ sectionId }) {
  const { section, isEditMode, isSelected, onSectionClick, visible, theme } = useSectionSelection(sectionId, 'Pricing')
  const { t, language } = useI18n()
  const [sessionType, setSessionType] = useState('individual')

  if (!visible && !isEditMode) return null

  // The same page for everybody (visitor, client, admin): the content is the published landing, read without a token. Two boxes,
  // Individual and Dual, each with its own three prices (Monthly, Quarterly, Semiannual) and features, written by hand in the
  // landing editor (section.prices). The description, button and highlight of each plan are the section's three text cards
  // (section.plans), the same for both boxes. Nothing here reads the catalogue of packs.
  const plans = Array.isArray(section.plans) ? section.plans : []
  const empty = !hasContent(section, language)

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

        {empty && <p className="mb-10 text-center text-gray-500">{t('pr_empty')}</p>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

          {TIERS.map((tierName, index) => {
            const plan = plans[index] && typeof plans[index] === 'object' ? plans[index] : {}
            const tier = tierOf(section, sessionType, index)
            const highlighted = !!plan.highlighted
            const features = Array.isArray(tier.features) ? tier.features : []
            const pricePath = `sections.${sectionId}.prices.${sessionType}.${index}`
            const planPath = `sections.${sectionId}.plans.${index}`

            return (
              <MovableBox key={`${sessionType}-${tierName}`} path={`${planPath}.card`} label={`Plan ${index + 1} Card`} className="h-full">
              <div
                className={`h-full p-10 hover:-translate-y-2 transition duration-500 ${
                  highlighted
                    ? 'border border-black bg-black text-white'
                    : 'border border-black/10'
                }`}
              >
                <h3 style={{ fontFamily: theme.typography.headingFont }} className="text-3xl mb-4 uppercase block">{t(`pr_${tierName}`)}</h3>

                <div className="mb-6 text-5xl font-bold">
                  {textOf(tier.price, language) !== ''
                    ? <EditableText as="span" path={`${pricePath}.price`} label={`${tierName} price`} />
                    : <span>—</span>}
                </div>

                <EditableText
                  as="p"
                  path={`${planPath}.description`}
                  styleObj={`${planPath}.descriptionStyle`}
                  label={`Plan ${index + 1} Description`}
                  style={{ fontFamily: theme.typography.bodyFont }}
                  className={`leading-7 mb-8 block ${highlighted ? 'text-gray-300' : 'text-gray-600'}`}
                />

                {features.length > 0 && (
                  <ul className={`space-y-3 mb-8 ${highlighted ? 'text-gray-300' : 'text-gray-700'}`}>
                    {features.map((_feature, featureIndex) => (
                      <li key={featureIndex} className="flex gap-2">
                        <span aria-hidden="true">{'✓'}</span>
                        <EditableText
                          as="span"
                          path={`${pricePath}.features.${featureIndex}`}
                          label={`${tierName} feature ${featureIndex + 1}`}
                          style={{ fontFamily: theme.typography.bodyFont }}
                        />
                      </li>
                    ))}
                  </ul>
                )}

                <EditableText
                  as="button"
                  path={`${planPath}.buttonText`}
                  styleObj={`${planPath}.buttonTextStyle`}
                  label={`Plan ${index + 1} Button`}
                  style={{ fontFamily: theme.typography.accentFont }}
                  className={`border px-6 py-3 uppercase text-sm tracking-[3px] transition duration-300 ${
                    highlighted
                      ? 'border-white hover:bg-white hover:text-black'
                      : 'border-black hover:bg-black hover:text-white'
                  }`}
                />
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
