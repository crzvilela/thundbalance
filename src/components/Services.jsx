import service1 from '../assets/images/service1.jpg'
import service2 from '../assets/images/service2.jpg'
import service3 from '../assets/images/service3.jpg'
import { EditableText, EditableImage, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'

const DEFAULT_IMAGES = [service1, service2, service3]

function Services({ sectionId }) {
  const { section, isEditMode, isSelected, onSectionClick, visible } = useSectionSelection(sectionId, 'Services')

  if (!visible && !isEditMode) return null

  const items = section.items && section.items.length ? section.items : []

  return (
    <section
      id={sectionId}
      onClick={onSectionClick}
      style={sectionBackgroundStyle(section.background)}
      className={`relative isolate bg-black text-white py-20 md:py-40 px-6 ${!visible ? 'opacity-40' : ''}`}
    >
      <SectionEditOverlay isEditMode={isEditMode} isSelected={isSelected} hidden={!visible} label="Services" />
      <SectionBackgroundImage background={section.background} />

      <div className="max-w-7xl mx-auto">

        <div className="mb-12 md:mb-20">
          <EditableText
            as="p"
            path={`sections.${sectionId}.eyebrow`}
            styleObj={`sections.${sectionId}.eyebrowStyle`}
            label="Services Eyebrow"
            className="uppercase tracking-[5px] text-sm text-gray-400 mb-6"
          />

          <EditableText
            as="h2"
            path={`sections.${sectionId}.title`}
            styleObj={`sections.${sectionId}.titleStyle`}
            label="Services Title"
            style={{ fontFamily: 'Bebas Neue' }}
            className="text-4xl sm:text-5xl md:text-7xl"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

          {items.map((item, index) => (
            <div
              key={index}
              className="border border-white/10 overflow-hidden hover:border-white hover:-translate-y-2 hover:bg-white/5 transition duration-500"
            >
              <EditableImage
                path={`sections.${sectionId}.items.${index}.image`}
                styleObj={`sections.${sectionId}.items.${index}.imageStyle`}
                defaultSrc={DEFAULT_IMAGES[index] || service1}
                alt=""
                containerClassName="w-full h-72 overflow-hidden"
                imageClassName="w-full h-72 object-cover hover:scale-110 transition duration-700"
                label={`Service ${index + 1} Image`}
              />

              <div className="p-10">
                <EditableText
                  as="h3"
                  path={`sections.${sectionId}.items.${index}.title`}
                  styleObj={`sections.${sectionId}.items.${index}.titleStyle`}
                  label={`Service ${index + 1} Title`}
                  className="text-2xl mb-6 uppercase tracking-wide block"
                />

                <EditableText
                  as="p"
                  path={`sections.${sectionId}.items.${index}.description`}
                  styleObj={`sections.${sectionId}.items.${index}.descriptionStyle`}
                  label={`Service ${index + 1} Description`}
                  className="text-gray-400 leading-7 block"
                />
              </div>
            </div>
          ))}

        </div>

      </div>

    </section>
  )
}

export default Services
