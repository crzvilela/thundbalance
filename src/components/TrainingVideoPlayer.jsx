import { useState } from 'react'
import { resolveImageUrl } from '../api/landingPage'
import { getEmbedUrl, getInstagramEmbedUrl } from '../utils/videoEmbed'

// Renders one training video, regardless of source — shared by the public
// "Dicas de Treino" grid and the admin manager's inline previews, so the
// embed logic only lives in one place.
function TrainingVideoPlayer({ source, url, className = '', compact = false }) {
  if (!url) return null

  if (source === 'instagram') {
    return (
      <div className={`w-full max-w-sm mx-auto aspect-[9/16] ${className}`}>
        <iframe
          src={getInstagramEmbedUrl(url)}
          className="w-full h-full rounded-lg border-0"
          title="Instagram Reel"
          scrolling="no"
          allow="autoplay; encrypted-media"
        />
      </div>
    )
  }

  if (source === 'youtube' || source === 'vimeo') {
    return (
      <div className={`w-full aspect-video ${className}`}>
        <iframe
          src={getEmbedUrl(url)}
          className="w-full h-full rounded-lg border-0"
          title="Video"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    )
  }

  // 'upload': uploaded files can be horizontal (16:9) or vertical (9:16, phone
  // recordings). The frame takes the file's real proportions, read once its
  // metadata loads, so vertical clips are not cropped to a landscape box.
  return <UploadedVideo url={url} className={className} compact={compact} />
}

function UploadedVideo({ url, className, compact }) {
  const [ratio, setRatio] = useState(16 / 9)
  const vertical = ratio < 1
  const style = { aspectRatio: String(ratio), margin: '0 auto' }
  if (vertical) {
    // Keep tall videos from taking over the page: capped width on the public
    // card, a fixed height in the admin's small thumbnails.
    if (compact) Object.assign(style, { height: '11rem', width: 'auto' })
    else Object.assign(style, { maxWidth: '340px', width: '100%' })
  }
  return (
    <div className={`${vertical && compact ? '' : 'w-full'} ${className}`} style={style}>
      <video
        src={resolveImageUrl(url)}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          const { videoWidth, videoHeight } = event.currentTarget
          if (videoWidth && videoHeight) setRatio(videoWidth / videoHeight)
        }}
        className="w-full h-full rounded-lg object-contain bg-black"
      />
    </div>
  )
}

export default TrainingVideoPlayer
