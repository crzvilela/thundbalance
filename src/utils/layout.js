// Position and size of any element of the landing page, stored in one map:
//   content.layout[layoutKey(path)][device] = { x, y, width, height }
// x / y are offsets in px from the element's normal position; width / height
// are px sizes (missing = natural size). `path` is the element's content
// path, e.g. "sections.hero.title". Values are per device (desktop / tablet /
// mobile), exactly like the navbar logo, so the page stays responsive.
//
// The public site applies them through CSS variables (see Movable.css); the
// editor writes the same variables while dragging, then saves the numbers.

import { getPath } from './objectPath'

export const DEVICES = ['mobile', 'tablet', 'desktop']
export const LIMIT = 4000
export const MIN_SIZE = 16

// "sections.hero.title" -> "sections|hero|title": keeps the key free of the
// dots that updateField() uses to walk a path.
export const layoutKey = (path) => String(path).replace(/\./g, '|')

export const layoutPath = (path) => `layout.${layoutKey(path)}`

const num = (value) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

const clamp = (value) => Math.max(-LIMIT, Math.min(LIMIT, value))

// Normalised values for one device. width / height are null when not set.
export function deviceLayout(entry, device) {
  const stored = entry?.[device] || {}
  const width = num(stored.width)
  const height = num(stored.height)
  return {
    x: clamp(num(stored.x) ?? 0),
    y: clamp(num(stored.y) ?? 0),
    width: width === null ? null : Math.max(MIN_SIZE, Math.min(LIMIT, width)),
    height: height === null ? null : Math.max(MIN_SIZE, Math.min(LIMIT, height))
  }
}

export function getElementLayout(content, path) {
  return getPath(content, layoutPath(path), null)
}

// Does any device carry a custom position or size? Elements without one are
// rendered exactly as before (no class, no variables).
export function hasLayout(entry) {
  if (!entry) return false
  return DEVICES.some((device) => {
    const value = deviceLayout(entry, device)
    return value.x !== 0 || value.y !== 0 || value.width !== null || value.height !== null
  })
}

export function hasSize(entry, key) {
  return !!entry && DEVICES.some((device) => deviceLayout(entry, device)[key] !== null)
}

// CSS variables for every device. When `device` is given (editor), the
// unsuffixed variables are also set so the preview follows the chosen device
// regardless of the real window size.
export function layoutVars(entry, device) {
  const style = {}
  for (const screen of DEVICES) {
    const { x, y, width, height } = deviceLayout(entry, screen)
    style[`--mx-${screen}`] = `${x}px`
    style[`--my-${screen}`] = `${y}px`
    if (width !== null) style[`--mw-${screen}`] = `${width}px`
    if (height !== null) style[`--mh-${screen}`] = `${height}px`
    if (device === screen) {
      style['--mx'] = `${x}px`
      style['--my'] = `${y}px`
      if (width !== null) style['--mw'] = `${width}px`
      if (height !== null) style['--mh'] = `${height}px`
    }
  }
  return style
}

// Which resize handles an element kind gets.
export const HANDLES_BY_KIND = {
  text: ['w', 'e'],
  button: ['w', 'e'],
  image: ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'],
  video: ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'],
  box: ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'],
  icon: []
}

export const resizesWidth = (kind) => (HANDLES_BY_KIND[kind] || []).some((handle) => handle.includes('e') || handle.includes('w'))
export const resizesHeight = (kind) => (HANDLES_BY_KIND[kind] || []).some((handle) => handle.includes('n') || handle.includes('s'))
