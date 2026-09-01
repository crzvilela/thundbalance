// Converts a normal YouTube/Vimeo watch link into its embeddable iframe src.
// Any other link is used as-is as the iframe src — the caller is
// responsible for showing a soft warning that embed support is best with
// YouTube/Vimeo, per the PropertiesPanel's video fields.
//
// `autoplay`/`loop`/`muted` only matter for background-video use (a content
// video the admin clicks play on doesn't need them forced) — pass them when
// rendering a background layer, omit them for a normal content embed.

export function isKnownEmbedProvider(url) {
  if (!url) return false
  return /youtu\.?be/i.test(url) || /vimeo\.com/i.test(url)
}

export function getEmbedUrl(url, { autoplay = false, loop = false, muted = false } = {}) {
  if (!url) return ''

  const youtubeMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/i)
  if (youtubeMatch) {
    const id = youtubeMatch[1]
    const params = new URLSearchParams({
      autoplay: autoplay ? '1' : '0',
      mute: muted ? '1' : '0',
      loop: loop ? '1' : '0',
      controls: autoplay ? '0' : '1',
      playsinline: '1'
    })
    // YouTube only loops a single video if playlist is set to that same id.
    if (loop) params.set('playlist', id)
    return `https://www.youtube.com/embed/${id}?${params.toString()}`
  }

  const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i)
  if (vimeoMatch) {
    const id = vimeoMatch[1]
    const params = new URLSearchParams({
      autoplay: autoplay ? '1' : '0',
      muted: muted ? '1' : '0',
      loop: loop ? '1' : '0',
      background: autoplay ? '1' : '0'
    })
    return `https://player.vimeo.com/video/${id}?${params.toString()}`
  }

  // Unknown provider: best effort, use the link directly as the iframe src.
  return url
}
