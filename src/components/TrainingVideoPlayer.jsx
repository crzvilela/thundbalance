import { resolveImageUrl } from '../api/landingPage'
import { getEmbedUrl, getInstagramEmbedUrl } from '../utils/videoEmbed'

// Renders one training video, regardless of source — shared by the public
// "Dicas de Treino" grid and the admin manager's inline previews, so the
// embed logic only lives in one place.
function TrainingVideoPlayer({ source, url, className = '' }) {
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

  // 'upload'
  return (
    <div className={`w-full aspect-video ${className}`}>
      <video
        src={resolveImageUrl(url)}
        controls
        className="w-full h-full rounded-lg object-cover bg-black"
      />
    </div>
  )
}

export default TrainingVideoPlayer
