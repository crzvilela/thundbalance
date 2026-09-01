import { resolveImageUrl } from '../../api/landingPage'
import { VideoMedia } from './EditableVideo'

// Inline style for a section's solid background color. Sections keep their
// existing Tailwind bg-* class as the default look — we only override it
// once the admin actually picks a color (background.color !== '', which is
// the default for every section except Hero/About, which ship with the
// same solid color they already had before this was configurable).
// Independent of background.type — a leftover `color` value doesn't hurt
// when type is 'image'/'video' since it just paints underneath the media.
export function sectionBackgroundStyle(background) {
  if (!background || !background.color) return undefined
  return { backgroundColor: background.color }
}

function OverlayLayer({ background }) {
  const bg = background || {}
  const overlayOpacity = bg.overlayOpacity ?? 0
  const overlayColor = bg.overlayColor || '#000000'
  const overlayHex = Math.round(overlayOpacity * 255).toString(16).padStart(2, '0')
  const overlayHexSoft = Math.round(overlayOpacity * 0.75 * 255).toString(16).padStart(2, '0')

  return (
    <div
      className="absolute inset-0"
      style={{
        background: `linear-gradient(to bottom, ${overlayColor}${overlayHex}, ${overlayColor}${overlayHexSoft}, ${overlayColor})`
      }}
    />
  )
}

// Renders the background media (image OR video) + gradient overlay layer
// for a section, based on `background.type`. Must be placed as an early
// child of a `position: relative` (or otherwise positioned, e.g.
// motion.section) parent — it positions itself with a negative z-index so
// it always paints behind the section's normal content, regardless of DOM
// order, without requiring every section's content wrapper to opt into its
// own z-index.
//
// `fallbackSrc` is only used by Hero, which always shows *some* image (a
// bundled asset) even before the admin uploads one. Every other section has
// no media at all by default, so this renders nothing for them until the
// admin actually sets one — matching today's look exactly. (Name kept as
// SectionBackgroundImage, not renamed to "...Media", so every existing call
// site from Phases 1-2 keeps working unchanged.)
export function SectionBackgroundImage({ background, fallbackSrc, wrapperClassName = '', imageClassName = '' }) {
  const bg = background || {}

  if (bg.type === 'video') {
    if (!bg.video?.url) return null

    return (
      <div className={`absolute inset-0 -z-10 overflow-hidden pointer-events-none ${wrapperClassName}`}>
        <VideoMedia video={bg.video} className={`absolute inset-0 w-full h-full object-cover ${imageClassName}`} />
        <OverlayLayer background={bg} />
      </div>
    )
  }

  const imageUrl = resolveImageUrl(bg.image) || fallbackSrc
  if (!imageUrl) return null

  return (
    <div className={`absolute inset-0 -z-10 overflow-hidden pointer-events-none ${wrapperClassName}`}>
      <img
        src={imageUrl}
        alt=""
        style={{ objectPosition: bg.position || 'center' }}
        className={`absolute inset-0 w-full h-full object-cover ${imageClassName}`}
      />
      <OverlayLayer background={bg} />
    </div>
  )
}
