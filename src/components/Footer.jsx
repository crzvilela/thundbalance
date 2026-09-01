import { EditableText, EditableImage, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'
import { BLANK_IMAGE_PLACEHOLDER } from '../utils/placeholderImage'

function Footer() {
  const { section, isEditMode, isSelected, onSectionClick, visible } = useSectionSelection('footer')

  if (!visible && !isEditMode) return null

  return (
    <footer
      onClick={onSectionClick}
      style={sectionBackgroundStyle(section.background)}
      className={`relative isolate bg-black text-white py-10 px-6 border-t border-white/10 ${!visible ? 'opacity-40' : ''}`}
    >
      <SectionEditOverlay isEditMode={isEditMode} isSelected={isSelected} hidden={!visible} label="Footer" />
      <SectionBackgroundImage background={section.background} />

      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">

        <div className="flex items-center gap-3">
          {(section.logoImage || isEditMode) && (
            <EditableImage
              path="sections.footer.logoImage"
              defaultSrc={BLANK_IMAGE_PLACEHOLDER}
              alt="Logo"
              containerClassName="h-10 w-auto"
              imageClassName="h-10 w-auto object-contain"
              label="Footer Logo"
            />
          )}
          {section.showBrandText !== false && (
            <EditableText
              as="h2"
              path="sections.footer.brand"
              styleObj="sections.footer.brandStyle"
              label="Footer Brand"
              className="tracking-[4px] text-xl font-bold"
            />
          )}
        </div>

        <EditableText
          as="p"
          path="sections.footer.text"
          styleObj="sections.footer.textStyle"
          label="Footer Text"
          className="text-gray-400 text-sm"
        />

      </div>

    </footer>
  )
}

export default Footer
