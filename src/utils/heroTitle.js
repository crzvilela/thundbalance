// Position and width of the hero title, stored per device in
// sections.hero.titleLayout.<mobile|tablet|desktop> = { x, y, width }.
// x / y are offsets in px from the normal (centered) position; width is the
// text box width in px, and null/missing means "as wide as the text".
// The public site applies them through CSS variables (see HeroTitle.css), the
// same way the navbar logo does.

const DEVICES = ['mobile', 'tablet', 'desktop']
const OFFSET_LIMIT = 2000
const MIN_WIDTH = 60

export function heroTitleLayout(layout, device) {
  const stored = layout?.[device] || {}
  const number = (value) => (value === null || value === undefined || value === '' ? NaN : Number.parseFloat(value))
  const offset = (value) => {
    const parsed = number(value)
    return Number.isFinite(parsed) ? Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, parsed)) : 0
  }
  const width = number(stored.width)
  return {
    x: offset(stored.x),
    y: offset(stored.y),
    width: Number.isFinite(width) ? Math.max(MIN_WIDTH, Math.min(OFFSET_LIMIT, width)) : null
  }
}

// CSS variables for every device; the one matching `device` also gets the
// unsuffixed variables so the editor can preview a device regardless of the
// real window size.
export function heroTitleStyle(layout, device) {
  const style = {}
  for (const screen of DEVICES) {
    const { x, y, width } = heroTitleLayout(layout, screen)
    style[`--title-x-${screen}`] = `${x}px`
    style[`--title-y-${screen}`] = `${y}px`
    if (width !== null) style[`--title-width-${screen}`] = `${width}px`
    if (device === screen) {
      style['--title-x'] = `${x}px`
      style['--title-y'] = `${y}px`
      if (width !== null) style['--title-width'] = `${width}px`
    }
  }
  return style
}
