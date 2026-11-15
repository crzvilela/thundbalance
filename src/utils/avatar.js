// The picture shown for a person without a profile photo: their initials on a plain background, drawn here as a small SVG (a data: address).
// Nothing is requested from another site: the name never leaves the browser (an external avatar service would receive it in the address).
const INITIALS = /\p{L}/u

/** Up to two initials of a name ("Ana García López" -> "AG"); "?" when there is none. */
export function initialsOf(name) {
  const words = String(name || '').trim().split(/\s+/).filter(word => INITIALS.test(word))
  const letters = words.slice(0, 2).map(word => Array.from(word).find(char => INITIALS.test(char)).toUpperCase())
  return letters.join('') || '?'
}

/** A data: address of the SVG with the initials. Only letters go into the SVG, so it can not carry markup. */
export function initialsAvatar(name) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#374151"/>`
    + `<text x="32" y="32" dy=".35em" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="26" font-weight="600" fill="#ffffff">${initialsOf(name)}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
