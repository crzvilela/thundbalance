import { EditableText, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'

function Pricing({ sectionId }) {
  const { section, isEditMode, isSelected, onSectionClick, visible, theme } = useSectionSelection(sectionId, 'Pricing')

  if (!visible && !isEditMode) return null

  const plans = section.plans && section.plans.length ? section.plans : []

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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

          {plans.map((plan, index) => {
            const highlighted = !!plan.highlighted

            return (
              <div
                key={index}
                className={`p-10 hover:-translate-y-2 transition duration-500 ${
                  highlighted
                    ? 'border border-black bg-black text-white'
                    : 'border border-black/10'
                }`}
              >
                <EditableText
                  as="h3"
                  path={`sections.${sectionId}.plans.${index}.name`}
                  styleObj={`sections.${sectionId}.plans.${index}.nameStyle`}
                  label={`Plan ${index + 1} Name`}
                  style={{ fontFamily: theme.typography.headingFont }}
                  className="text-3xl mb-4 uppercase block"
                />

                <div className="text-5xl font-bold mb-6">
                  <EditableText
                    as="span"
                    path={`sections.${sectionId}.plans.${index}.price`}
                    styleObj={`sections.${sectionId}.plans.${index}.priceStyle`}
                    label={`Plan ${index + 1} Price`}
                  />
                  <EditableText
                    as="span"
                    path={`sections.${sectionId}.plans.${index}.period`}
                    styleObj={`sections.${sectionId}.plans.${index}.periodStyle`}
                    label={`Plan ${index + 1} Period`}
                    className="text-xl ml-1"
                  />
                </div>

                <EditableText
                  as="p"
                  path={`sections.${sectionId}.plans.${index}.description`}
                  styleObj={`sections.${sectionId}.plans.${index}.descriptionStyle`}
                  label={`Plan ${index + 1} Description`}
                  style={{ fontFamily: theme.typography.bodyFont }}
                  className={`leading-7 mb-8 block ${highlighted ? 'text-gray-300' : 'text-gray-600'}`}
                />

                <ul className={`space-y-3 mb-8 ${highlighted ? 'text-gray-300' : 'text-gray-700'}`}>
                  {(plan.features || []).map((_feature, featureIndex) => (
                    <li key={featureIndex} className="flex gap-2">
                      <span aria-hidden="true">{'\u2713'}</span>
                      <EditableText
                        as="span"
                        path={`sections.${sectionId}.plans.${index}.features.${featureIndex}`}
                        label={`Plan ${index + 1} Feature ${featureIndex + 1}`}
                        style={{ fontFamily: theme.typography.bodyFont }}
                      />
                    </li>
                  ))}
                </ul>

                <EditableText
                  as="button"
                  path={`sections.${sectionId}.plans.${index}.buttonText`}
                  styleObj={`sections.${sectionId}.plans.${index}.buttonTextStyle`}
                  label={`Plan ${index + 1} Button`}
                  style={{ fontFamily: theme.typography.accentFont }}
                  className={`border px-6 py-3 uppercase text-sm tracking-[3px] transition duration-300 ${
                    highlighted
                      ? 'border-white hover:bg-white hover:text-black'
                      : 'border-black hover:bg-black hover:text-white'
                  }`}
                />
              </div>
            )
          })}

        </div>

      </div>

    </section>
  )
}

export default Pricing
