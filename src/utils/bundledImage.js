import { SITE_IMAGES } from './siteImages'

// An address of an image the site itself ships in public/site-images (and that has AVIF/WebP copies), or null for any other.
const BUNDLED = /(^|\/)site-images\/([^/.]+)\.(jpe?g|png)$/i

export function bundledImage(src) {
  const match = BUNDLED.exec(String(src || '').split('?')[0])
  return match && SITE_IMAGES[match[2]] ? { base: String(src).replace(/\.(jpe?g|png)$/i, ''), ...SITE_IMAGES[match[2]] } : null
}
