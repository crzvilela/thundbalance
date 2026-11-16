import { bundledImage } from '../utils/bundledImage'

// An image of the site as <picture>: AVIF or WebP when the browser can use them, the original JPG/PNG as the fallback, a 640-px copy
// for phones, explicit width/height (no layout shift), lazy and async unless it is on the first screen (`priority`).
// Only the images the site itself ships (public/site-images, see scripts/optimize-images.mjs) have those copies; any other address
// (an upload of the admin, an external link) is drawn as a plain <img> with the same attributes.
export default function OptimizedPicture({ src, sizes = '100vw', priority = false, alt = '', ...imgProps }) {
  const bundled = bundledImage(src)
  const attributes = {
    alt,
    decoding: 'async',
    loading: priority ? 'eager' : 'lazy',
    ...(priority ? { fetchPriority: 'high' } : {}),
    ...(bundled ? { width: bundled.width, height: bundled.height } : {}),
    ...imgProps,
  }
  if (!bundled) return <img src={src} {...attributes} />
  const set = (extension) => `${bundled.base}-${bundled.small}.${extension} ${bundled.small}w, ${bundled.base}.${extension} ${bundled.width}w`
  return (
    <picture>
      <source type="image/avif" srcSet={set('avif')} sizes={sizes} />
      <source type="image/webp" srcSet={set('webp')} sizes={sizes} />
      <img src={src} {...attributes} />
    </picture>
  )
}
