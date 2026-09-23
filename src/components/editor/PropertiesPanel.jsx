import { useRef, useState } from 'react'
import { useLandingContent } from '../../content/LandingContentContext'
import { getPath } from '../../utils/objectPath'
import { resolveText, setTextForLanguage } from '../../utils/multilingual'
import { useI18n } from '../../i18n/I18nContext'
import { resolveImageUrl, uploadLandingImage, uploadLandingVideo } from '../../api/landingPage'
import { isKnownEmbedProvider } from '../../utils/videoEmbed'
import { SECTION_LABELS, SECTION_TYPE_INFO, makeDefaultServiceItem, makeDefaultPricingPlan, makeDefaultTestimonialMedia } from '../../content/defaultContent'
import ConfirmDialog from './ConfirmDialog'
import {
  FieldGroup,
  TextField,
  TextAreaField,
  NumberField,
  ColorField,
  SelectField,
  SliderField,
  ToggleField,
  ButtonRow,
  SmallButton
} from './fields'

const FONT_WEIGHT_OPTIONS = [
  { value: '', label: 'Default' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semibold' },
  { value: '700', label: 'Bold' },
  { value: '800', label: 'Extra Bold' }
]

const TEXT_ALIGN_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' }
]

const POSITION_OPTIONS = [
  { value: 'center', label: 'Center' },
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' }
]

const IMAGE_SIDE_OPTIONS = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' }
]

const BACKGROUND_TYPE_OPTIONS = [
  { value: 'color', label: 'Solid Color' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' }
]

const VIDEO_TEXT_POSITION_OPTIONS = [
  { value: 'above', label: 'Above Video' },
  { value: 'below', label: 'Below Video' }
]

const FONT_OPTIONS = [
  { value: 'Bebas Neue', label: 'Bebas Neue' },
  { value: 'Inter', label: 'Inter' },
  { value: 'Roboto', label: 'Roboto' },
  { value: 'Aldrich', label: 'Aldrich' }
]

export default function PropertiesPanel() {
  const { content, selection, select } = useLandingContent()

  return (
    <aside className="w-[340px] shrink-0 bg-[#0b0b0b] border-l border-white/10 overflow-y-auto">
      <div className="p-5">
        {!selection && <ThemePanel content={content} />}
        {selection?.type === 'section' && (
          <SectionPanel key={selection.path} sectionKey={selection.path} onClose={() => select(null)} />
        )}
        {selection?.type === 'text' && (
          <TextPanel key={selection.path} selection={selection} onClose={() => select(null)} />
        )}
        {selection?.type === 'image' && (
          <ImagePanel key={selection.path} selection={selection} onClose={() => select(null)} />
        )}
        {selection?.type === 'video' && (
          <VideoPanel key={selection.path} selection={selection} onClose={() => select(null)} />
        )}
        {selection?.type === 'testimonialMedia' && (
          <TestimonialMediaPanel key={selection.path} selection={selection} onClose={() => select(null)} />
        )}
        {selection?.type === 'button' && (
          <ButtonPanel key={selection.path} selection={selection} onClose={() => select(null)} />
        )}
      </div>
    </aside>
  )
}

function PanelHeader({ title, onClose, subtitle }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-white text-xs uppercase tracking-wider"
        >
          Close
        </button>
      )}
    </div>
  )
}

// --- Global theme -----------------------------------------------------------

function ThemePanel({ content }) {
  const { updateField } = useLandingContent()
  const colors = content.theme.colors
  const typography = content.theme.typography

  return (
    <div>
      <PanelHeader title="Global Styles" subtitle="Click any element in the preview to edit it directly." />

      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4">Colors</p>
      <ColorField label="Primary" value={colors.primary} onChange={(v) => updateField('theme.colors.primary', v)} />
      <ColorField label="Secondary" value={colors.secondary} onChange={(v) => updateField('theme.colors.secondary', v)} />
      <ColorField label="Background" value={colors.background} onChange={(v) => updateField('theme.colors.background', v)} />
      <ColorField label="Text" value={colors.text} onChange={(v) => updateField('theme.colors.text', v)} />
      <ColorField label="Accent" value={colors.accent} onChange={(v) => updateField('theme.colors.accent', v)} />
      <ColorField label="Button Background" value={colors.buttonBg} onChange={(v) => updateField('theme.colors.buttonBg', v)} />
      <ColorField label="Button Text" value={colors.buttonText} onChange={(v) => updateField('theme.colors.buttonText', v)} />
      <ColorField label="Border" value={colors.border} onChange={(v) => updateField('theme.colors.border', v)} />

      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-8">Typography</p>
      <SelectField
        label="Heading Font"
        value={typography.headingFont}
        options={FONT_OPTIONS}
        onChange={(v) => updateField('theme.typography.headingFont', v)}
      />
      <SelectField
        label="Body Font"
        value={typography.bodyFont}
        options={FONT_OPTIONS}
        onChange={(v) => updateField('theme.typography.bodyFont', v)}
      />
      <SelectField
        label="Accent Font (buttons, labels)"
        value={typography.accentFont}
        options={FONT_OPTIONS}
        onChange={(v) => updateField('theme.typography.accentFont', v)}
      />
      <TextField label="Button Font Size" value={typography.buttonSize} onChange={(v) => updateField('theme.typography.buttonSize', v)} />

      <p className="text-[11px] text-gray-500 mt-6">
        Theme colors are saved with the page, ready to be applied consistently across elements that reference them.
      </p>
    </div>
  )
}

// --- Section-level panel -----------------------------------------------------

function SectionPanel({ sectionKey, onClose }) {
  const { content, updateField } = useLandingContent()
  const section = content.sections[sectionKey] || {}
  const order = content.sectionOrder || []
  const isDynamic = order.includes(sectionKey)
  const label = SECTION_LABELS[sectionKey] || SECTION_TYPE_INFO[section.type]?.label || sectionKey

  const orderIndex = order.indexOf(sectionKey)

  const moveSection = (direction) => {
    if (!isDynamic) return
    const newOrder = [...order]
    const targetIndex = orderIndex + direction
    if (targetIndex < 0 || targetIndex >= newOrder.length) return
    ;[newOrder[orderIndex], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[orderIndex]]
    updateField('sectionOrder', newOrder)
  }

  return (
    <div>
      <PanelHeader title={label} subtitle="Section settings" onClose={onClose} />

      <ToggleField
        label="Visible on page"
        value={section.visible !== false}
        onChange={(v) => updateField(`sections.${sectionKey}.visible`, v)}
      />

      {isDynamic && (
        <FieldGroup label="Order">
          <ButtonRow>
            <SmallButton onClick={() => moveSection(-1)} disabled={orderIndex <= 0}>
              Move Up
            </SmallButton>
            <SmallButton onClick={() => moveSection(1)} disabled={orderIndex === order.length - 1}>
              Move Down
            </SmallButton>
          </ButtonRow>
        </FieldGroup>
      )}

      {section.background !== undefined && (
        <SectionBackgroundFields
          sectionKey={sectionKey}
          background={section.background}
          updateField={updateField}
        />
      )}

      {section.type === 'about' && <AboutTextFields sectionKey={sectionKey} section={section} updateField={updateField} />}
      {section.type === 'contact' && <ContactImageFields sectionKey={sectionKey} section={section} updateField={updateField} />}
      {section.type === 'services' && <ServicesSectionFields sectionKey={sectionKey} content={content} updateField={updateField} />}
      {section.type === 'pricing' && <PricingSectionFields sectionKey={sectionKey} content={content} updateField={updateField} />}
      {section.type === 'testimonials' && <TestimonialsMediaFields sectionKey={sectionKey} content={content} updateField={updateField} />}
      {section.type === 'imageText' && <ImageTextSectionFields sectionKey={sectionKey} section={section} updateField={updateField} />}
      {section.type === 'videoBlock' && <VideoBlockSectionFields sectionKey={sectionKey} section={section} updateField={updateField} />}
      {sectionKey === 'navbar' && <NavbarFields section={section} updateField={updateField} />}
      {sectionKey === 'footer' && <FooterFields section={section} updateField={updateField} />}

      <p className="text-[11px] text-gray-500 mt-6">
        Tip: click directly on the title, text, image or button in the preview to edit that element's content and style.
      </p>
    </div>
  )
}

// --- Section background (shared by every section) ---------------------------

function SectionBackgroundFields({ sectionKey, background, updateField }) {
  const bg = background || {}
  const path = `sections.${sectionKey}.background`
  const bgType = bg.type || (bg.image ? 'image' : 'color')
  const [uploading, setUploading] = useState(false)
  const [pendingImage, setPendingImage] = useState(null)
  const inputRef = useRef(null)

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadLandingImage(file)
      setPendingImage(url)
    } catch (err) {
      console.error(err)
      alert('Could not upload image. Please try a smaller file.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const confirmPendingImage = () => {
    if (!pendingImage) return
    updateField(`${path}.image`, pendingImage)
    setPendingImage(null)
  }

  const cancelPendingImage = () => setPendingImage(null)

  return (
    <>
      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">Background</p>

      <SelectField
        label="Background Type"
        value={bgType}
        options={BACKGROUND_TYPE_OPTIONS}
        onChange={(v) => updateField(`${path}.type`, v)}
      />

      {bgType === 'color' && (
        <ColorField
          label="Background Color"
          value={bg.color || ''}
          onChange={(v) => updateField(`${path}.color`, v)}
        />
      )}

      {bgType === 'image' && (
        <>
          {resolveImageUrl(bg.image) && !pendingImage && (
            <img
              src={resolveImageUrl(bg.image)}
              alt="Section background"
              className="w-full h-24 object-cover rounded-lg mb-3 border border-white/10"
            />
          )}

          {pendingImage && (
            <>
              <img
                src={resolveImageUrl(pendingImage)}
                alt="New background preview"
                className="w-full h-24 object-cover rounded-lg mb-2 border border-emerald-500"
              />
              <p className="text-[11px] text-emerald-400 mb-3">Uploaded — click "Use as Background" below to apply it.</p>
            </>
          )}

          <ButtonRow>
            <SmallButton onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : pendingImage ? 'Upload Different Image' : 'Upload Image'}
            </SmallButton>
            {bg.image && !pendingImage && (
              <SmallButton variant="danger" onClick={() => updateField(`${path}.image`, null)}>
                Remove
              </SmallButton>
            )}
          </ButtonRow>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />

          {pendingImage && (
            <ButtonRow>
              <SmallButton variant="primary" onClick={confirmPendingImage}>Use as Background</SmallButton>
              <SmallButton onClick={cancelPendingImage}>Cancel</SmallButton>
            </ButtonRow>
          )}

          <SelectField
            label="Image Position"
            value={bg.position || 'center'}
            options={POSITION_OPTIONS}
            onChange={(v) => updateField(`${path}.position`, v)}
          />
        </>
      )}

      {bgType === 'video' && (
        <VideoFields path={`${path}.video`} video={bg.video} updateField={updateField} />
      )}

      {(bgType === 'image' || bgType === 'video') && (
        <>
          <ColorField
            label="Overlay Color"
            value={bg.overlayColor || '#000000'}
            onChange={(v) => updateField(`${path}.overlayColor`, v)}
          />

          <SliderField
            label="Overlay Opacity"
            value={bg.overlayOpacity ?? 0}
            onChange={(v) => updateField(`${path}.overlayOpacity`, v)}
          />
        </>
      )}
    </>
  )
}

// Shared video source/settings fields, reused by section backgrounds,
// ImageTextSection's video media, and VideoBlockSection. `path` points at
// the video object itself (e.g. "sections.xyz.background.video" or
// "sections.xyz.video").
function VideoFields({ path, video, updateField }) {
  const v = video || {}
  const isEmbed = v.sourceType === 'embed'
  const [uploading, setUploading] = useState(false)
  const [pendingUpload, setPendingUpload] = useState(null)
  const inputRef = useRef(null)

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadLandingVideo(file)
      setPendingUpload(url)
    } catch (err) {
      console.error(err)
      alert('Could not upload video. Please try a smaller file.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const confirmPendingUpload = () => {
    if (!pendingUpload) return
    updateField(`${path}.sourceType`, 'upload')
    updateField(`${path}.url`, pendingUpload)
    setPendingUpload(null)
  }

  const cancelPendingUpload = () => setPendingUpload(null)

  const showEmbedWarning = isEmbed && v.url && !isKnownEmbedProvider(v.url)

  return (
    <>
      <FieldGroup label="Video Source">
        <ButtonRow>
          <SmallButton variant={!isEmbed ? 'primary' : 'default'} onClick={() => updateField(`${path}.sourceType`, 'upload')}>
            Upload
          </SmallButton>
          <SmallButton variant={isEmbed ? 'primary' : 'default'} onClick={() => updateField(`${path}.sourceType`, 'embed')}>
            Embed URL
          </SmallButton>
        </ButtonRow>
      </FieldGroup>

      {!isEmbed ? (
        <>
          <ButtonRow>
            <SmallButton onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : pendingUpload ? 'Upload Different Video' : v.url ? 'Replace Video' : 'Upload Video'}
            </SmallButton>
            {v.url && !pendingUpload && (
              <SmallButton variant="danger" onClick={() => updateField(`${path}.url`, '')}>
                Remove
              </SmallButton>
            )}
          </ButtonRow>
          <input ref={inputRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={handleUpload} />

          {pendingUpload && (
            <>
              <p className="text-[11px] text-emerald-400 mb-2">Uploaded — click "Use This Video" below to apply it.</p>
              <ButtonRow>
                <SmallButton variant="primary" onClick={confirmPendingUpload}>Use This Video</SmallButton>
                <SmallButton onClick={cancelPendingUpload}>Cancel</SmallButton>
              </ButtonRow>
            </>
          )}
        </>
      ) : (
        <>
          <TextField
            label="YouTube or Vimeo link"
            value={v.url}
            onChange={(val) => updateField(`${path}.url`, val)}
            placeholder="https://www.youtube.com/watch?v=..."
          />
          {showEmbedWarning && (
            <p className="text-[11px] text-yellow-500 mb-4">
              Embed support is best with YouTube or Vimeo links.
            </p>
          )}
        </>
      )}

      <ToggleField label="Autoplay" value={v.autoplay !== false} onChange={(val) => updateField(`${path}.autoplay`, val)} />
      <ToggleField label="Loop" value={v.loop !== false} onChange={(val) => updateField(`${path}.loop`, val)} />
      <ToggleField label="Muted" value={v.muted !== false} onChange={(val) => updateField(`${path}.muted`, val)} />
    </>
  )
}

function AboutTextFields({ sectionKey, section, updateField }) {
  const { language, setLanguage, supportedLanguages } = useI18n()
  const carousel = section.carousel || []

  const [uploading, setUploading] = useState(false)
  const [deleteIndex, setDeleteIndex] = useState(null)
  const inputRef = useRef(null)

  const carouselPath = `sections.${sectionKey}.carousel`

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadLandingImage(file)
      updateField(carouselPath, [...carousel, { image: url, caption: '' }])
    } catch (err) {
      console.error(err)
      alert('Could not upload image. Please try a smaller file.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const removePhoto = (index) => {
    updateField(carouselPath, carousel.filter((_, i) => i !== index))
    setDeleteIndex(null)
  }

  const movePhoto = (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= carousel.length) return
    const next = [...carousel]
    ;[next[index], next[target]] = [next[target], next[index]]
    updateField(carouselPath, next)
  }

  const updateCaption = (index, caption) => {
    const next = carousel.map((item, i) => (i === index ? { ...item, caption: setTextForLanguage(item.caption, language, caption) } : item))
    updateField(carouselPath, next)
  }

  return (
    <>
      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">Text</p>
      <ColorField
        label="Text Color"
        value={section.textColor || '#000000'}
        onChange={(v) => updateField(`sections.${sectionKey}.textColor`, v)}
      />
      <OptionalImageField
        path={`sections.${sectionKey}.image`}
        image={section.image}
        updateField={updateField}
        label="Content Image (optional)"
      />

      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">360° View</p>
      <FieldGroup
        label="360° embed URL"
        hint='In Google Maps: open the 360° photo → Share or embed image → Embed a map → copy the src="..." URL and paste it here. Leave empty to hide this block.'
      >
        <textarea
          value={section.embed360Url ?? ''}
          rows={2}
          onChange={(e) => updateField(`sections.${sectionKey}.embed360Url`, e.target.value)}
          className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 transition resize-none"
        />
      </FieldGroup>

      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">Photo Carousel</p>

      <FieldGroup label="Editing Language" hint="Applies to the photo captions below.">
        <ButtonRow>
          {supportedLanguages.map((lang) => (
            <SmallButton key={lang} variant={language === lang ? 'primary' : 'default'} onClick={() => setLanguage(lang)}>
              {lang.toUpperCase()}
            </SmallButton>
          ))}
        </ButtonRow>
      </FieldGroup>

      <p className="text-[11px] text-gray-500 mb-3">
        Carousel Photos ({carousel.length})
      </p>

      {carousel.map((item, index) => (
        <div key={index} className="border border-white/10 rounded-lg px-3 py-2 mb-2">
          <div className="flex items-center gap-3 mb-2">
            {resolveImageUrl(item.image) && (
              <img src={resolveImageUrl(item.image)} alt="" className="w-12 h-12 rounded object-cover shrink-0" />
            )}
            <input
              type="text"
              value={resolveText(item.caption, language)}
              placeholder={`Caption (${language.toUpperCase()}, optional)`}
              onChange={(e) => updateCaption(index, e.target.value)}
              className="flex-1 min-w-0 bg-[#111] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-500 transition"
            />
            <button
              onClick={() => setDeleteIndex(index)}
              className="text-red-400 text-xs uppercase tracking-wider hover:text-red-300 shrink-0"
            >
              Remove
            </button>
          </div>
          <ButtonRow>
            <SmallButton onClick={() => movePhoto(index, -1)} disabled={index === 0}>Move Up</SmallButton>
            <SmallButton onClick={() => movePhoto(index, 1)} disabled={index === carousel.length - 1}>Move Down</SmallButton>
          </ButtonRow>
        </div>
      ))}

      <ButtonRow>
        <SmallButton onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? 'Uploading…' : '+ Add Photo'}
        </SmallButton>
      </ButtonRow>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />

      <ConfirmDialog
        open={deleteIndex !== null}
        title="Remove this photo?"
        description="This cannot be undone with the undo button once saved."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => removePhoto(deleteIndex)}
        onCancel={() => setDeleteIndex(null)}
      />
    </>
  )
}

function ImageTextSectionFields({ sectionKey, section, updateField }) {
  const isVideo = section.mediaType === 'video'

  return (
    <>
      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">Layout</p>
      <SelectField
        label="Image Position"
        value={section.imagePosition || 'left'}
        options={IMAGE_SIDE_OPTIONS}
        onChange={(v) => updateField(`sections.${sectionKey}.imagePosition`, v)}
      />

      <FieldGroup label="Media Type">
        <ButtonRow>
          <SmallButton variant={!isVideo ? 'primary' : 'default'} onClick={() => updateField(`sections.${sectionKey}.mediaType`, 'image')}>
            Image
          </SmallButton>
          <SmallButton variant={isVideo ? 'primary' : 'default'} onClick={() => updateField(`sections.${sectionKey}.mediaType`, 'video')}>
            Video
          </SmallButton>
        </ButtonRow>
      </FieldGroup>

      {isVideo && (
        <VideoFields path={`sections.${sectionKey}.video`} video={section.video} updateField={updateField} />
      )}
    </>
  )
}

function VideoBlockSectionFields({ sectionKey, section, updateField }) {
  return (
    <>
      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">Layout</p>
      <SelectField
        label="Text Position"
        value={section.textPosition || 'above'}
        options={VIDEO_TEXT_POSITION_OPTIONS}
        onChange={(v) => updateField(`sections.${sectionKey}.textPosition`, v)}
      />

      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">Video</p>
      <VideoFields path={`sections.${sectionKey}.video`} video={section.video} updateField={updateField} />
    </>
  )
}

// Shared upload control for an optional content image (About/Contact) that
// doesn't have its own click-to-select canvas slot until it's actually set
// — the admin adds it here first, then it becomes a normal EditableImage.
function OptionalImageField({ path, image, updateField, label = 'Content Image' }) {
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadLandingImage(file)
      updateField(path, url)
    } catch (err) {
      console.error(err)
      alert('Could not upload image. Please try a smaller file.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">{label}</p>

      {resolveImageUrl(image) && (
        <img
          src={resolveImageUrl(image)}
          alt=""
          className="w-full h-24 object-cover rounded-lg mb-3 border border-white/10"
        />
      )}

      <ButtonRow>
        <SmallButton onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? 'Uploading…' : image ? 'Replace Image' : 'Add Image'}
        </SmallButton>
        {image && (
          <SmallButton variant="danger" onClick={() => updateField(path, null)}>
            Remove
          </SmallButton>
        )}
      </ButtonRow>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
    </>
  )
}

function ContactImageFields({ sectionKey, section, updateField }) {
  return (
    <OptionalImageField
      path={`sections.${sectionKey}.image`}
      image={section.image}
      updateField={updateField}
      label="Content Image (optional)"
    />
  )
}

function NavbarFields({ section, updateField }) {
  return (
    <>
      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">Brand</p>
      <p className="text-[11px] text-gray-500 mb-3">Click the logo/brand in the preview to set a logo image.</p>
      <ToggleField
        label="Show brand text"
        value={section.showBrandText !== false}
        onChange={(v) => updateField('sections.navbar.showBrandText', v)}
      />
    </>
  )
}

function FooterFields({ section, updateField }) {
  const address = section.address || {}
  const { language, setLanguage, supportedLanguages } = useI18n()

  return (
    <>
      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">Brand</p>
      <p className="text-[11px] text-gray-500 mb-3">Click the logo/brand in the preview to set a logo image.</p>
      <ToggleField
        label="Show brand text"
        value={section.showBrandText !== false}
        onChange={(v) => updateField('sections.footer.showBrandText', v)}
      />

      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">Address</p>

      <FieldGroup label="Editing Language" hint="Applies to the address text below (the map link is the same in every language).">
        <ButtonRow>
          {supportedLanguages.map((lang) => (
            <SmallButton key={lang} variant={language === lang ? 'primary' : 'default'} onClick={() => setLanguage(lang)}>
              {lang.toUpperCase()}
            </SmallButton>
          ))}
        </ButtonRow>
      </FieldGroup>

      <TextField
        label={`Address text (${language.toUpperCase()})`}
        value={resolveText(address.text, language)}
        onChange={(v) => updateField('sections.footer.address.text', setTextForLanguage(address.text, language, v))}
      />
      <TextField
        label="Google Maps link (address click-through)"
        value={address.mapsLink}
        onChange={(v) => updateField('sections.footer.address.mapsLink', v)}
      />

      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">Map &amp; 360°</p>
      <FieldGroup
        label="Map embed URL"
        hint='In Google Maps: Share → Embed a map → copy the src="..." URL from the <iframe> code and paste it here.'
      >
        <textarea
          value={section.mapEmbedUrl ?? ''}
          rows={2}
          onChange={(e) => updateField('sections.footer.mapEmbedUrl', e.target.value)}
          className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 transition resize-none"
        />
      </FieldGroup>
      <FieldGroup
        label="360° / Street View embed URL"
        hint='In Google Maps: open the 360° photo you want → Share or embed image → Embed a map → copy the src="..." URL and paste it here. Leave empty to hide this block.'
      >
        <textarea
          value={section.streetView360EmbedUrl ?? ''}
          rows={2}
          onChange={(e) => updateField('sections.footer.streetView360EmbedUrl', e.target.value)}
          className="w-full bg-[#111] border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 transition resize-none"
        />
      </FieldGroup>

      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">Contact Links</p>
      <TextField
        label="Contact us URL"
        value={section.contactUsUrl}
        onChange={(v) => updateField('sections.footer.contactUsUrl', v)}
      />
      <TextField
        label="Join us (mailto link)"
        value={section.joinUsEmail}
        onChange={(v) => updateField('sections.footer.joinUsEmail', v)}
      />
      <TextField
        label="Contact email"
        value={section.contactEmail}
        onChange={(v) => updateField('sections.footer.contactEmail', v)}
      />
      <TextField
        label="WhatsApp number (display text)"
        value={section.whatsappNumber}
        onChange={(v) => updateField('sections.footer.whatsappNumber', v)}
      />
      <TextField
        label="WhatsApp link (wa.me/...)"
        value={section.whatsappLink}
        onChange={(v) => updateField('sections.footer.whatsappLink', v)}
      />
      <TextField
        label="Instagram URL"
        value={section.instagramUrl}
        onChange={(v) => updateField('sections.footer.instagramUrl', v)}
      />
    </>
  )
}

function ServicesSectionFields({ sectionKey, content, updateField }) {
  const { language } = useI18n()
  const items = content.sections[sectionKey]?.items || []
  const path = `sections.${sectionKey}.items`

  const addItem = () => {
    updateField(path, [...items, makeDefaultServiceItem()])
  }

  const removeItem = (index) => {
    updateField(path, items.filter((_, i) => i !== index))
  }

  const moveItem = (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    updateField(path, next)
  }

  return (
    <>
      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">
        Service Cards ({items.length})
      </p>

      {items.map((item, index) => (
        <div key={index} className="border border-white/10 rounded-lg px-3 py-2 mb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm truncate">{resolveText(item.title, language) || `Item ${index + 1}`}</span>
            <button
              onClick={() => removeItem(index)}
              className="text-red-400 text-xs uppercase tracking-wider hover:text-red-300"
            >
              Remove
            </button>
          </div>
          <ButtonRow>
            <SmallButton onClick={() => moveItem(index, -1)} disabled={index === 0}>Move Up</SmallButton>
            <SmallButton onClick={() => moveItem(index, 1)} disabled={index === items.length - 1}>Move Down</SmallButton>
          </ButtonRow>
        </div>
      ))}

      <SmallButton variant="primary" onClick={addItem}>+ Add Service Card</SmallButton>
    </>
  )
}

function PricingSectionFields({ sectionKey, content, updateField }) {
  const { language } = useI18n()
  const plans = content.sections[sectionKey]?.plans || []
  const path = `sections.${sectionKey}.plans`

  const addPlan = () => {
    updateField(path, [...plans, makeDefaultPricingPlan()])
  }

  const removePlan = (index) => {
    updateField(path, plans.filter((_, i) => i !== index))
  }

  const movePlan = (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= plans.length) return
    const next = [...plans]
    ;[next[index], next[target]] = [next[target], next[index]]
    updateField(path, next)
  }

  const toggleHighlight = (index) => {
    const newPlans = plans.map((p, i) => (i === index ? { ...p, highlighted: !p.highlighted } : p))
    updateField(path, newPlans)
  }

  const addFeature = (index) => {
    const plan = plans[index]
    const newFeatures = [...(plan.features || []), { en: 'New feature', es: 'Nueva característica', ca: 'Nova característica' }]
    const newPlans = plans.map((p, i) => (i === index ? { ...p, features: newFeatures } : p))
    updateField(path, newPlans)
  }

  const removeFeature = (planIndex, featureIndex) => {
    const plan = plans[planIndex]
    const newFeatures = (plan.features || []).filter((_, i) => i !== featureIndex)
    const newPlans = plans.map((p, i) => (i === planIndex ? { ...p, features: newFeatures } : p))
    updateField(path, newPlans)
  }

  return (
    <>
      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">
        Pricing Plans ({plans.length})
      </p>

      {plans.map((plan, index) => (
        <div key={index} className="border border-white/10 rounded-lg px-3 py-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium truncate">{resolveText(plan.name, language) || `Plan ${index + 1}`}</span>
            <button
              onClick={() => removePlan(index)}
              className="text-red-400 text-xs uppercase tracking-wider hover:text-red-300"
            >
              Remove
            </button>
          </div>

          <ButtonRow>
            <SmallButton onClick={() => movePlan(index, -1)} disabled={index === 0}>Move Up</SmallButton>
            <SmallButton onClick={() => movePlan(index, 1)} disabled={index === plans.length - 1}>Move Down</SmallButton>
          </ButtonRow>

          <ToggleField
            label="Highlighted plan"
            value={!!plan.highlighted}
            onChange={() => toggleHighlight(index)}
          />

          <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Features</p>
          {(plan.features || []).map((feature, featureIndex) => (
            <div key={featureIndex} className="flex items-center justify-between text-xs text-gray-300 mb-1">
              <span className="truncate">• {resolveText(feature, language)}</span>
              <button
                onClick={() => removeFeature(index, featureIndex)}
                className="text-red-400 hover:text-red-300 ml-2"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() => addFeature(index)}
            className="text-emerald-400 text-xs uppercase tracking-wider hover:text-emerald-300 mt-1"
          >
            + Add feature
          </button>
        </div>
      ))}

      <SmallButton variant="primary" onClick={addPlan}>+ Add Pricing Plan</SmallButton>
    </>
  )
}

function TestimonialsMediaFields({ sectionKey, content, updateField }) {
  const { language } = useI18n()
  const media = content.sections[sectionKey]?.media || []
  const path = `sections.${sectionKey}.media`

  const [adding, setAdding] = useState(false)
  const [draftType, setDraftType] = useState('image')
  const [draftVideoSourceType, setDraftVideoSourceType] = useState('upload')
  const [draftUrl, setDraftUrl] = useState('')
  const [draftClientName, setDraftClientName] = useState('')
  const [draftCaption, setDraftCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const [deleteIndex, setDeleteIndex] = useState(null)
  const inputRef = useRef(null)

  const resetDraft = () => {
    setAdding(false)
    setDraftType('image')
    setDraftVideoSourceType('upload')
    setDraftUrl('')
    setDraftClientName('')
    setDraftCaption('')
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = draftType === 'video' ? await uploadLandingVideo(file) : await uploadLandingImage(file)
      setDraftUrl(url)
    } catch (err) {
      console.error(err)
      alert('Could not upload file. Please try a smaller one.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const confirmAdd = () => {
    if (!draftUrl.trim()) {
      alert('Please add an image, upload a video, or paste a video link first.')
      return
    }

    const videoSourceType = draftType === 'video'
      ? (draftVideoSourceType === 'upload' ? 'upload' : (/vimeo\.com/i.test(draftUrl) ? 'vimeo' : 'youtube'))
      : ''

    const newItem = {
      ...makeDefaultTestimonialMedia(draftType),
      url: draftUrl,
      videoSourceType,
      clientName: draftClientName,
      caption: draftCaption
    }

    updateField(path, [...media, newItem])
    resetDraft()
  }

  const removeItem = (index) => {
    updateField(path, media.filter((_, i) => i !== index))
    setDeleteIndex(null)
  }

  const moveItem = (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= media.length) return
    const next = [...media]
    ;[next[index], next[target]] = [next[target], next[index]]
    updateField(path, next)
  }

  return (
    <>
      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">
        Testimonial Media ({media.length})
      </p>

      {media.map((item, index) => (
        <div key={index} className="flex items-center gap-3 border border-white/10 rounded-lg px-3 py-2 mb-2">
          <div className="w-12 h-12 rounded bg-[#111] overflow-hidden shrink-0 flex items-center justify-center text-gray-500">
            {item.type === 'image' ? (
              resolveImageUrl(item.url) && <img src={resolveImageUrl(item.url)} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-lg">▶</span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{resolveText(item.clientName, language) || `Item ${index + 1}`}</p>
            {resolveText(item.caption, language) && <p className="text-xs text-gray-500 truncate">{resolveText(item.caption, language)}</p>}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <SmallButton onClick={() => moveItem(index, -1)} disabled={index === 0}>Up</SmallButton>
            <SmallButton onClick={() => moveItem(index, 1)} disabled={index === media.length - 1}>Down</SmallButton>
          </div>

          <button
            onClick={() => setDeleteIndex(index)}
            className="text-red-400 text-xs uppercase tracking-wider hover:text-red-300 shrink-0"
          >
            Remove
          </button>
        </div>
      ))}

      {adding ? (
        <div className="border border-white/10 rounded-lg p-3 mb-3">
          <FieldGroup label="Media Type">
            <ButtonRow>
              <SmallButton variant={draftType === 'image' ? 'primary' : 'default'} onClick={() => { setDraftType('image'); setDraftUrl('') }}>
                Image
              </SmallButton>
              <SmallButton variant={draftType === 'video' ? 'primary' : 'default'} onClick={() => { setDraftType('video'); setDraftUrl('') }}>
                Video
              </SmallButton>
            </ButtonRow>
          </FieldGroup>

          {draftType === 'image' ? (
            <>
              {draftUrl && (
                <img src={resolveImageUrl(draftUrl)} alt="" className="w-full h-24 object-cover rounded-lg mb-2 border border-white/10" />
              )}
              <ButtonRow>
                <SmallButton onClick={() => inputRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading…' : draftUrl ? 'Replace Image' : 'Upload Image'}
                </SmallButton>
              </ButtonRow>
              <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            </>
          ) : (
            <>
              <FieldGroup label="Video Source">
                <ButtonRow>
                  <SmallButton variant={draftVideoSourceType === 'upload' ? 'primary' : 'default'} onClick={() => { setDraftVideoSourceType('upload'); setDraftUrl('') }}>
                    Upload
                  </SmallButton>
                  <SmallButton variant={draftVideoSourceType !== 'upload' ? 'primary' : 'default'} onClick={() => { setDraftVideoSourceType('link'); setDraftUrl('') }}>
                    YouTube/Vimeo Link
                  </SmallButton>
                </ButtonRow>
              </FieldGroup>

              {draftVideoSourceType === 'upload' ? (
                <>
                  <ButtonRow>
                    <SmallButton onClick={() => inputRef.current?.click()} disabled={uploading}>
                      {uploading ? 'Uploading…' : draftUrl ? 'Replace Video' : 'Upload Video'}
                    </SmallButton>
                  </ButtonRow>
                  <input ref={inputRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={handleUpload} />
                  {draftUrl && <p className="text-[11px] text-emerald-400 mb-3">Video uploaded.</p>}
                </>
              ) : (
                <TextField
                  label="YouTube or Vimeo link"
                  value={draftUrl}
                  onChange={setDraftUrl}
                  placeholder="https://www.youtube.com/watch?v=..."
                />
              )}
            </>
          )}

          <TextField label="Client Name (optional)" value={draftClientName} onChange={setDraftClientName} placeholder="e.g. Maria S." />
          <TextField label="Caption (optional)" value={draftCaption} onChange={setDraftCaption} placeholder="e.g. Lost 8kg in 3 months" />

          <ButtonRow>
            <SmallButton variant="primary" onClick={confirmAdd}>Add</SmallButton>
            <SmallButton onClick={resetDraft}>Cancel</SmallButton>
          </ButtonRow>
        </div>
      ) : (
        <SmallButton variant="primary" onClick={() => setAdding(true)}>+ Add Testimonial Media</SmallButton>
      )}

      <ConfirmDialog
        open={deleteIndex !== null}
        title="Remove this testimonial media?"
        description="This cannot be undone with the undo button once saved."
        confirmLabel="Remove"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => removeItem(deleteIndex)}
        onCancel={() => setDeleteIndex(null)}
      />
    </>
  )
}

// --- Text panel ---------------------------------------------------------------

function TextPanel({ selection, onClose }) {
  const { content, updateField } = useLandingContent()
  const { language, setLanguage, supportedLanguages } = useI18n()
  const raw = getPath(content, selection.path, '')
  const value = resolveText(raw, language)
  const styleObj = selection.styleObj ? getPath(content, selection.styleObj, {}) : null

  return (
    <div>
      <PanelHeader title={selection.label || 'Text'} subtitle="Text content" onClose={onClose} />

      <FieldGroup label="Editing Language" hint="This also switches the preview — you're editing exactly what visitors see in that language.">
        <ButtonRow>
          {supportedLanguages.map((lang) => (
            <SmallButton key={lang} variant={language === lang ? 'primary' : 'default'} onClick={() => setLanguage(lang)}>
              {lang.toUpperCase()}
            </SmallButton>
          ))}
        </ButtonRow>
      </FieldGroup>

      <TextAreaField
        label={`Content (${language.toUpperCase()})`}
        value={value}
        onChange={(v) => updateField(selection.path, setTextForLanguage(raw, language, v))}
      />

      {styleObj && Object.keys(styleObj).length > 0 && (
        <>
          <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">Style</p>

          {'fontSize' in styleObj && (
            <TextField
              label="Font Size (e.g. 4rem, 48px)"
              value={styleObj.fontSize}
              onChange={(v) => updateField(`${selection.styleObj}.fontSize`, v)}
            />
          )}

          {'color' in styleObj && (
            <ColorField
              label="Color"
              value={styleObj.color || '#ffffff'}
              onChange={(v) => updateField(`${selection.styleObj}.color`, v)}
            />
          )}

          {'fontWeight' in styleObj && (
            <SelectField
              label="Font Weight"
              value={styleObj.fontWeight}
              options={FONT_WEIGHT_OPTIONS}
              onChange={(v) => updateField(`${selection.styleObj}.fontWeight`, v)}
            />
          )}

          {'letterSpacing' in styleObj && (
            <TextField
              label="Letter Spacing (e.g. 2px)"
              value={styleObj.letterSpacing}
              onChange={(v) => updateField(`${selection.styleObj}.letterSpacing`, v)}
            />
          )}

          {'lineHeight' in styleObj && (
            <TextField
              label="Line Height (e.g. 1.2)"
              value={styleObj.lineHeight}
              onChange={(v) => updateField(`${selection.styleObj}.lineHeight`, v)}
            />
          )}

          {'textAlign' in styleObj && (
            <SelectField
              label="Text Align"
              value={styleObj.textAlign}
              options={TEXT_ALIGN_OPTIONS}
              onChange={(v) => updateField(`${selection.styleObj}.textAlign`, v)}
            />
          )}

          {(('marginTop' in styleObj) || ('marginBottom' in styleObj) || ('marginLeft' in styleObj) || ('marginRight' in styleObj) || ('padding' in styleObj)) && (
            <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">Position &amp; Spacing</p>
          )}

          {'marginTop' in styleObj && (
            <NumberField
              label="Margin Top"
              value={styleObj.marginTop}
              onChange={(v) => updateField(`${selection.styleObj}.marginTop`, v)}
            />
          )}

          {'marginBottom' in styleObj && (
            <NumberField
              label="Margin Bottom"
              value={styleObj.marginBottom}
              onChange={(v) => updateField(`${selection.styleObj}.marginBottom`, v)}
            />
          )}

          {'marginLeft' in styleObj && (
            <NumberField
              label="Margin Left"
              value={styleObj.marginLeft}
              onChange={(v) => updateField(`${selection.styleObj}.marginLeft`, v)}
            />
          )}

          {'marginRight' in styleObj && (
            <NumberField
              label="Margin Right"
              value={styleObj.marginRight}
              onChange={(v) => updateField(`${selection.styleObj}.marginRight`, v)}
            />
          )}

          {'padding' in styleObj && (
            <NumberField
              label="Padding"
              value={styleObj.padding}
              onChange={(v) => updateField(`${selection.styleObj}.padding`, v)}
            />
          )}
        </>
      )}
    </div>
  )
}

// --- Image panel ---------------------------------------------------------------

function ImagePanel({ selection, onClose }) {
  const { content, updateField } = useLandingContent()
  const stored = getPath(content, selection.path, null)
  const currentUrl = resolveImageUrl(stored)
  const styleObj = selection.styleObj ? getPath(content, selection.styleObj, {}) : null
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadLandingImage(file)
      updateField(selection.path, url)
    } catch (err) {
      console.error(err)
      alert('Could not upload image. Please try a smaller file.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <PanelHeader title={selection.label || 'Image'} subtitle="Image" onClose={onClose} />

      {currentUrl && (
        <img src={currentUrl} alt="" className="w-full h-40 object-cover rounded-lg mb-3 border border-white/10" />
      )}

      <ButtonRow>
        <SmallButton onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? 'Uploading…' : 'Replace Image'}
        </SmallButton>
        {stored && (
          <SmallButton variant="danger" onClick={() => updateField(selection.path, null)}>
            Remove
          </SmallButton>
        )}
      </ButtonRow>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />

      <p className="text-[11px] text-gray-500 mt-2">
        Removing an image restores the original default image for this element.
      </p>

      {styleObj && Object.keys(styleObj).length > 0 && (
        <>
          <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">Position &amp; Spacing</p>

          {'marginTop' in styleObj && (
            <NumberField
              label="Margin Top"
              value={styleObj.marginTop}
              onChange={(v) => updateField(`${selection.styleObj}.marginTop`, v)}
            />
          )}

          {'marginBottom' in styleObj && (
            <NumberField
              label="Margin Bottom"
              value={styleObj.marginBottom}
              onChange={(v) => updateField(`${selection.styleObj}.marginBottom`, v)}
            />
          )}

          {'borderRadius' in styleObj && (
            <NumberField
              label="Border Radius"
              value={styleObj.borderRadius}
              onChange={(v) => updateField(`${selection.styleObj}.borderRadius`, v)}
            />
          )}
        </>
      )}
    </div>
  )
}

// --- Video panel ---------------------------------------------------------------

function VideoPanel({ selection, onClose }) {
  const { content, updateField } = useLandingContent()
  const video = getPath(content, selection.path, {})

  return (
    <div>
      <PanelHeader title={selection.label || 'Video'} subtitle="Video" onClose={onClose} />
      <VideoFields path={selection.path} video={video} updateField={updateField} />
    </div>
  )
}

// --- Testimonial media panel (click-to-edit in canvas) -----------------------

function TestimonialMediaPanel({ selection, onClose }) {
  const { content, updateField } = useLandingContent()
  const { language, setLanguage, supportedLanguages } = useI18n()
  const item = getPath(content, selection.path, {})
  const isVideo = item.type === 'video'
  const isVideoUpload = isVideo && item.videoSourceType === 'upload'
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = isVideo ? await uploadLandingVideo(file) : await uploadLandingImage(file)
      updateField(`${selection.path}.url`, url)
      if (isVideo) updateField(`${selection.path}.videoSourceType`, 'upload')
    } catch (err) {
      console.error(err)
      alert('Could not upload file. Please try a smaller one.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      <PanelHeader title={selection.label || 'Testimonial Media'} subtitle="Client photo or video" onClose={onClose} />

      <FieldGroup label="Media Type">
        <ButtonRow>
          <SmallButton variant={!isVideo ? 'primary' : 'default'} onClick={() => updateField(`${selection.path}.type`, 'image')}>
            Image
          </SmallButton>
          <SmallButton variant={isVideo ? 'primary' : 'default'} onClick={() => updateField(`${selection.path}.type`, 'video')}>
            Video
          </SmallButton>
        </ButtonRow>
      </FieldGroup>

      {isVideo && (
        <FieldGroup label="Video Source">
          <ButtonRow>
            <SmallButton variant={isVideoUpload ? 'primary' : 'default'} onClick={() => updateField(`${selection.path}.videoSourceType`, 'upload')}>
              Upload
            </SmallButton>
            <SmallButton variant={!isVideoUpload ? 'primary' : 'default'} onClick={() => updateField(`${selection.path}.videoSourceType`, 'youtube')}>
              YouTube/Vimeo Link
            </SmallButton>
          </ButtonRow>
        </FieldGroup>
      )}

      {(!isVideo || isVideoUpload) ? (
        <>
          {!isVideo && resolveImageUrl(item.url) && (
            <img src={resolveImageUrl(item.url)} alt="" className="w-full h-32 object-cover rounded-lg mb-3 border border-white/10" />
          )}
          <ButtonRow>
            <SmallButton onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : `Replace ${isVideo ? 'Video' : 'Image'}`}
            </SmallButton>
          </ButtonRow>
          <input
            ref={inputRef}
            type="file"
            accept={isVideo ? 'video/mp4,video/webm,video/quicktime' : 'image/*'}
            className="hidden"
            onChange={handleUpload}
          />
        </>
      ) : (
        <TextField
          label="YouTube or Vimeo link"
          value={item.url}
          onChange={(v) => {
            updateField(`${selection.path}.url`, v)
            updateField(`${selection.path}.videoSourceType`, /vimeo\.com/i.test(v) ? 'vimeo' : 'youtube')
          }}
          placeholder="https://www.youtube.com/watch?v=..."
        />
      )}

      <FieldGroup label="Editing Language" hint="Applies to the client name and caption below.">
        <ButtonRow>
          {supportedLanguages.map((lang) => (
            <SmallButton key={lang} variant={language === lang ? 'primary' : 'default'} onClick={() => setLanguage(lang)}>
              {lang.toUpperCase()}
            </SmallButton>
          ))}
        </ButtonRow>
      </FieldGroup>

      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-4 mt-6">Caption</p>
      <TextField
        label={`Client Name (${language.toUpperCase()})`}
        value={resolveText(item.clientName, language)}
        onChange={(v) => updateField(`${selection.path}.clientName`, setTextForLanguage(item.clientName, language, v))}
        placeholder="e.g. Maria S."
      />
      <TextField
        label={`Caption (${language.toUpperCase()})`}
        value={resolveText(item.caption, language)}
        onChange={(v) => updateField(`${selection.path}.caption`, setTextForLanguage(item.caption, language, v))}
        placeholder="e.g. Lost 8kg in 3 months"
      />
    </div>
  )
}

// --- Button panel ---------------------------------------------------------------

function ButtonPanel({ selection, onClose }) {
  const { content, updateField } = useLandingContent()
  const { language, setLanguage, supportedLanguages } = useI18n()
  const btn = getPath(content, selection.path, {})
  const buttonText = resolveText(btn.text, language)

  const set = (field, value) => updateField(`${selection.path}.${field}`, value)

  return (
    <div>
      <PanelHeader title={selection.label || 'Button'} subtitle="Call-to-action button" onClose={onClose} />

      <FieldGroup label="Editing Language" hint="This also switches the preview — you're editing exactly what visitors see in that language.">
        <ButtonRow>
          {supportedLanguages.map((lang) => (
            <SmallButton key={lang} variant={language === lang ? 'primary' : 'default'} onClick={() => setLanguage(lang)}>
              {lang.toUpperCase()}
            </SmallButton>
          ))}
        </ButtonRow>
      </FieldGroup>

      <TextField
        label={`Button Text (${language.toUpperCase()})`}
        value={buttonText}
        onChange={(v) => set('text', setTextForLanguage(btn.text, language, v))}
      />
      <TextField label="Link / URL" value={btn.link} onChange={(v) => set('link', v)} />
      <ColorField label="Background Color" value={btn.bgColor || 'transparent'} onChange={(v) => set('bgColor', v)} />
      <ColorField label="Text Color" value={btn.textColor || '#ffffff'} onChange={(v) => set('textColor', v)} />
      <ColorField label="Border Color" value={btn.borderColor || '#ffffff'} onChange={(v) => set('borderColor', v)} />
      <TextField label="Border Radius (e.g. 8px)" value={btn.radius} onChange={(v) => set('radius', v)} />
    </div>
  )
}
