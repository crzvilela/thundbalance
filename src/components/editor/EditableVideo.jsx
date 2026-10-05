import { useLandingContent } from '../../content/LandingContentContext'
import { getPath } from '../../utils/objectPath'
import { resolveImageUrl } from '../../api/landingPage'
import { getEmbedUrl } from '../../utils/videoEmbed'

// Renders the actual <video> or embed <iframe> for a stored video object
// { sourceType: 'upload'|'embed', url, autoplay, loop, muted }. Shared by
// EditableVideo below (click-to-select, for content video slots) and
// directly by SectionBackground's video layer (which isn't click-to-select
// — like the image background, it's only edited via the properties panel).
export function VideoMedia({ video, className = '' }) {
  const v = video || {}
  if (!v.url) return null

  if (v.sourceType === 'embed') {
    const src = getEmbedUrl(v.url, { autoplay: v.autoplay, loop: v.loop, muted: v.muted })
    return (
      <iframe
        src={src}
        className={className}
        title="Embedded video"
        frameBorder="0"
        allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    )
  }

  return (
    <video
      src={resolveImageUrl(v.url)}
      className={className}
      autoPlay={!!v.autoplay}
      loop={!!v.loop}
      muted={v.muted !== false}
      playsInline
      controls={!v.autoplay}
    />
  )
}

// Click-to-select video slot, following the same pattern as EditableImage:
// click it in the preview to open the video panel (upload or embed URL,
// autoplay/loop/muted) in PropertiesPanel.
export function EditableVideo({ path, containerClassName = '', videoClassName = '', label }) {
  const { content, isEditMode, select, selection } = useLandingContent()
  const video = getPath(content, path, {})
  const isSelected = isEditMode && selection?.type === 'video' && selection.path === path

  if (!isEditMode) {
    return (
      <div className={containerClassName}>
        <VideoMedia video={video} className={videoClassName} />
      </div>
    )
  }

  return (
    <div
      className={`relative group/vid cursor-pointer ${containerClassName}`}
      onClick={(e) => {
        e.stopPropagation()
        select({ type: 'video', path, label: label || path })
      }}
    >
      <div
        className={`${videoClassName} pointer-events-none transition ${
          isSelected ? 'ring-2 ring-emerald-400 ring-inset' : 'group-hover/vid:ring-2 group-hover/vid:ring-emerald-400/60 group-hover/vid:ring-inset'
        }`}
      >
        {video.url ? (
          <VideoMedia video={video} className="w-full h-full" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-[#111] text-gray-500 text-sm">
            No video set
          </div>
        )}
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/vid:bg-black/40 transition pointer-events-none">
        <span className="opacity-0 group-hover/vid:opacity-100 text-white text-[11px] uppercase tracking-wider bg-black/70 px-3 py-1 rounded transition">
          Click to edit video
        </span>
      </div>
    </div>
  )
}
