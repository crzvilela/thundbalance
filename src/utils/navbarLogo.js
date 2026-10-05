export function navbarLogoLayout(layout, device) {
  const defaults = { width: device === 'mobile' ? 30 : 38, height: device === 'mobile' ? 20 : 24, x: 0, y: 0 }
  const stored = layout?.[device] || {}
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const number = Number.parseFloat(stored[key])
    return [key, Number.isFinite(number) ? Math.max(key === 'width' || key === 'height' ? 1 : -2000, Math.min(2000, number)) : fallback]
  }))
}
export function navbarLogoStyle(layout, device) {
  const style = {}
  for (const screen of ['mobile', 'tablet', 'desktop']) {
    for (const [key, value] of Object.entries(navbarLogoLayout(layout, screen))) {
      style[`--logo-${key}-${screen}`] = `${value}px`
      if (device === screen) style[`--logo-${key}`] = `${value}px`
    }
  }
  return style
}
